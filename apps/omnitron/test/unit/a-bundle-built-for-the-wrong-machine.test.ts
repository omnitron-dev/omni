/**
 * Shipping this working tree to a node, without shipping this machine.
 *
 * The registry channel installs what was published, and on 2026-09-14 that
 * was five months and 224 commits behind the working tree — carrying the same
 * version number, so a node built from it reported `v0.2.0`,
 * indistinguishable from a node built from today's code.
 *
 * The local channel exists for that. Two obvious ways to build it are both
 * wrong, and each is wrong in a way that only appears on the target.
 *
 * `npm pack` produces a tarball whose `workspace:*` ranges npm cannot resolve
 * anywhere but this repository — ten of them directly, fourteen in the
 * transitive closure.
 *
 * `pnpm deploy` produces a self-contained tree, and the tree is for THIS
 * machine. Measured on one deployed from this workstation:
 *
 *     node_modules/.pnpm/@esbuild+darwin-arm64@0.28.2
 *     node_modules/.pnpm/@typescript+typescript-darwin-arm64@7.0.2
 *     node_modules/.pnpm/fsevents@2.3.3
 *
 * `@esbuild/linux-x64` is absent, because this machine never needed it.
 * Unpacked on a Linux node the daemon starts and its build path does not.
 *
 * So: pack each workspace package, rewrite the ranges to the tarballs, and
 * run the install on the target — where the platform-specific packages are
 * resolved by the machine that will run them.
 */

import { describe, it, expect } from 'vitest';

import {
  planBundle,
  bundleRootManifest,
  tarballNameFor,
  isWorkspaceRange,
  localVersion,
  type PackageManifest,
  type Workspace,
} from '../../src/services/local-bundle.js';

/** A workspace as a map, the way `planBundle` takes it. */
function workspace(...manifests: PackageManifest[]): Workspace {
  return new Map(manifests.map((m) => [m.name, m]));
}

const app: PackageManifest = {
  name: '@acme/app',
  version: '1.0.0',
  dependencies: { '@acme/core': 'workspace:*', kysely: '^0.29.5' },
};
const core: PackageManifest = {
  name: '@acme/core',
  version: '2.1.0',
  dependencies: { '@acme/util': 'workspace:^', pg: '^8.0.0' },
};
const util: PackageManifest = { name: '@acme/util', version: '0.5.0' };

const planned = () => planBundle('@acme/app', workspace(app, core, util));

describe('what has to travel with the bundle', () => {
  it('follows workspace ranges through their own dependencies', () => {
    // The closure, not the direct list. `@acme/util` is reached only through
    // `@acme/core`, and a bundle without it installs and fails at the first
    // import.
    const plan = planned();

    expect(plan.vendored.map((v) => v.name)).toEqual(['@acme/core', '@acme/util']);
  });

  it('leaves registry dependencies alone', () => {
    // They resolve on the target, which is the point — that is where the
    // platform-specific ones get chosen for the right platform.
    const root = bundleRootManifest(planned(), '1.0.0') as { dependencies: Record<string, string> };

    expect(root.dependencies['kysely']).toBe('^0.29.5');
    // `pg` belongs to a vendored package, not to the root, and an override
    // does not pull it up.
    expect(root.dependencies['pg']).toBeUndefined();
  });

  it('names each tarball by the version the workspace actually has', () => {
    // `workspace:*` and `workspace:^` say nothing about a version; the
    // workspace does. A name built from the RANGE would produce
    // `acme-util-^.tgz` and a file that does not exist.
    const plan = planned();

    expect(plan.vendored).toEqual([
      { name: '@acme/core', version: '2.1.0', tarball: 'acme-core-2.1.0.tgz' },
      { name: '@acme/util', version: '0.5.0', tarball: 'acme-util-0.5.0.tgz' },
    ]);
  });

  it('overrides every vendored package, including the indirect one', () => {
    // An override replaces a resolution ANYWHERE in the tree, so the entry
    // for `@acme/util` — which the root never names — is what redirects the
    // reference inside `@acme/core`'s own tarball. `pnpm pack` turned that
    // reference into a registry version, which is the copy this channel
    // exists to avoid.
    const plan = planned();

    expect(plan.overrides).toEqual({
      '@acme/core': 'file:./vendor/acme-core-2.1.0.tgz',
      '@acme/util': 'file:./vendor/acme-util-0.5.0.tgz',
    });
  });

  it('gives the root file: dependencies, not overrides alone', () => {
    // An override redirects a resolution; a `workspace:*` range has no
    // resolution to redirect, and npm rejects it before overrides are
    // consulted. The root's own workspace deps have to be `file:` outright.
    const root = bundleRootManifest(planned(), '1.0.0') as { dependencies: Record<string, string> };

    expect(root.dependencies['@acme/core']).toBe('file:./vendor/acme-core-2.1.0.tgz');
  });

  it('leaves no workspace range anywhere in the root manifest', () => {
    // One missed range is one unresolvable install.
    const root = bundleRootManifest(planned(), '1.0.0') as {
      dependencies: Record<string, string>; overrides: Record<string, string>;
    };

    for (const [dep, range] of Object.entries({ ...root.dependencies, ...root.overrides })) {
      expect(isWorkspaceRange(range), dep).toBe(false);
    }
  });

  it('refuses when a workspace range names a package that is not here', () => {
    // Packing what is left produces a bundle that installs and then fails at
    // the first import, on the node, later.
    const plan = planBundle('@acme/app', workspace(app, core));

    expect(plan.refusal).toMatch(/@acme\/util/);
    expect(plan.vendored).toEqual([]);
  });

  it('refuses a root that is not in the workspace', () => {
    expect(planBundle('@acme/nope', workspace(app)).refusal).toMatch(/not a package/);
  });

  it('terminates on a dependency cycle', () => {
    // Workspace packages can and do depend on each other in both directions.
    const a: PackageManifest = { name: 'a', version: '1.0.0', dependencies: { b: 'workspace:*' } };
    const b: PackageManifest = { name: 'b', version: '1.0.0', dependencies: { a: 'workspace:*' } };

    const plan = planBundle('a', workspace(a, b));

    expect(plan.vendored.map((v) => v.name)).toEqual(['b']);
  });

  it('is stable between runs that change nothing', () => {
    // A fleet upgrade compares bundles. Two runs over the same tree must
    // produce the same plan, or every node looks out of date every time.
    expect(JSON.stringify(planned().vendored)).toBe(JSON.stringify(planned().vendored));
  });

  it('carries optional workspace dependencies as well', () => {
    const withOptional: PackageManifest = {
      name: '@acme/app', version: '1.0.0',
      optionalDependencies: { '@acme/util': 'workspace:*' },
    };
    const plan = planBundle('@acme/app', workspace(withOptional, util));

    expect(plan.vendored.map((v) => v.name)).toEqual(['@acme/util']);
    expect(plan.overrides['@acme/util']).toBe('file:./vendor/acme-util-0.5.0.tgz');
  });
});

