/**
 * Every artifact carried twenty-three symlinks into a home directory.
 *
 * The apps of a remote stack declare omnitron's packages by path:
 *
 *     "@omnitron-dev/titan": "link:/Users/taaliman/projects/.../packages/titan"
 *
 * `pnpm deploy --prod --legacy` was asked to produce a self-contained tree and
 * did, for everything except those. A `link:` range is an instruction to
 * symlink a directory, and pnpm carried it out — relative to where the deploy
 * tree happened to sit, which on the node meant ten `..` segments climbing
 * past `/` into `/Users/taaliman`. Measured on the test node:
 *
 *     $ ls node_modules/@omnitron-dev/
 *     common  titan  titan-auth  titan-cache  titan-database  ... (all present)
 *     $ ls node_modules/@omnitron-dev/titan/
 *     ls: cannot access '...': No such file or directory
 *     $ find node_modules -type l ! -exec test -e {} \; -print | wc -l
 *     23
 *
 * Two guards looked at this and passed it. The builder's was
 * `existsSync(deployDir + '/node_modules')`; the deployer's was
 * `test -d node_modules && echo present`. A directory of dangling symlinks
 * satisfies both, because a dangling symlink is an entry that exists. So did
 * my own round-trip check, which confirmed `node_modules/@omnitron-dev/titan`
 * was "на месте" — `ls` of the PARENT, never of the entry.
 *
 * `--legacy` was itself the warning, read backwards. Without it pnpm 10
 * refuses the deploy and asks for `inject-workspace-packages` — the setting
 * that makes a deploy self-contained. The flag silenced the refusal and left
 * the tree the refusal was about.
 *
 * The answer is the one the daemon's own bundle has used all along: pack each
 * such dependency with `pnpm pack`, rewrite the manifest to install those
 * tarballs, and let `npm install` run on the node — the only machine that
 * knows it is Linux, which is also what decides between `@esbuild/darwin-arm64`
 * and `@esbuild/linux-x64`.
 *
 * Measured after the change, on `linux/amd64` with the app's real artifact:
 * 21 packages vendored, 0 broken symlinks, and `import('dist/bootstrap.js')`
 * returning instead of throwing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  isLinkRange,
  isVendorableRange,
  isWorkspaceRange,
  planBundle,
  bundleRootManifest,
  type PackageManifest,
  type Workspace,
} from '../../src/services/local-bundle.js';
import { assertNothingEscapes } from '../../src/project/artifact-builder.js';

const manifest = (name: string, deps: Record<string, string> = {}): PackageManifest & { __dir?: string } => ({
  name,
  version: '0.0.1',
  dependencies: deps,
  __dir: `/repo/${name.replace(/^@/, '').replace(/\//g, '-')}`,
});

describe('a dependency that names a directory cannot travel', () => {
  it('reads both spellings as one question', () => {
    expect(isWorkspaceRange('workspace:*')).toBe(true);
    expect(isLinkRange('link:/Users/taaliman/projects/omni/packages/titan')).toBe(true);

    // The predicate the planner actually asks. `workspace:` was the only one
    // it knew, which is why a `link:` range was not followed, not packed, and
    // not rewritten — three omissions from one missing case.
    expect(isVendorableRange('workspace:*')).toBe(true);
    expect(isVendorableRange('link:../packages/titan')).toBe(true);
    expect(isVendorableRange('link:/abs/path')).toBe(true);
  });

  it('leaves a registry range alone', () => {
    // The distinction that matters: a version range is resolved by the node's
    // own install, for the node's own platform. Vendoring those would ship
    // this machine's binaries.
    expect(isVendorableRange('^1.2.3')).toBe(false);
    expect(isVendorableRange('1.2.3')).toBe(false);
    expect(isVendorableRange('npm:other@1.0.0')).toBe(false);
    expect(isVendorableRange('file:./vendor/x.tgz')).toBe(false);
  });
});

describe('the closure follows a link out of the repository', () => {
  const workspace: Workspace = new Map([
    ['@daos/main', manifest('@daos/main', {
      '@daos/titan-kit': 'workspace:*',
      '@omnitron-dev/omnitron': 'link:/Users/taaliman/projects/omni/apps/omnitron',
      ioredis: '^5.11.1',
    })],
    ['@daos/titan-kit', manifest('@daos/titan-kit', { '@omnitron-dev/titan-cache': 'link:/Users/taaliman/projects/omni/packages/titan-cache' })],
    ['@omnitron-dev/omnitron', manifest('@omnitron-dev/omnitron', { '@omnitron-dev/titan': 'workspace:*' })],
    ['@omnitron-dev/titan-cache', manifest('@omnitron-dev/titan-cache')],
    ['@omnitron-dev/titan', manifest('@omnitron-dev/titan')],
  ]);

  it('packs every package reachable by either spelling', () => {
    const plan = planBundle('@daos/main', workspace);

    expect(plan.refusal).toBeUndefined();
    expect(plan.vendored.map((v) => v.name).sort()).toEqual([
      '@daos/titan-kit',
      '@omnitron-dev/omnitron',
      '@omnitron-dev/titan',
      '@omnitron-dev/titan-cache',
    ]);
  });

  it('reaches a package only a linked package needs', () => {
    // `@omnitron-dev/titan` is named by nothing in the app's own manifest. It
    // is reached through `@omnitron-dev/omnitron`, which is reached through a
    // `link:` — so a planner that stops at `workspace:` never sees it, and the
    // node installs the REGISTRY copy of a package this channel exists to
    // replace.
    const plan = planBundle('@daos/main', workspace);
    expect(plan.vendored.map((v) => v.name)).toContain('@omnitron-dev/titan');
  });

  it('leaves the registry dependency for the node to resolve', () => {
    const plan = planBundle('@daos/main', workspace);
    expect(plan.vendored.map((v) => v.name)).not.toContain('ioredis');
    expect(bundleRootManifest(plan, '1.0.0')['dependencies']).toMatchObject({ ioredis: '^5.11.1' });
  });

  it('rewrites the link into a tarball the node can install', () => {
    const deps = bundleRootManifest(planBundle('@daos/main', workspace), '1.0.0')['dependencies'] as Record<
      string,
      string
    >;

    // The assertion the defect fails: an unrewritten `link:` reaches npm on
    // the node, which reads it as a path to symlink and creates another link
    // to nothing.
    expect(deps['@omnitron-dev/omnitron']).toBe('file:./vendor/omnitron-dev-omnitron-0.0.1.tgz');
    expect(deps['@daos/titan-kit']).toBe('file:./vendor/daos-titan-kit-0.0.1.tgz');
    for (const range of Object.values(deps)) expect(isVendorableRange(range)).toBe(false);
  });

  it('says which package it could not find rather than packing what is left', () => {
    const partial: Workspace = new Map([
      ['@daos/main', manifest('@daos/main', { '@omnitron-dev/titan': 'link:/gone/packages/titan' })],
    ]);
    const plan = planBundle('@daos/main', partial);

    expect(plan.refusal).toContain('@omnitron-dev/titan');
    expect(plan.vendored).toEqual([]);
  });
});

describe('an artifact is refused before it ships, not after it lands', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-escape-'));
    fs.mkdirSync(path.join(dir, 'vendor'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'bootstrap.js'), 'export default 1;\n');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (m: Record<string, unknown>): void =>
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(m, null, 2));

  it('accepts one that stands on its own', () => {
    fs.writeFileSync(path.join(dir, 'vendor', 'omnitron-dev-titan-0.2.0.tgz'), 'x');
    write({
      name: '@daos/geo',
      dependencies: { '@omnitron-dev/titan': 'file:./vendor/omnitron-dev-titan-0.2.0.tgz', ioredis: '^5.11.1' },
      overrides: { '@omnitron-dev/titan': 'file:./vendor/omnitron-dev-titan-0.2.0.tgz' },
    });

    expect(() => assertNothingEscapes(dir)).not.toThrow();
  });

  it('refuses a symlink that leaves it', () => {
    // The exact shape that shipped: a relative chain long enough to climb out
    // of the artifact, resolving to a directory that happens to exist HERE.
    write({ name: '@daos/geo', dependencies: {} });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'));
    fs.mkdirSync(path.join(dir, 'node_modules', '@omnitron-dev'), { recursive: true });
    fs.symlinkSync(outside, path.join(dir, 'node_modules', '@omnitron-dev', 'titan'));

    try {
      expect(() => assertNothingEscapes(dir)).toThrow(/symlink leaves the artifact/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('refuses one that points at nothing at all', () => {
    // What the same link looks like on the node. Both readings are caught,
    // because which one you get depends only on whether the builder and the
    // target happen to share a filesystem.
    write({ name: '@daos/geo', dependencies: {} });
    fs.mkdirSync(path.join(dir, 'node_modules', '@omnitron-dev'), { recursive: true });
    fs.symlinkSync(
      '../../../../../../../../../../Users/taaliman/projects/omni/packages/titan',
      path.join(dir, 'node_modules', '@omnitron-dev', 'titan'),
    );

    expect(() => assertNothingEscapes(dir)).toThrow(/symlink leaves the artifact/);
  });

  it('refuses a range that still names a directory', () => {
    write({ name: '@daos/geo', dependencies: { '@omnitron-dev/titan': 'link:/Users/taaliman/omni/packages/titan' } });

    expect(() => assertNothingEscapes(dir)).toThrow(/dependency still names a directory/);
  });

  it('refuses an override pointing at a tarball nothing packed', () => {
    // Quietest of the three: npm resolves the package from the registry
    // instead, the install succeeds, and the node runs a PUBLISHED version of
    // the code this channel exists to replace — five months behind, under the
    // same version number.
    write({
      name: '@daos/geo',
      dependencies: { '@omnitron-dev/titan': 'file:./vendor/omnitron-dev-titan-0.2.0.tgz' },
      overrides: { '@omnitron-dev/titan': 'file:./vendor/omnitron-dev-titan-0.2.0.tgz' },
    });

    expect(() => assertNothingEscapes(dir)).toThrow(/tarball that was not packed/);
  });

  it('allows a symlink that stays inside', () => {
    // `node_modules/.bin/foo -> ../pkg/cli.js` is ordinary and portable. A
    // check that refused every symlink would refuse every real install.
    fs.writeFileSync(path.join(dir, 'vendor', 'omnitron-dev-titan-0.2.0.tgz'), 'x');
    write({
      name: '@daos/geo',
      dependencies: { '@omnitron-dev/titan': 'file:./vendor/omnitron-dev-titan-0.2.0.tgz' },
    });
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    fs.symlinkSync('../../dist/bootstrap.js', path.join(dir, 'node_modules', '.bin', 'geo'));

    expect(() => assertNothingEscapes(dir)).not.toThrow();
  });
});
