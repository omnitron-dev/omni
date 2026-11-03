import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readFrameworkLayout } from '../../src/release/layout.js';

const core = '@omnitron-dev/omnitron';
const file = 'vendor/omnitron-0.3.1.tgz';
const integrity = 'sha512-' + createHash('sha512').update('fixture bytes').digest('base64');
const version = '0.3.1';
const peers = '(@scope/plugin@1.0.0(peer@2.0.0))(cache@3.0.0)';
const archive = (file: string) => ({ version, resolution: { integrity, tarball: 'file:' + file } });
const lock = (file: string) => ({
  importers: {
    '.': { dependencies: { [core]: { specifier: 'file:' + file, version: 'file:' + file } } },
    'apps/api': { dependencies: { [core]: { specifier: 'file:../../' + file, version: 'file:' + file + peers } } },
  },
  packages: { [core + '@file:' + file]: archive(file) },
  snapshots: { [core + '@file:' + file]: {}, [core + '@file:' + file + peers]: {} },
});

describe('framework archives in the registered project commit', () => {
  it('matches root-relative file versions and exact peer snapshots across workspace importers', () => {
    const layout = readFrameworkLayout(JSON.stringify(lock(file)));
    expect(layout).toEqual({
      kind: 'vendored', importers: ['.', 'apps/api'],
      packages: [{ name: core, version, file, integrity }],
    });
  });

  it.each(['/tmp/p.tgz', '../p.tgz', './p.tgz', 'vendor/a/../p.tgz', 'vendor//p.tgz', 'vendor/./p.tgz',
    'C:/p.tgz', 'vendor\\p.tgz', 'v%2fother/p.tgz', 'vendor/p.tgz#other', 'vendor/p.tar', 'vendor/p.tgz(peer)'])(
    'refuses ambiguous or external package locators %s', unsafe => {
      expect(() => readFrameworkLayout(JSON.stringify(lock(unsafe)))).toThrow();
    },
  );

  it('ties both the tarball locator and SHA-512 to the package entry', () => {
    for (const invalid of [
      { ...archive(file), resolution: { integrity, tarball: 'file:vendor/other.tgz' } },
      { ...archive(file), version: '~0.3.1' },
      { ...archive(file), resolution: { tarball: 'file:' + file } },
      { ...archive(file), resolution: { integrity: 'sha256-' + 'A'.repeat(44), tarball: 'file:' + file } },
      { ...archive(file), resolution: { integrity: 'sha512-' + 'A'.repeat(85) + 'B==', tarball: 'file:' + file } },
      { ...archive(file), resolution: { integrity, tarball: 'file:' + file, directory: 'other' } },
    ]) {
      expect(() => readFrameworkLayout(JSON.stringify({ ...lock(file), packages: { [core + '@file:' + file]: invalid } }))).toThrow();
    }
  });

  it('requires each importer to reference exactly the frozen archive and peer snapshot', () => {
    for (const replacement of ['file:vendor/other.tgz', 'file:' + file + '(unlocked@1)', '0.3.1', 'link:../omni']) {
      const fixture = lock(file);
      fixture.importers['apps/api'].dependencies[core]!.version = replacement;
      expect(() => readFrameworkLayout(JSON.stringify(fixture))).toThrow();
    }
    const fixture = lock(file);
    fixture.importers['apps/api'].dependencies[core]!.specifier = 'file:../../../external/archive.tgz';
    expect(() => readFrameworkLayout(JSON.stringify(fixture))).toThrow();
  });

  it('refuses npm, external checkouts, patches and duplicate names or paths', () => {
    const fixture = lock(file);
    const extra = (key: string, entry: unknown) => ({
      ...fixture, packages: { ...fixture.packages, [key]: entry },
    });
    for (const invalid of [
      extra('@omnitron-dev/titan@0.3.1', { resolution: { integrity } }),
      extra('@omnitron-dev/titan@file:' + file, archive(file)),
      extra(core + '@file:second.tgz', archive('second.tgz')),
      { ...fixture, patchedDependencies: { [core + '@0.3.1']: { hash: 'x' } } },
      { ...fixture, importers: { ...fixture.importers, tool: {
        dependencies: { '@omnitron-dev/titan': { version: 'link:../../omni/packages/titan' } },
      } } },
    ]) expect(() => readFrameworkLayout(JSON.stringify(invalid))).toThrow();
  });
});
