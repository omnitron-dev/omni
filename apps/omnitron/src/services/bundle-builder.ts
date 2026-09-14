/**
 * Building the bundle the planner describes.
 *
 * `local-bundle.ts` decides what travels; this puts it on disk. Kept apart
 * because the decision is where the mistakes live and the decision is pure —
 * this half runs `pnpm pack` and writes files, and can only be checked by
 * doing it.
 *
 * The layout:
 *
 *     <out>/package.json        root manifest: file: deps + overrides
 *     <out>/dist/               the built daemon
 *     <out>/webapp/dist/        the console
 *     <out>/vendor/*.tgz        every workspace package, packed
 *     <out>/BUNDLE.json         what this is, and what it was built from
 *
 * `node_modules` is deliberately absent. It is the one thing that must NOT
 * travel: a tree installed here carries `@esbuild/darwin-arm64` and no
 * `linux-x64`, and the target is the only machine that knows what it is.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  planBundle,
  bundleRootManifest,
  localVersion,
  VENDOR_DIR,
  type BundlePlan,
  type PackageManifest,
  type Workspace,
} from './local-bundle.js';

const exec = promisify(execFile);

/** What a built bundle says about itself. */
export interface BundleMetadata {
  /** `0.2.0+local.<sha>.<stamp>` — see `localVersion`. */
  readonly version: string;
  /** The commit the tree was on. */
  readonly commit: string;
  /** Whether that tree had uncommitted changes. */
  readonly dirty: boolean;
  readonly builtAt: string;
  /** Packages that travelled, for a reader deciding whether to trust it. */
  readonly vendored: readonly string[];
}

export interface BuildBundleOptions {
  /** Repository root — where the workspace packages live. */
  readonly workspaceRoot: string;
  /** Package to bundle. */
  readonly rootPackage: string;
  /** Directory to build into. Created; must not already hold a bundle. */
  readonly outDir: string;
  /** Files and directories to copy from the package, relative to it. */
  readonly include?: readonly string[];
  readonly logger?: { info(msg: string): void } | undefined;
}

export interface BuildBundleResult {
  readonly outDir: string;
  readonly metadata: BundleMetadata;
  readonly plan: BundlePlan;
}

/**
 * Read every workspace package's manifest.
 *
 * The root is resolved to an absolute path first, and every directory
 * recorded below is absolute too. `pnpm --dir` resolves a relative path
 * against ITS OWN working directory, not against the caller's — so a
 * `workspaceRoot` of `../..` produced `/Users/taaliman/projects/luxquant/
 * packages`, two levels above where it meant, and the error named a
 * directory nobody had written down. Paths that cross a process boundary are
 * absolute.
 */
export function readWorkspace(workspaceRootInput: string): Workspace {
  const workspaceRoot = path.resolve(workspaceRootInput);
  const found = new Map<string, PackageManifest>();
  for (const group of ['packages', 'apps']) {
    const dir = path.join(workspaceRoot, group);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(dir, entry.name, 'package.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageManifest & { __dir?: string };
        if (!manifest.name) continue;
        manifest.__dir = path.join(dir, entry.name);
        found.set(manifest.name, manifest);
      } catch {
        // A manifest that does not parse is not a workspace package. The
        // planner refuses later if something needed it.
      }
    }
  }
  return found;
}

/** Where a workspace package lives, as recorded by `readWorkspace`. */
function directoryOf(manifest: PackageManifest): string {
  const dir = (manifest as PackageManifest & { __dir?: string }).__dir;
  if (!dir) throw new Error(`No directory recorded for ${manifest.name}`);
  return dir;
}

/** `git rev-parse HEAD` and whether the tree is clean. */
export async function describeTree(cwd: string): Promise<{ commit: string; dirty: boolean }> {
  let commit = '';
  let dirty = false;
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd });
    commit = stdout.trim();
  } catch {
    // Not a repository, or no commits. `localVersion` says `nocommit`.
  }
  try {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd });
    dirty = stdout.trim().length > 0;
  } catch {
    // Same.
  }
  return { commit, dirty };
}

