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
   * What each workspace package's sources hashed to in this run, by directory.
   *
   * Six apps of one stack vendor the same nineteen omnitron packages, and
   * hashing each of them six times is six times the work for a tree that
   * cannot have changed between the first app and the last. Only the reading
   * is memoised here; the packed tarballs are kept by content in
   * `packedCachePath`, which is what makes a package that did not change
   * contribute the identical file to the next bundle.
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
function cacheDir(): string {
  const dir = path.join(os.tmpdir(), 'omnitron-pack-cache');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Where a packed workspace package is kept, named by what is in it.
 *
 * The version is in the name because two versions of one package are two
 * packages; the content hash is in it because during development a version
 * stands still for weeks while the code under it moves, and a cache keyed on
 * the version alone would hand a deployment last week's package under this
 * week's number. Nothing has to be invalidated: a package that changed has a
 * different name here and is packed.
 */
export function packedCachePath(cacheRoot: string, name: string, version: string, contentHash: string): string {
  const flat = name.replace(/^@/, '').replace(/\//g, '-');
  return path.join(cacheRoot, `${flat}-${version}-${contentHash.slice(0, 16)}.tgz`);
}

/**
 * Remove every incremental-build record a package keeps.
 *
 * `tsc` trusts `tsBuildInfoFile`: if the inputs have not changed since that
 * record was written, it emits nothing and exits zero. The record is written
 * by whatever machine last built, and a `build` script of `rm -rf dist && tsc`
 * removes the OUTPUT while leaving the record saying the output is current —
 * so the build succeeds and `dist` stays exactly as stale as it was.
 *
 * Measured on `@daos/bitcoin-rpc`: `src/errors.ts` dated 2026-09-16,
 * `dist/errors.js` dated 2026-09-10, and `pnpm build` leaving it at
 * 2026-09-10. Six days of source changes that the build refused to emit,
 * silently, with a zero exit code — which is why the staleness guard above
 * has to re-check AFTER building rather than trusting the build.
 *
 * Every spelling, because the path is a per-package choice: the root, `dist`,
 * and `node_modules/.tmp`, which is where a `tsconfig.build.json` in this
 * workspace tends to put it.
 */
export function clearBuildInfo(packageDir: string): void {
  const candidates = [
    'tsconfig.tsbuildinfo',
    '.tsbuildinfo',
    'tsconfig.build.tsbuildinfo',
    'dist/tsconfig.tsbuildinfo',
    'dist/.tsbuildinfo',
    'dist/tsconfig.build.tsbuildinfo',
  ];
  for (const rel of candidates) {
    try {
      fs.rmSync(path.join(packageDir, rel), { force: true });
    } catch {
      // Not there, or not ours to remove: the build is what reports.
    }
  }

  // `node_modules/.tmp` is a directory of them, one per tsconfig.
  const tmp = path.join(packageDir, 'node_modules', '.tmp');
  try {
    for (const name of fs.readdirSync(tmp)) {
      if (name.endsWith('.tsbuildinfo')) fs.rmSync(path.join(tmp, name), { force: true });
    }
  } catch {
    // No such directory is the common case.
  }
}

/**
 * The most recently modified file under a directory, by a filter.
 *
 * `node_modules` and `.git` are skipped: neither says anything about whether
 * this project's own output is current, and walking them turns a handful of
 * `stat` calls into tens of thousands.
 */
function newestFile(dir: string, filter: (name: string) => boolean): { file: string; mtime: number } | null {
  let best: { file: string; mtime: number } | null = null;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
        continue;
      }
      if (!filter(entry.name)) continue;
      const mtime = fs.statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) best = { file: full, mtime };
    }
  };
  walk(dir);
  return best;
}

