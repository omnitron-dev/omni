/**
 * Where a release is built, so the lockfile's links land on the omni clone.
 *
 * Until the registry migration the project declares every omni package as a
 * `link:` to a checkout on the developer's disk, and the lockfile records it
 * RELATIVE to each importer — `link:../../luxquant/omnitron-dev/omni/apps/omnitron`
 * from the project root. `pnpm install --frozen-lockfile` follows that
 * relative path. So a clean clone of the project placed anywhere else either
 * links nothing (measured 2026-09-22: 97 of 97 links dangling, install exit 0)
 * or, placed at the same depth as the working checkout, links the DEVELOPER'S
 * omni — dirty tree and all — into a build that claims to be a commit.
 *
 * A release is therefore built inside a root that reproduces the relative
 * layout, with a clean clone of omni exactly where the links point. The
 * layout is read from the lockfile rather than written down here, because the
 * lockfile is what pnpm will follow.
 */

import fs from 'node:fs';
import path from 'node:path';

export interface LinkLayout {
  /** omni's checkout relative to the project root, as the lockfile implies it. */
  readonly omniRel: string;
  /** How many directories above the project root the links climb. */
  readonly climbs: number;
  /** The omni workspace directories the project links, relative to omni's root. */
  readonly linkedDirs: readonly string[];
}

/** `importer → link targets`, from the lockfile's `importers:` section. */
function importerLinks(lockfile: string): Array<{ importer: string; rel: string }> {
  const out: Array<{ importer: string; rel: string }> = [];
  let inImporters = false;
  let importer: string | null = null;
  for (const line of lockfile.split('\n')) {
    if (/^importers:\s*$/.test(line)) {
      inImporters = true;
      continue;
    }
    if (!inImporters) continue;
    if (/^\S/.test(line)) break; // the next top-level key
    const key = /^ {2}([^\s].*?):\s*$/.exec(line);
    if (key) {
      importer = key[1]!.replace(/^['"]|['"]$/g, '');
      continue;
    }
    const link = /^\s+version: link:(\S+)\s*$/.exec(line);
    if (link && importer !== null) out.push({ importer, rel: link[1]! });
  }
  return out;
}

/**
 * Read the layout the lockfile implies, or say why there is none.
 *
 * A link that leaves the project root is an omni link; its target minus the
 * trailing `packages/<name>` or `apps/<name>` is omni's root. All of them
 * must agree on that root: links into two outside checkouts cannot be laid
 * out by one clone, and guessing which one is "omni" would build from the
 * wrong one.
 */
export function readLinkLayout(lockfile: string): LinkLayout | { refusal: string } {
  const roots = new Set<string>();
  const dirs = new Set<string>();
  const strays: string[] = [];
  for (const { importer, rel } of importerLinks(lockfile)) {
    const target = path.posix.normalize(path.posix.join(importer === '.' ? '' : importer, rel));
    if (!target.startsWith('../')) continue; // inside the project: its own workspace
    const parts = target.split('/');
    const kind = parts[parts.length - 2];
    if (parts.length < 3 || (kind !== 'packages' && kind !== 'apps')) {
      strays.push(target);
      continue;
    }
    roots.add(parts.slice(0, -2).join('/'));
    dirs.add(parts.slice(-2).join('/'));
  }
  if (strays.length > 0) {
    return { refusal: `the lockfile links outside the project to something that is not a workspace package: ${strays.slice(0, 3).join(', ')}` };
  }
  if (roots.size === 0) {
    return { refusal: 'the lockfile links nothing outside the project — there is no omni checkout to lay out' };
  }
  if (roots.size > 1) {
    return { refusal: `the lockfile links into ${roots.size} outside checkouts (${[...roots].join(', ')}) — one clone cannot stand in for them` };
  }
  const omniRel = [...roots][0]!;
  const climbs = omniRel.split('/').filter((p) => p === '..').length;
  return { omniRel, climbs, linkedDirs: [...dirs].sort() };
}

/**
 * The two checkouts inside `srcRoot`: the project where its own last
 * `climbs` path segments put it, and omni where its links then land.
 */
export function planBuildRoot(
  srcRoot: string,
  projectPath: string,
  layout: LinkLayout,
): { projectDir: string; omniDir: string } | { refusal: string } {
  const segments = path.resolve(projectPath).split(path.sep).filter(Boolean);
  if (layout.climbs < 1 || layout.climbs > segments.length) {
    return { refusal: `the links climb ${layout.climbs} directories above a project at ${projectPath}` };
  }
  const projectDir = path.join(srcRoot, ...segments.slice(-layout.climbs));
  const omniDir = path.resolve(projectDir, layout.omniRel);
  const inside = omniDir.startsWith(path.resolve(srcRoot) + path.sep);
  if (!inside) {
    return { refusal: `omni would land at ${omniDir}, outside the build root ${srcRoot}` };
  }
  return { projectDir, omniDir };
}

/**
 * The project's real directory and the omni checkout its links point to.
 *
 * From the REAL path, because that is where pnpm resolves a relative link
 * from. The registry holds `omni/internal/daos`, a symlink to
 * `~/projects/dao/daos`; resolved from the symlink, `../../luxquant/…` named
 * a directory that does not exist, and the first `git` run there failed with
 * a bare `spawn git ENOENT`.
 */
export function resolveCheckouts(projectPath: string, layout: LinkLayout): { projectReal: string; omniPath: string } {
  const projectReal = fs.realpathSync(projectPath);
  return { projectReal, omniPath: path.resolve(projectReal, layout.omniRel) };
}