/**
 * Build the bundle.
 *
 * Packs into a temporary sibling and renames at the end, so `<out>` either
 * does not exist or holds a complete bundle. A half-built one is worse than
 * none: the transfer step has no way to tell it from a finished one, and the
 * failure lands on the node.
 */
export async function buildBundle(options: BuildBundleOptions): Promise<BuildBundleResult> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const workspace = readWorkspace(workspaceRoot);
  const plan = planBundle(options.rootPackage, workspace);
  if (plan.refusal) throw new Error(plan.refusal);

  const tree = await describeTree(workspaceRoot);
  const version = localVersion(plan.root.version, tree.commit, new Date());

  const outDir = path.resolve(options.outDir);
  const staging = `${outDir}.building`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, VENDOR_DIR), { recursive: true });

  try {
    const rootDir = directoryOf(workspace.get(options.rootPackage)!);

    // The package's own built output. Copied rather than packed: `npm pack`
    // of the root would produce a tarball we would immediately unpack, and
    // the bundle's root IS the install directory.
    for (const rel of options.include ?? ['dist', 'webapp/dist', 'data', 'README.md']) {
      const from = path.join(rootDir, rel);
      if (!fs.existsSync(from)) continue;
      const to = path.join(staging, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true });
    }

    // Every workspace package, packed where npm can install it from.
    for (const vendored of plan.vendored) {
      const dir = directoryOf(workspace.get(vendored.name)!);
      options.logger?.info(`packing ${vendored.name}@${vendored.version}`);
      await exec('pnpm', ['--dir', dir, 'pack', '--pack-destination', path.join(staging, VENDOR_DIR)], {
        cwd: workspaceRoot,
        maxBuffer: 16 * 1024 * 1024,
      });
      const produced = path.join(staging, VENDOR_DIR, vendored.tarball);
      if (!fs.existsSync(produced)) {
        // `pnpm pack` names the file from the manifest, and the planner named
        // it the same way — a mismatch here means one of them changed, and
        // the override would point at a file that is not there.
        throw new Error(
          `Packing ${vendored.name} produced no ${vendored.tarball}. ` +
            `The bundle's overrides would point at a file that does not exist.`,
        );
      }
    }

    fs.writeFileSync(
      path.join(staging, 'package.json'),
      JSON.stringify(bundleRootManifest(plan, version), null, 2) + '\n',
    );

    const metadata: BundleMetadata = {
      version,
      commit: tree.commit,
      dirty: tree.dirty,
      builtAt: new Date().toISOString(),
      vendored: plan.vendored.map((v) => `${v.name}@${v.version}`),
    };
    fs.writeFileSync(path.join(staging, 'BUNDLE.json'), JSON.stringify(metadata, null, 2) + '\n');

    fs.rmSync(outDir, { recursive: true, force: true });
    fs.renameSync(staging, outDir);

    return { outDir, metadata, plan };
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

/**
 * The commands that install a bundle, once it is unpacked on the target.
 *
 * Returned rather than run so a caller can log them, and so the install is
 * the same whether it happens over SSH or on this machine.
 */
export function installCommands(bundleDir: string, prefix: string): readonly { what: string; command: string }[] {
  const q = (v: string) => `'${v.replace(/'/g, "'\\''")}'`;
  return [
    {
      what: 'install dependencies for this machine',
      // `--omit=dev` because a node runs the daemon, it does not build it.
      // `--no-audit --no-fund` because neither says anything about whether
      // the install worked, and both write to stdout a caller has to parse.
      command: `cd ${q(bundleDir)} && npm install --omit=dev --no-audit --no-fund`,
    },
    {
      what: 'link the CLI',
      command:
        `cd ${q(bundleDir)} && mkdir -p ${q(`${prefix}/bin`)} && ` +
        `ln -sfn ${q(`${bundleDir}/dist/cli/omnitron.js`)} ${q(`${prefix}/bin/omnitron`)}`,
    },
  ];
}