/**
 * Whether a built frontend is older than the sources it was built from.
 *
 * The gateway serves `apps/portal/dist` and the deployment ships it exactly
 * as it finds it. Measured on the test stack: the `index.html` on the node
 * was built on 2026-09-10 and **879 source files were newer than it** — so
 * the "test portal", the thing the whole deployment exists to put in front of
 * someone, was ten days behind the tree it was supposedly testing. Nothing
 * said so, because nothing looked.
 *
 * Same reasoning as `staleDist` and a different shape: a frontend has no
 * manifest pointing at its output, so the caller names both directories.
 *
 * **A frontend's sources are not all under its own `src`.** The portal
 * resolves several workspace packages from source through Vite aliases, two
 * of them in a DIFFERENT repository (`@omnitron-dev/prism`,
 * `@omnitron-dev/netron-browser`), so a change confined to the design system
 * left `apps/portal/src` untouched, this check said «current», and the
 * deployment shipped yesterday's bundle. Measured 2026-09-21: all ten «behind
 * its sources» entries in the daemon log name files under `apps/portal/src`,
 * not one came from prism, while prism changed on several of those days.
 *
 * So the sources are the frontend's own `src` PLUS the `src` of every
 * dependency that resolves outside `node_modules` — which is what a workspace
 * link is. Under pnpm every dependency is a symlink (57 of 57 for the
 * portal), so the symlink itself says nothing; the real path does, and seven
 * of the portal's dependencies live outside `node_modules`.
 *
 * The answer names the directories it watched, because the caller logs it:
 * a reader must be able to tell «no linked sources» from «never looked».
 *
 * **Every linked package counts, even one the frontend imports only for its
 * types.** Measured on the portal: of its seven, `@daos/geo` is type-only (3
 * imports, all `import type`) and contributes nothing to the bundle, so
 * watching it can cost a rebuild nobody needed. Telling types from values
 * statically is an import-parsing heuristic, and the same counting done twice
 * here gave 47 value-imports and then 8 — the difference being multi-line
 * `import type {` blocks whose closing line looks like a value import. The
 * asymmetry decides it: a false rebuild costs a couple of minutes of CPU, a
 * missed one puts yesterday's portal in front of a person.
 */
export function staleBuild(srcDir: string, buildDir: string): string | null {
  if (!fs.existsSync(buildDir)) return 'there is no build at all';
  if (!fs.existsSync(srcDir)) return null;

  const isSource = (n: string): boolean =>
    /\.(ts|tsx|js|jsx|css|scss|html|json|svg|png|jpg|webp)$/.test(n) && !/\.(spec|test)\.[jt]sx?$/.test(n);

  const watched = [srcDir, ...linkedSourceDirs(path.dirname(srcDir))];
  const names = watched.map((d) => path.basename(path.dirname(d)) + '/' + path.basename(d)).join(', ');

  const newestBuilt = newestFile(buildDir, () => true);
  if (!newestBuilt) return 'the build directory is empty';

  let newestSource: { file: string; mtime: number; root: string } | null = null;
  for (const dir of watched) {
    const found = newestFile(dir, isSource);
    if (found && (!newestSource || found.mtime > newestSource.mtime)) {
      newestSource = { ...found, root: dir };
    }
  }
  if (!newestSource) return null;
  if (newestSource.mtime <= newestBuilt.mtime) return null;

  const count = watched.reduce((n, dir) => n + countNewerThan(dir, isSource, newestBuilt.mtime), 0);
  const where = path.relative(newestSource.root, newestSource.file);
  return `${count} source file${count === 1 ? '' : 's'} newer than the build, the most recent being ${where} (watched: ${names})`;
}

/**
 * The `src` of every dependency that lives outside `node_modules`.
 *
 * That is what a workspace link is, and it is the only reliable tell: pnpm
 * makes EVERY dependency a symlink into its store, so `isSymbolicLink()`
 * matches all of them. What separates a package being developed here from one
 * that was installed is where the link lands.
 *
 * A package without a `src/` contributes nothing to look at and is skipped,
 * which also drops anything vendored as built output.
 */
