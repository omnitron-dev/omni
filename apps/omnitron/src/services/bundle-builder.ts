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
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { resolvePnpm } from '../shared/pnpm.js';

import {
  planBundle,
  bundleRootManifest,
  isLinkRange,
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
  /**
   * Tarballs already packed in this run, by `<name>@<version>`.
   *
   * Six apps of one stack vendor the same nineteen omnitron packages, and
   * packing each of them six times is five sixths of the longest phase of a
   * deployment — measured at roughly a minute per app, for a tree that
   * cannot have changed between the first app and the last. Scoped to one
   * `buildAll` rather than to the process: a daemon runs for weeks and a
   * cache that outlives the deployment would ship yesterday's package under
   * today's version.
   */
  readonly packCache?: Map<string, string>;
  /**
   * Further workspace roots whose packages may be vendored.
   *
   * Left out, the packages this one can reach are its own repository's. An
   * app that depends on a sibling checkout through `link:` needs that
   * checkout's root here, or the plan refuses it as missing.
   */
  readonly additionalWorkspaceRoots?: readonly string[];
  readonly logger?: { info(msg: string): void } | undefined;
}

export interface BuildBundleResult {
  readonly outDir: string;
  readonly metadata: BundleMetadata;
  readonly plan: BundlePlan;
}

/**
 * Find the repository root from a directory inside it.
 *
 * `process.cwd()` is where the operator was standing, and for a command run
 * from `apps/omnitron` that is two levels below the packages it needs to
 * bundle. Measured: `fleet upgrade` from the package directory reported
 * "@omnitron-dev/omnitron is not a package in this workspace" — true of the
 * directory it was given, and useless about the mistake.
 *
 * `pnpm-workspace.yaml` is the marker, because it is what defines the
 * workspace this file reads. Null rather than a guess when there is none.
 */
