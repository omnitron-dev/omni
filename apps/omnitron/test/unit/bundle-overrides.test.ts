import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { copyBundleOverride, readBundleOverrides } from '../../src/services/bundle-overrides.js';
import { buildInputsChecksum } from '../../src/services/bundle-builder.js';
import { bundleRootManifest, planBundle } from '../../src/services/local-bundle.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});
function fixture(overrides: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-overrides-'));
  directories.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), `overrides: ${JSON.stringify(overrides)}\npackages: []\n`);
  return root;
}
function archive(root: string, name: string) {
  fs.mkdirSync(path.join(root, 'package'));
  fs.writeFileSync(path.join(root, 'package/package.json'), JSON.stringify({ name, version: '1.0.0' }));
  fs.writeFileSync(path.join(root, 'package/index.js'), 'export const newlyAddedExport = true;');
  execFileSync('tar', ['-czf', path.join(root, 'dependency.tgz'), '-C', root, 'package']);
}
it('preserves local archives and registry pins, including direct and optional dependencies', async () => {
  const root = fixture({ '@example/dependency': 'file:dependency.tgz', 'registry-package': '2.0.0' });
  archive(root, '@example/dependency');
  const result = await readBundleOverrides([root]);
  expect(result.archives).toHaveLength(1);
  expect(result.archives[0]).toMatchObject({ name: '@example/dependency', version: '1.0.0' });
  expect(result.archives[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
  const base = planBundle(
    'app',
    new Map([
      [
        'app',
        {
          name: 'app',
          version: '1.0.0',
          dependencies: { '@example/dependency': '^1.0.0' },
          optionalDependencies: { 'registry-package': '^1.0.0' },
        },
      ],
    ])
  );
  const manifest = bundleRootManifest({ ...base, overrides: result.overrides }, '1.0.0');
  expect(manifest.dependencies).toEqual({ '@example/dependency': result.overrides['@example/dependency'] });
  expect(manifest.optionalDependencies).toEqual({ 'registry-package': '2.0.0' });
});
it('refuses a mismatched archive instead of fetching a registry replacement', async () => {
  const root = fixture({ '@example/dependency': 'file:dependency.tgz' });
  archive(root, '@example/other');
  await expect(readBundleOverrides([root])).rejects.toThrow(/different package/);
});
it('refuses local dependencies escaping their workspace through a symlink', async () => {
  const source = fixture({});
  archive(source, '@example/dependency');
  const root = fixture({ '@example/dependency': 'file:dependency.tgz' });
  fs.symlinkSync(path.join(source, 'dependency.tgz'), path.join(root, 'dependency.tgz'));
  await expect(readBundleOverrides([root])).rejects.toThrow(/inside its source workspace/);
});

it('refuses an archive changed between planning and packing', async () => {
  const root = fixture({ '@example/dependency': 'file:dependency.tgz' });
  archive(root, '@example/dependency');
  const result = await readBundleOverrides([root]);
  const dependency = result.archives[0]!;
  fs.appendFileSync(dependency.source, 'changed');
  const output = path.join(root, 'vendor');
  fs.mkdirSync(output);
  expect(() => copyBundleOverride(dependency, output)).toThrow(/changed while/);
  expect(fs.readdirSync(output)).toEqual([]);
});

it('invalidates build reuse when a dependency archive or lockfile changes', async () => {
  const root = fixture({ '@example/dependency': 'file:dependency.tgz' });
  archive(root, '@example/dependency');
  const app = path.join(root, 'apps/app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify({ name: 'app', version: '1.0.0', dependencies: { '@example/dependency': '^1.0.0' } })
  );
  const before = await buildInputsChecksum(app);
  expect(before).not.toBeNull();
  fs.writeFileSync(path.join(root, 'package/index.js'), 'export const newlyAddedExport = false;');
  execFileSync('tar', ['-czf', path.join(root, 'dependency.tgz'), '-C', root, 'package']);
  const after = await buildInputsChecksum(app);
  expect(after).not.toBe(before);
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  expect(await buildInputsChecksum(app)).not.toBe(after);
});
