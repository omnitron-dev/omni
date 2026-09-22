/**
 * Shipping the omnitron in this working tree to a node, instead of the one on
 * npm.
 *
 * The registry channel installs `@omnitron-dev/omnitron` and whatever it
 * depends on. That is the right default and it has one property an operator
 * cannot change: it ships what was published. Measured 2026-09-14, the
 * published version was five months and 224 commits behind the working tree
 * and carried the same version number, so a node built from it reported
 * `v0.2.0` — indistinguishable from a node built from today's code.
 *
 * This is the other channel: build here, ship that.
 *
 * ## Why it is not `npm pack`
 *
 * `apps/omnitron` declares ten workspace dependencies, and they declare four
 * more between them — fourteen packages that resolve inside this repository
 * and nowhere else. A tarball of the app alone carries `workspace:*` ranges
 * that npm on the far side cannot resolve at all.
 *
 * ## Why it is not `pnpm deploy`
 *
 * It exists, it produces a self-contained tree with `node_modules`, and
 * shipping that tree is wrong in a way that only shows up on the target.
 * Measured on a tree deployed from this machine:
 *
 *     node_modules/.pnpm/@esbuild+darwin-arm64@0.28.2
 *     node_modules/.pnpm/@typescript+typescript-darwin-arm64@7.0.2
 *     node_modules/.pnpm/fsevents@2.3.3
 *
 * Every one of those is for the machine that built it. `@esbuild/linux-x64`
 * is not in the tree, because this machine never needed it. Unpacked on a
 * Linux node the daemon starts and its build path does not, and the reason is
 * three directories deep in a tarball nobody opens.
 *
 * ## What this does instead
 *
 * Pack each workspace package with `pnpm pack`, and let `npm install` run ON
 * THE TARGET. The platform-specific packages are then resolved for the
 * platform that will run them, which is the only place that knows what it is.
 *
 * The redirection is npm's own `overrides`, not a rewrite of our own.
 * `pnpm pack` already turns `workspace:*` into the exact version — but that
 * is a REGISTRY reference, so an install would fetch the published
 * `@omnitron-dev/common@0.2.0`, which is the copy this channel exists to
 * avoid. An `overrides` entry replaces the resolution of a package everywhere
 * in the tree, transitively, which is exactly the shape of the problem.
 *
 * Measured before building on it: six packages, one of them reached only
 * through another, all six resolved `file:vendor/…` in the lockfile, and
 * `import('@omnitron-dev/titan')` returned its 33 exports.
 */

/** Minimal shape of the package.json fields this reads. */
export interface PackageManifest {
  name: string;
  version: string;
  dependencies?: Record<string, string> | undefined;
  optionalDependencies?: Record<string, string> | undefined;
}

/** Everything the workspace holds, by package name. */
export type Workspace = ReadonlyMap<string, PackageManifest>;

/** A workspace package that has to travel with the bundle. */
export interface VendoredPackage {
  readonly name: string;
  readonly version: string;
  /** File name inside the bundle's `vendor/` directory. */
  readonly tarball: string;
}

export interface BundlePlan {
  readonly root: PackageManifest;
  /** Transitive closure of workspace dependencies, in a stable order. */
  readonly vendored: readonly VendoredPackage[];
  /**
   * The `overrides` map for the bundle's root `package.json`.
   *
   * npm applies these to the whole tree, so one entry per workspace package
   * redirects every reference to it — including the ones inside the vendored
   * tarballs, which `pnpm pack` left pointing at registry versions.
   */
  readonly overrides: Readonly<Record<string, string>>;
  readonly refusal?: string;
}

/** `workspace:*`, `workspace:^`, `workspace:1.2.3` — all of them. */
export function isWorkspaceRange(range: string): boolean {
  return typeof range === 'string' && range.startsWith('workspace:');
}

/**
 * `link:../packages/titan`, `link:/abs/path/to/titan`.
 *
 * pnpm's `link:` means "symlink this directory, do not copy it and do not
 * install its dependencies". That is the right answer while the directory is
 * on the same machine, and the only possible answer while it is not is that
 * nothing resolves.
 */
export function isLinkRange(range: string): boolean {
  return typeof range === 'string' && range.startsWith('link:');
}

/**
 * A dependency that has to travel as a tarball, because no registry has it.
 *
 * Both spellings name a directory on the developer's machine, and both
 * produce a symlink in an installed tree. The difference — a `workspace:`
 * range names a package of THIS repository, a `link:` range names a path,
 * usually a sibling checkout — matters to pnpm and not at all here: a
 * directory cannot be shipped by reference to a machine that does not have it.
 *
 * Measured, and the reason this predicate exists: an artifact built for the
 * test node carried twenty-three symlinks of the form
 *
 *     node_modules/@omnitron-dev/titan
 *       -> ../../../../../../../../../../Users/taaliman/projects/.../packages/titan
 *
 * — ten `..` segments, which climb past `/` and land in a home directory that
 * exists on exactly one computer. `ls` showed every entry present; `ls
 * <entry>/` answered `No such file or directory`. Every app on the node failed
 * at its first import, and the builder's own check — `existsSync(node_modules)`
 * — could not see it, because a dangling symlink is an entry that exists.
 */
export function isVendorableRange(range: string): boolean {
  return isWorkspaceRange(range) || isLinkRange(range);
}