describe('the manifest the target installs from', () => {
  it('carries the local version, not the workspace one', () => {
    // The workspace says 0.2.0 and so does npm. A bundle that installed under
    // the workspace's version would produce a node reporting a string that
    // says nothing about which of the two it is running.
    const root = bundleRootManifest(planned(), '1.0.0+local.abc.202609141900') as { version: string };

    expect(root.version).toBe('1.0.0+local.abc.202609141900');
  });

  it('is private, because a bundle is not something to publish', () => {
    // `npm install` in a directory whose manifest lacks `private` will
    // happily proceed, but a stray `npm publish` there would push a package
    // whose dependencies are file: paths that exist on one machine.
    expect((bundleRootManifest(planned(), '1.0.0') as { private: boolean }).private).toBe(true);
  });
});

describe('naming a tarball', () => {
  it('turns a scope into something a filesystem accepts', () => {
    expect(tarballNameFor('@omnitron-dev/titan-pm', '0.2.0')).toBe('omnitron-dev-titan-pm-0.2.0.tgz');
    expect(tarballNameFor('kysely', '0.29.5')).toBe('kysely-0.29.5.tgz');
  });
});

describe('telling a local build from a published one', () => {
  it('produces a version no registry build can have', () => {
    const v = localVersion('0.2.0', 'a1b2c3d4e5f6a7b8', new Date(Date.UTC(2026, 8, 14, 19, 5)));

    expect(v).toBe('0.2.0+local.a1b2c3d4e5f6.202609141905');
  });

  it('is still the same version for anything that compares versions', () => {
    // Build metadata is ignored in semver precedence, so a range like
    // `^0.2.0` still matches and nothing that reasons about versions is
    // confused — while two builds remain visibly different strings.
    const v = localVersion('0.2.0', 'abc', new Date());

    expect(v.split('+')[0]).toBe('0.2.0');
  });

  it('keeps only characters build metadata may hold', () => {
    // A branch name or a dirty marker would otherwise put `/` or `+` into a
    // field that allows neither, and the result is not a semver at all.
    const v = localVersion('0.2.0', 'feature/thing-42', new Date(Date.UTC(2026, 0, 2, 3, 4)));

    expect(v).toMatch(/^0\.2\.0\+local\.[0-9A-Za-z]+\.\d{12}$/);
  });

  it('says so when there is no commit to name', () => {
    const v = localVersion('0.2.0', '', new Date(Date.UTC(2026, 0, 2, 3, 4)));

    expect(v).toContain('nocommit');
  });

  it('distinguishes two builds a minute apart', () => {
    const a = localVersion('0.2.0', 'abc', new Date(Date.UTC(2026, 0, 2, 3, 4)));
    const b = localVersion('0.2.0', 'abc', new Date(Date.UTC(2026, 0, 2, 3, 5)));

    expect(a).not.toBe(b);
  });
});