function linkedSourceDirs(pkgDir: string): string[] {
  let manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }

  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const dirs: string[] = [];

  for (const name of names) {
    const linked = path.join(pkgDir, 'node_modules', ...name.split('/'));
    let real: string;
    try {
      real = fs.realpathSync(linked);
    } catch {
      continue;
    }
    if (real.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const src = path.join(real, 'src');
    if (fs.existsSync(src)) dirs.push(src);
  }

  return dirs;
}

/** How many files under `dir` are newer than `mtime` — for a message worth reading. */
function countNewerThan(dir: string, filter: (name: string) => boolean, mtime: number): number {
  let n = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full);
        continue;
      }
      if (filter(entry.name) && fs.statSync(full).mtimeMs > mtime) n += 1;
    }
  };
  walk(dir);
  return n;
}

/**
 * Whether a package's shipped `dist` is older than its sources.
 *
 * Only asked of packages that actually ship one — a package whose manifest
 * points at `src` is consumed as TypeScript by whatever transpiles it, and
 * has no `dist` to be stale. `publishConfig` is consulted because that is
 * what `pnpm pack` applies, so the question is about the file the TARBALL
 * will name, not the one this working tree uses.
 *
 * Returns a sentence naming the newest source file, or null when there is
 * nothing to say — the message is the useful part, since "rebuild it" is
 * only actionable once you know which package and why.
 */
