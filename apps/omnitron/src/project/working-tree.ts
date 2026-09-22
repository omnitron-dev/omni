/**
 * Is this project's working tree the commit it says it is?
 *
 * A remote deployment compiles and ships what is ON DISK. Measured over one
 * night with three sessions in one checkout: a deployment shipped five
 * artifacts of six because the sixth did not compile from somebody's
 * half-finished edit; and the set of paths that travel is wider than anyone
 * guessed twice in a row — not only `apps/**` but the whole gateway config
 * directory, every file in it, with its modes (`readConfigDirectory`).
 *
 * That is why this asks git rather than naming directories. Enumerating the
 * safe ones is a claim about the mechanism that has to be re-made every time
 * the mechanism grows, and it was already wrong twice. `git status
 * --porcelain` answers the question the deployment actually has — «is
 * anything here different from the commit» — and ignored files do not appear
 * in it, so a scratch file nobody would commit is not a scratch file anybody
 * ships.
 *
 * When the answer cannot be obtained — no git, not a repository — this says
 * so rather than passing. A check that cannot run is not a check that
 * passed, and the caller logs that distinction instead of silently
 * deploying.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface WorkingTree {
  /** False when git could not answer; `dirty` and `head` mean nothing then. */
  readonly checked: boolean;
  /** Why it could not be checked, for the log line that says so. */
  readonly why?: string;
  /** The commit this tree claims to be, short form. */
  readonly head?: string;
  /** Paths that differ from it — `git status --porcelain`, modified or not tracked. */
  readonly dirty: readonly string[];
}

export async function describeWorkingTree(projectPath: string): Promise<WorkingTree> {
  try {
    const { stdout: head } = await exec('git', ['-C', projectPath, 'rev-parse', '--short', 'HEAD'], {
      timeout: 15_000,
    });
    const { stdout: status } = await exec('git', ['-C', projectPath, 'status', '--porcelain'], {
      timeout: 30_000,
    });
    const dirty = status
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      // `XY path` — and `R  old -> new`, whose new name is the one on disk.
      .map((line) => line.replace(/^\S+\s+/, '').replace(/^.*->\s*/, ''));
    return { checked: true, head: head.trim(), dirty };
  } catch (err) {
    return { checked: false, why: (err as Error).message.split('\n')[0] ?? 'git did not answer', dirty: [] };
  }
}

/**
 * The refusal a dirty tree earns, or null.
 *
 * It names the files, because «the tree is dirty» sends the reader to `git
 * status` to find out what this command already knew.
 */
export function refusalForDirtyTree(
  tree: WorkingTree,
  stackName: string,
  shown = 10,
): string | null {
  if (!tree.checked || tree.dirty.length === 0) return null;
  const head = tree.head ? ` (HEAD ${tree.head})` : '';
  const list = tree.dirty.slice(0, shown).map((p) => `  ${p}`).join('\n');
  const rest = tree.dirty.length > shown ? `\n  …and ${tree.dirty.length - shown} more` : '';
  return (
    `Refusing to deploy ${stackName}: ${tree.dirty.length} file(s) differ from the commit${head}, ` +
    `and a remote deployment ships what is on disk — not only the applications, ` +
    `but the gateway's whole configuration directory.\n${list}${rest}\n` +
    `Commit or stash them, or pass --allow-dirty to ship this disk deliberately.`
  );
}

/**
 * Every distinct repository the deployment reads, answered together.
 *
 * A project is not the only tree that travels. The portal's bundle INLINES
 * the sources of the packages it links — prism and netron-browser resolve
 * through a vite alias to each package's `src` in another repository — so an
 * uncommitted change there reaches the node inside `dist` while the
 * project's own tree is spotless. (The backends are different: their
 * vendored `@omnitron-dev/*` are replaced on the node by symlinks to the
 * node daemon's copy, so what was packed for them does not run.)
 *
 * The inputs are derived from the mechanism — `linkedSourceDirs` is what the
 * staleness check already uses to decide what the bundle is built from — and
 * then collapsed to git roots, because two source directories in one
 * repository are one answer.
 */
export async function describeWorkingTrees(
  paths: readonly string[],
): Promise<Array<{ root: string; tree: WorkingTree }>> {
  const roots = new Map<string, string>();
  for (const dir of paths) {
    const root = await gitRootOf(dir);
    if (root && !roots.has(root)) roots.set(root, dir);
  }
  const out: Array<{ root: string; tree: WorkingTree }> = [];
  for (const [root] of roots) out.push({ root, tree: await describeWorkingTree(root) });
  return out;
}

async function gitRootOf(dir: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 15_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