export function findWorkspaceRoot(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
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
/**
 * Read several workspace roots into one map.
 *
 * An app can depend on packages of another checkout — daos declares every
 * omni package as `link:/Users/…/omni/packages/<name>` — and a planner given
 * only the app's own workspace refuses those as missing, which is true of
 * that workspace and useless about the artifact.
 *
 * Earlier roots win a name collision: the first root is the one whose package
 * is being built, and a package it defines is the one it meant.
 */
export function readWorkspaces(roots: readonly string[]): Workspace {
  const merged = new Map<string, PackageManifest>();
  for (const root of roots) {
    for (const [name, manifest] of readWorkspace(root)) {
      if (!merged.has(name)) merged.set(name, manifest);
    }
  }
  return merged;
}

/**
 * Every workspace root a manifest's `link:` ranges point into.
 *
 * The path is right there in the range, and the root above it is marked by
 * `pnpm-workspace.yaml` — the same marker `findWorkspaceRoot` uses, because
 * it is the same question asked from the other end. Deriving it beats a
 * configured path that has to be kept in step with the manifest.
 */
export function linkedWorkspaceRoots(manifest: PackageManifest): string[] {
  const roots: string[] = [];
  for (const group of [manifest.dependencies, manifest.optionalDependencies]) {
    for (const range of Object.values(group ?? {})) {
      if (!isLinkRange(range)) continue;
      const target = range.slice('link:'.length);
      const root = findWorkspaceRoot(target);
      if (root && !roots.includes(root)) roots.push(root);
    }
  }
  return roots;
}

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

/**
 * Where packed tarballs are kept for the rest of a run.
 *
 * One directory per process, under the system temp dir. It is not cleaned up
 * here: the cache is handed in by the caller and lives exactly as long as the
 * caller keeps the map, and a directory of tarballs in `TMPDIR` is what the
 * operating system already knows how to reclaim.
 */
let packCacheDir: string | null = null;
function cacheDir(): string {
  if (!packCacheDir) {
    packCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-pack-'));
  }
  return packCacheDir;
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
  const workspace = readWorkspaces([workspaceRoot, ...(options.additionalWorkspaceRoots ?? [])]);
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
      const produced = path.join(staging, VENDOR_DIR, vendored.tarball);
      const cacheKey = `${vendored.name}@${vendored.version}`;
      const cached = options.packCache?.get(cacheKey);
      if (cached && fs.existsSync(cached)) {
        fs.copyFileSync(cached, produced);
        continue;
      }

      const dir = directoryOf(workspace.get(vendored.name)!);
      options.logger?.info(`packing ${vendored.name}@${vendored.version}`);
      // `resolvePnpm()`, not `'pnpm'`: launchd's PATH does not include the
      // directory pnpm installs itself into, so a bare name is an ENOENT for
      // every build the daemon runs and for none that a developer runs by
      // hand. See `shared/pnpm.ts`.
      await exec(resolvePnpm(), ['--dir', dir, 'pack', '--pack-destination', path.join(staging, VENDOR_DIR)], {
        cwd: workspaceRoot,
        maxBuffer: 16 * 1024 * 1024,
      });
      if (!fs.existsSync(produced)) {
        // `pnpm pack` names the file from the manifest, and the planner named
        // it the same way — a mismatch here means one of them changed, and
        // the override would point at a file that is not there.
        throw new Error(
          `Packing ${vendored.name} produced no ${vendored.tarball}. ` +
            `The bundle's overrides would point at a file that does not exist.`,
        );
      }

      // Kept where the next bundle can copy it from. The staging directory
      // this one is in is removed at the end, so the cache holds a copy of
      // its own rather than a path that is about to stop existing.
      if (options.packCache) {
        const keep = path.join(cacheDir(), vendored.tarball);
        fs.mkdirSync(path.dirname(keep), { recursive: true });
        fs.copyFileSync(produced, keep);
        options.packCache.set(cacheKey, keep);
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
 * Tar a built bundle for transfer.
 *
 * `-C <dir> .` so the archive holds the bundle's contents at its root rather
 * than a directory named after wherever it was built. The unpack step extracts
 * into a version directory it chose; an archive carrying its own top-level
 * name would put everything one level deeper, and every path after that —
 * `dist/cli/omnitron.js`, the symlinks, the install — would be wrong by one
 * segment.
 */
export async function archiveBundle(bundleDir: string, archivePath: string): Promise<string> {
  const resolved = path.resolve(archivePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  await exec('tar', ['-czf', resolved, '-C', path.resolve(bundleDir), '.'], {
    maxBuffer: 16 * 1024 * 1024,
    // `COPYFILE_DISABLE=1`, because macOS `tar` writes an AppleDouble
    // sidecar — `._index.html`, `._dist`, 163 bytes each — for every file
    // carrying an extended attribute. Measured on the test node: they are in
    // every artifact and in the gateway's web root, where `/._index.html` is
    // a 163-byte binary the server will happily hand to anyone who asks.
    // They are this machine's metadata about its own filesystem and they
    // mean nothing on the far side.
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  return resolved;
}

// =============================================================================
// Installing a bundle on a machine
// =============================================================================

/**
 * Where a bundle lands, and how a version becomes the live one.
 *
 *     <prefix>/versions/<version>/     one unpacked bundle, one version
 *     <prefix>/current   →  versions/<version>     a symlink
 *     <prefix>/bin/omnitron  →  current/dist/cli/omnitron.js
 *
 * The indirection is what makes an upgrade reversible. A version is unpacked
 * and installed BESIDE the running one, verified there, and only then does
 * `current` move — one `ln -sfn`, which `rename(2)` makes atomic. Nothing is
 * ever half-installed over the copy that is serving, and going back is the
 * same one command pointed at the previous directory.
 *
 * Installing in place is the alternative, and it fails in the way that costs
 * most: an `npm install` that dies halfway has already replaced some of
 * `node_modules`, so the daemon that was working is now a daemon that cannot
 * start, on a machine somewhere else.
 */
export interface InstallLayout {
  readonly prefix: string;
  readonly version: string;
}

export function versionDir(layout: InstallLayout): string {
  return `${layout.prefix}/versions/${layout.version}`;
}

/** Shell-quote for the remote's POSIX shell. */
function q(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface RemoteStep {
  readonly what: string;
  readonly command: string;
  readonly timeoutMs: number;
}

/**
 * Unpack and install a transferred bundle archive, without disturbing the
 * version that is running.
 *
 * `archivePath` is where the caller put the tarball on the target.
 */
export function installSteps(layout: InstallLayout, archivePath: string): readonly RemoteStep[] {
  const dir = versionDir(layout);
  return [
    {
      what: `unpack ${layout.version}`,
      // Removed first: a directory left by an interrupted earlier attempt
      // would have `npm install` reconcile against a half-unpacked tree, and
      // what comes out of that is not this version.
      command: `rm -rf ${q(dir)} && mkdir -p ${q(dir)} && tar -xzf ${q(archivePath)} -C ${q(dir)}`,
      timeoutMs: 300_000,
    },
    {
      what: 'install dependencies for this machine',
      // `--omit=dev` because a node runs the daemon, it does not build it.
      // `--no-audit --no-fund` because neither says anything about whether
      // the install worked, and both write to stdout a caller has to read
      // past.
      command: `cd ${q(dir)} && npm install --omit=dev --no-audit --no-fund`,
      timeoutMs: 900_000,
    },
    {
      what: 'check that it runs before making it current',
      // The whole reason for the versioned layout. This runs the NEW copy by
      // absolute path, while the old one is still the one serving.
      command: `${q(`${dir}/dist/cli/omnitron.js`)} --version`,
      timeoutMs: 120_000,
    },
  ];
}

/**
 * Make an installed version the live one.
 *
 * Separate from `installSteps` because this is the only step that changes
 * what runs, and a caller that stopped before it has changed nothing.
 */
export function activateSteps(layout: InstallLayout, pathDir = '/usr/local/bin'): readonly RemoteStep[] {
  const dir = versionDir(layout);
  const cli = `${layout.prefix}/current/dist/cli/omnitron.js`;
  return [
    {
      what: `point current at ${layout.version}`,
      // `-n` so a `current` that is already a symlink to a directory is
      // replaced rather than followed — without it the second upgrade
      // creates `current/<version>` inside the first one.
      command:
        `mkdir -p ${q(`${layout.prefix}/bin`)} && ` +
        `ln -sfn ${q(dir)} ${q(`${layout.prefix}/current`)} && ` +
        `ln -sfn ${q(cli)} ${q(`${layout.prefix}/bin/omnitron`)}`,
      timeoutMs: 60_000,
    },
    {
      // The step this design was missing, and the node said so.
      //
      // `<prefix>/bin` is not on anyone's PATH. So after `current` moved, a
      // bare `omnitron` still resolved to whatever was there before — on the
      // test host, the registry copy in the runtime's own bin. The activation
      // then restarted THAT, and the failure it reported was the old version's
      // missing dependency, under a message saying the new version had not
      // come up. Everything was true and nothing pointed at the cause.
      //
      // Guarded like every other link this code makes: only over nothing, or
      // over a symlink, which is what an earlier install of ours leaves. A
      // real binary somebody else put there is kept, and `<prefix>/bin` still
      // has the CLI.
      what: `make omnitron on PATH resolve to ${layout.version}`,
      command:
        `if [ ! -e ${q(`${pathDir}/omnitron`)} ] || [ -L ${q(`${pathDir}/omnitron`)} ]; then ` +
        `ln -sfn ${q(cli)} ${q(`${pathDir}/omnitron`)}; fi`,
      timeoutMs: 60_000,
    },
  ];
}

/**
 * Keep the last `keep` versions and remove the rest.
 *
 * `current` is never removed whatever its age — the sort is by directory
 * name, which for `0.2.0+local.<sha>.<stamp>` is chronological, but a
 * retention that reasons about age must not be the thing that deletes what
 * is running.
 */
export function pruneSteps(layout: InstallLayout, keep: number): readonly RemoteStep[] {
  const versions = `${layout.prefix}/versions`;
  return [
    {
      what: `keep the ${keep} most recent versions`,
      command:
        `cd ${q(versions)} 2>/dev/null || exit 0; ` +
        `CURRENT=$(readlink ${q(`${layout.prefix}/current`)} 2>/dev/null); ` +
        `ls -1 | sort | head -n -${keep} | while read -r v; do ` +
        `[ "${versions}/$v" = "$CURRENT" ] && continue; ` +
        `rm -rf -- "$v"; done; true`,
      timeoutMs: 120_000,
    },
  ];
}