export function staleDist(packageDir: string): string | null {
  let manifest: { main?: string; exports?: unknown; publishConfig?: { main?: string; exports?: unknown } };
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }

  const effective = JSON.stringify({
    main: manifest.publishConfig?.main ?? manifest.main,
    exports: manifest.publishConfig?.exports ?? manifest.exports,
  });
  if (!effective.includes('dist/')) return null;

  const dist = path.join(packageDir, 'dist');
  if (!fs.existsSync(dist)) return 'there is no dist at all';

  const src = path.join(packageDir, 'src');
  if (!fs.existsSync(src)) return null;
  // Tests are not shipped and their timestamps are not evidence about `dist`.
  const newestSource = newestFile(src, (n) => n.endsWith('.ts') && !/\.(spec|test)\.ts$/.test(n));
  const newestBuilt = newestFile(dist, (n) => n.endsWith('.js'));
  if (!newestSource) return null;
  if (!newestBuilt) return 'dist holds no compiled JavaScript';
  if (newestSource.mtime <= newestBuilt.mtime) return null;

  return `${path.relative(packageDir, newestSource.file)} is newer than anything in dist`;
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

    // A package that ships `dist` must have a `dist` that is not older than
    // its sources.
    //
    // `pnpm pack` packs what is on disk. Six daos packages declare
    // `publishConfig.main = dist/…` — because a tarball cannot ship
    // TypeScript and expect `node` to read it — and NOTHING in the workspace
    // imported that `dist`, so it had been drifting since whenever it was
    // last built by hand. Measured the first time one shipped:
    //
    //     The requested module '@daos/titan-kit' does not provide an export
    //     named 'DEFAULT_PAGE_SIZE'
    //
    // — a constant that had been in `src` for months and in `dist` never.
    // Worse than a missing package, because it looks like an API mistake in
    // the code that imports it.
    //
    // Built rather than refused: the deployment already builds the app it is
    // deploying, and a dependency of that app is the same question. A build
    // that fails still stops the artifact.
    for (const vendored of plan.vendored) {
      const dir = directoryOf(workspace.get(vendored.name)!);
      const stale = staleDist(dir);
      if (!stale) continue;
      options.logger?.info(`rebuilding ${vendored.name} — ${stale}`);
      // Without this the build exits zero and changes nothing: see
      // `clearBuildInfo`. It is what made this guard's own rebuild useless
      // on the first package that needed it.
      clearBuildInfo(dir);
      try {
        await exec(resolvePnpm(), ['--dir', dir, 'run', 'build'], {
          cwd: workspaceRoot,
          maxBuffer: 16 * 1024 * 1024,
        });
      } catch (err) {
        throw new Error(
          `${vendored.name} ships 'dist' and its 'dist' is out of date (${stale}), and rebuilding it failed: ` +
            `${(err as Error).message.slice(0, 300)}`,
        );
      }
      // What this package hashed to a moment ago is no longer what it is:
      // the build decision and the packing step both read that number.
      options.packCache?.delete(dir);

      const still = staleDist(dir);
      if (still) {
        throw new Error(
          `${vendored.name} ships 'dist' and its 'dist' is still out of date after a build (${still}). ` +
            `Packing it would put months-old compiled code on a node under a current version number.`,
        );
      }
    }

    // Every workspace package, packed where npm can install it from.
    for (const vendored of plan.vendored) {
      const produced = path.join(staging, VENDOR_DIR, vendored.tarball);
      const dir = directoryOf(workspace.get(vendored.name)!);

      // What is in the package decides whether it is packed again — never
      // when it was last packed. `pnpm pack` resolves `workspace:*` to the
      // concrete version and rebuilds that object in the order it resolved
      // them, so packing one unchanged package twice produced two tarballs
      // differing in the ORDER of `peerDependencies` and nothing else. Every
      // bundle was therefore a new bundle, and a deployment that skips what
      // the node already has could never skip anything.
      let contentHash = options.packCache?.get(dir);
      if (!contentHash) {
        contentHash = await bundleChecksum(dir, { skip: withoutNodeModules });
        options.packCache?.set(dir, contentHash);
      }
      const kept = packedCachePath(cacheDir(), vendored.name, vendored.version, contentHash);
      if (fs.existsSync(kept)) {
        fs.copyFileSync(kept, produced);
        continue;
      }

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

      // Kept where the next bundle can copy it from — this build's, and any
      // later one that finds the package in the same state. The staging
      // directory this file is in is removed at the end, so the cache holds a
      // copy of its own rather than a path that is about to stop existing.
      // Written aside and renamed, because another build may be reading this
      // name while this one writes it and half a tarball is not a tarball.
      const staged = `${kept}.${process.pid}.part`;
      fs.copyFileSync(produced, staged);
      fs.renameSync(staged, kept);
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
    fs.writeFileSync(path.join(staging, BUNDLE_METADATA_FILE), JSON.stringify(metadata, null, 2) + '\n');

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
/** The file a bundle carries about its own making. */
export const BUNDLE_METADATA_FILE = 'BUNDLE.json';

/**
 * The record of the packing, which is not part of what was packed.
 *
 * It carries `builtAt` and a version stamped from the clock, so a bundle
 * that includes it in its identity is a different bundle every time it is
 * built. What it says about the commit and the vendored packages is a
 * statement about the build, and the files those produced are hashed on
 * their own account.
 */
export const isBuildRecord = (relativePath: string): boolean => relativePath === BUNDLE_METADATA_FILE;

/**
 * The name a build gave itself, which is not part of what it built.
 *
 * `localVersion` stamps the minute of the build into the bundle's root
 * manifest — `0.2.0+local.<sha>.202609201755` — so that a node can say which
 * of two builds of one commit it is running. It is also the one thing in a
 * bundle that cannot be the same twice, and comparing bundles with it in
 * hand says "different" about two builds of an untouched tree. Everything
 * else in that manifest decides what gets installed and is compared.
 *
 * Only the bundle's own manifest: a `package.json` below it belongs to a
 * package that travels, and its version is that package's.
 */
export const withoutBuildVersion = {
  appliesTo: (relativePath: string): boolean => relativePath === 'package.json',
  to: (bytes: Buffer): Buffer => {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    } catch {
      // Not a manifest this understands. Hashed as the bytes it is, which is
      // the conservative answer: a bundle nobody can read is not a bundle
      // anybody should call unchanged.
      return bytes;
    }
    delete manifest['version'];
    return Buffer.from(JSON.stringify(manifest));
  },
};

/**
 * Build output, which is what a compiler produces and never what it reads.
 *
 * Matched on the whole last segment, so `dist-tools/` and
 * `node_modules_shim.ts` are sources like any other.
 */