/** A tarball name that is a safe file name and identifies the package. */
export function tarballNameFor(name: string, version: string): string {
  // `@omnitron-dev/titan-pm` → `omnitron-dev-titan-pm-0.2.0.tgz`, which is
  // what `npm pack` produces, minus the leading `@`.
  return `${name.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
}

/**
 * Work out what has to be packed, and what each manifest becomes.
 *
 * Pure: the workspace is passed in. The caller reads it from disk, which is
 * the part that cannot be tested without one.
 */
export function planBundle(rootName: string, workspace: Workspace): BundlePlan {
  const root = workspace.get(rootName);
  if (!root) {
    // The refusal names the PLACE, not only the package. Run from another
    // project's repository — `cd ~/projects/dao/daos && omnitron fleet
    // upgrade` — the old sentence was «@omnitron-dev/omnitron is not a
    // package in this workspace», which is true of that workspace and reads
    // as a broken omnitron checkout. `commands/fleet.ts` guards the
    // neighbouring case, a cwd with NO workspace above it, and its comment
    // describes this exact trap; a cwd with somebody ELSE'S workspace above
    // it walks past that guard and arrives here, in the same words.
    const names = [...workspace.keys()];
    const found =
      names.length === 0
        ? 'that workspace declares no packages at all'
        : `that workspace holds ${names.length} package${names.length === 1 ? '' : 's'}, ` +
          `including ${names.slice(0, 2).join(', ')}`;
    return {
      root: { name: rootName, version: '0.0.0' },
      vendored: [],
      overrides: {},
      refusal: `${rootName} is not a package in this workspace — ${found}.`,
    };
  }

  // Breadth-first over workspace ranges, so the closure is complete and the
  // order is stable. A `dependencies` map is iterated in insertion order and
  // the queue preserves it, which keeps a bundle byte-identical between runs
  // that change nothing — an identity a fleet upgrade can compare.
  const closure: string[] = [];
  const seen = new Set<string>([rootName]);
  const queue: string[] = [...workspaceDepsOf(root)];
  const missing: string[] = [];

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);

    const manifest = workspace.get(name);
    if (!manifest) {
      // A `workspace:*` range naming a package the workspace does not have.
      // Packing what is left would produce a bundle that installs and then
      // fails at the first import — reported instead.
      missing.push(name);
      continue;
    }
    closure.push(name);
    for (const dep of workspaceDepsOf(manifest)) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }

  if (missing.length > 0) {
    return {
      root,
      vendored: [],
      overrides: {},
      refusal:
        `These packages are required through a workspace range and are not in this workspace: ` +
        `${missing.join(', ')}.`,
    };
  }

  const vendored = closure.map((name) => {
    const m = workspace.get(name)!;
    return { name, version: m.version, tarball: tarballNameFor(name, m.version) };
  });

  // One entry per vendored package. npm resolves an override anywhere the
  // package appears, so a dependency three levels down inside a tarball is
  // redirected by the same line as a direct one.
  const overrides: Record<string, string> = {};
  for (const v of vendored) overrides[v.name] = `file:./${VENDOR_DIR}/${v.tarball}`;

  return { root, vendored, overrides };
}

/** Where the tarballs sit inside a bundle. */
export const VENDOR_DIR = 'vendor';

/**
 * The root `package.json` a bundle installs from.
 *
 * Its own function so the file that decides what the target installs can be
 * read in a test. The root's direct workspace dependencies are given as
 * `file:` too: an `overrides` entry redirects a resolution, and a
 * `workspace:*` range has no resolution to redirect — npm rejects it before
 * overrides are consulted. The same is true of `link:`, which npm reads as a
 * path it is supposed to symlink; on the target that path is not there.
 */
export function bundleRootManifest(plan: BundlePlan, version: string): Record<string, unknown> {
  const dependencies: Record<string, string> = {};
  for (const [name, range] of Object.entries(plan.root.dependencies ?? {})) {
    dependencies[name] = isVendorableRange(range) ? (plan.overrides[name] ?? range) : range;
  }

  return {
    name: plan.root.name,
    version,
    private: true,
    type: 'module',
    dependencies,
    overrides: plan.overrides,
  };
}

function workspaceDepsOf(manifest: PackageManifest): string[] {
  const out: string[] = [];
  for (const group of [manifest.dependencies, manifest.optionalDependencies]) {
    for (const [name, range] of Object.entries(group ?? {})) {
      if (isVendorableRange(range)) out.push(name);
    }
  }
  return out;
}

/**
 * The identity of a locally built bundle.
 *
 * `0.2.0` on npm and `0.2.0` in this tree are two different programs. A node
 * running either reports the same string, so "which of my nodes are behind"
 * has no answer and `fleet upgrade` cannot know whom to upgrade.
 *
 * Build metadata (`+local.<sha>.<stamp>`) is the semver-legal way to say
 * this: comparison ignores everything after `+`, so nothing that reasons
 * about versions is confused by it, while two builds are still visibly
 * different strings.
 */
export function localVersion(baseVersion: string, commit: string, at: Date): string {
  const stamp =
    at.getUTCFullYear().toString() +
    String(at.getUTCMonth() + 1).padStart(2, '0') +
    String(at.getUTCDate()).padStart(2, '0') +
    String(at.getUTCHours()).padStart(2, '0') +
    String(at.getUTCMinutes()).padStart(2, '0');
  // Build metadata may hold only alphanumerics, dots and dashes.
  const sha = commit.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12) || 'nocommit';
  return `${baseVersion}+local.${sha}.${stamp}`;
}