const BUILD_OUTPUT = new Set(['node_modules', 'dist', 'coverage', '.turbo', '.omnitron-build', '.git', '.cache']);
export const withoutBuildOutput = (relativePath: string): boolean =>
  BUILD_OUTPUT.has(relativePath.slice(relativePath.lastIndexOf('/') + 1));

/**
 * Installed dependencies, which are not sources and are not packed.
 *
 * Matched on the whole last segment: `node_modules_shim.ts` is a source file.
 */
export const withoutNodeModules = (relativePath: string): boolean =>
  relativePath === 'node_modules' || relativePath.endsWith('/node_modules');

/**
 * What a bundle IS, independent of when it was packed.
 *
 * The archive cannot answer this. `tar -czf` writes the compression time
 * into the gzip header and every file's own mtime into its entry, and a
 * bundle is assembled into a fresh staging tree on each build, so two packs
 * of byte-identical sources are two different files. A deployment that asks
 * "does the node already have this?" by comparing archive hashes is asking
 * what time it is.
 *
 * So the identity is read from the tree that will travel: every path under
 * it, sorted, each with the bytes at that path, whether it may be executed,
 * and — for a symlink — where it points, which is read rather than followed.
 * Nothing here is a property of this machine or this minute.
 *
 * Framed with NULs and lengths so that no rearrangement of names and bodies
 * can produce the same stream as a different tree.
 */
export async function bundleChecksum(
  bundleDir: string,
  options?: {
    readonly skip?: (relativePath: string) => boolean;
    /** A file to hash as something other than its bytes — see `withoutBuildVersion`. */
    readonly rewrite?: { appliesTo(relativePath: string): boolean; to(bytes: Buffer): Buffer };
  },
): Promise<string> {
  const { createHash } = await import('node:crypto');
  const root = path.resolve(bundleDir);

  const paths: string[] = [];
  const walk = (dir: string): void => {
    // Deliberately unguarded: a directory this cannot read is a bundle this
    // cannot identify, and a hash over the part that happened to be readable
    // would be a confident answer to a question nobody asked.
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (options?.skip?.(rel)) continue;
      paths.push(rel);
      // `isDirectory()` is lstat's answer, so a symlink to a directory is a
      // link here and is never descended into.
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  paths.sort();

  const hash = createHash('sha256');
  for (const rel of paths) {
    const full = path.join(root, rel);
    const stat = fs.lstatSync(full);

    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(full);
      hash.update(`L\0${rel}\0${target.length}\0${target}\0`);
      continue;
    }
    if (stat.isDirectory()) {
      hash.update(`D\0${rel}\0`);
      continue;
    }

    const mode = stat.mode & 0o111 ? 'x' : '-';
    if (options?.rewrite?.appliesTo(rel)) {
      // Framed by the length of what is hashed, not of what is on disk: the
      // original size would put back the difference the rewrite took out.
      const bytes = options.rewrite.to(fs.readFileSync(full));
      hash.update(`F\0${rel}\0${mode}\0${bytes.length}\0`);
      hash.update(bytes);
      continue;
    }

    hash.update(`F\0${rel}\0${mode}\0${stat.size}\0`);
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(full);
      stream.on('data', (chunk) => hash.update(chunk as Buffer));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
  }

  return hash.digest('hex');
}

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

/** The package omnitron itself is — what a node's own upgrade is built from. */
const OMNITRON_PACKAGE = '@omnitron-dev/omnitron';

/**
 * Where one build of omnitron's own bundle is staged.
 *
 * Under the temporary directory and named by the caller's label, so that the
 * console upgrading one node and a `fleet upgrade` running in a terminal
 * never stage into each other's directory.
 */
export function ownBundleStaging(label: string): string {
  return path.join(os.tmpdir(), `omnitron-bundle-${label}`);
}

/** A built bundle of omnitron itself, ready to be packed and installed. */
export interface OwnBundle {
  /** `0.2.0+local.<sha>.<stamp>` — what the node will report once it runs this. */
  readonly version: string;
  /** Whether the tree it was built from had uncommitted changes. */
  readonly dirty: boolean;
  /** Pack it for transfer. The same archive, however often this is called. */
  pack(): Promise<string>;
  /** Remove the staging tree and the archive. Safe to call more than once. */
  cleanup(): Promise<void>;
}

/**
 * Build omnitron from a working tree, for installing on a node.
 *
 * Two callers do this — `omnitron fleet upgrade` from a terminal, and the
 * daemon when the console asks — and each used to write it out: the package
 * name, the staging path, the `buildBundle`/`archiveBundle` pair. The copies
 * had already drifted, in the way copies do: the daemon removed its staging
 * tree in a `finally`, and the CLI left several hundred megabytes in the
 * temporary directory on every run, including every `--dry-run` that shipped
 * nothing at all.
 *
 * Packing is separate from building because a dry run wants the version and
 * not the tarball.
 */
export async function buildOwnBundle(options: {
  readonly workspaceRoot: string;
  /** What distinguishes this build's staging directory from another's. */
  readonly label: string;
  readonly logger?: { info(message: string): void };
}): Promise<OwnBundle> {
  const staging = ownBundleStaging(options.label);
  const archivePath = `${staging}.tar.gz`;
  const built = await buildBundle({
    workspaceRoot: options.workspaceRoot,
    rootPackage: OMNITRON_PACKAGE,
    outDir: staging,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  let packed: Promise<string> | null = null;
  return {
    version: built.metadata.version,
    dirty: built.metadata.dirty,
    pack: () => (packed ??= archiveBundle(built.outDir, archivePath)),
    cleanup: async () => {
      // The staging tree is hundreds of megabytes; leaving it behind fills
      // the temporary directory one upgrade at a time.
      await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await fs.promises.rm(archivePath, { force: true }).catch(() => undefined);
    },
  };
}

/**
 * Everything that decides what an application's compiler emits.
 *
 * The application's own sources, and every workspace package that travels
 * with it — the same closure the bundle vendors, because a package whose
 * code moved changes both what the app compiles against and what ships
 * beside it. A dependency is read whole, sources and `dist` together: which
 * of the two moved is not the question, only whether anything did.
 *
 * `null` for every answer that cannot be had — no workspace above the app, a
 * manifest that will not parse, a plan that refuses. The caller compiles.
 *
 * `memo` is shared with the packing step, which asks the same question of
 * the same directories; `buildBundle` drops an entry for any package it
 * rebuilds, so nothing here outlives the state it measured.
 */
export async function buildInputsChecksum(
  appDir: string,
  options?: {
    readonly additionalWorkspaceRoots?: readonly string[];
    readonly memo?: Map<string, string>;
  },
): Promise<string | null> {
  const workspaceRoot = findWorkspaceRoot(appDir);
  if (!workspaceRoot) return null;

  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
  if (!manifest.name) return null;

  const workspace = readWorkspaces([workspaceRoot, ...(options?.additionalWorkspaceRoots ?? [])]);
  const plan = planBundle(manifest.name, workspace);
  if (plan.refusal) return null;

  const memo = options?.memo;
  const readOnce = async (key: string, dir: string, skip: (rel: string) => boolean): Promise<string> => {
    const seen = memo?.get(key);
    if (seen) return seen;
    const hash = await bundleChecksum(dir, { skip });
    memo?.set(key, hash);
    return hash;
  };

  const parts = [`app ${manifest.name} ${await readOnce(sourcesKey(appDir), appDir, withoutBuildOutput)}`];
  for (const vendored of plan.vendored) {
    const entry = workspace.get(vendored.name);
    if (!entry) return null;
    const dir = directoryOf(entry);
    parts.push(`dep ${vendored.name}@${vendored.version} ${await readOnce(dir, dir, withoutNodeModules)}`);
  }
  parts.sort();

  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

/** The memo key for an app's own sources, which are read without its output. */
const sourcesKey = (appDir: string): string => `sources:${path.resolve(appDir)}`;

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
