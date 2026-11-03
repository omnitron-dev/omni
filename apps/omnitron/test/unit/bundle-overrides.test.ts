import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { copyBundleOverride, readBundleOverrides, readWorkspaceOverrideInputs } from '../../src/services/bundle-overrides.js';
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
  expect(manifest['dependencies']).toEqual({ '@example/dependency': result.overrides['@example/dependency'] });
  expect(manifest['optionalDependencies']).toEqual({ 'registry-package': '2.0.0' });
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

it('hashes the native pnpm resolution contract without translating parent, alias, removal or version selectors', async () => {
  const overrides = {
    '@parent/core@^2>child': 'npm:@fork/child@3.2.4',
    'renderer>math': '0.19.0',
    'optional-helper:optional': '-',
    '@example/dependency@1.0.0': 'file:dependency.tgz',
  };
  const root = fixture(overrides);
  archive(root, '@example/dependency');
  const app = path.join(root, 'apps/app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
  const inputs = await readWorkspaceOverrideInputs([root]);
  expect(inputs.overrides).toEqual(overrides);
  expect(inputs.archives).toHaveLength(1);
  expect(inputs.archives[0]).toMatchObject({ selector: '@example/dependency@1.0.0', name: '@example/dependency' });
  const before = await buildInputsChecksum(app);
  expect(before).toMatch(/^[a-f0-9]{64}$/);
  expect(await buildInputsChecksum(app)).toBe(before);

  // Same path, manifest, version and selector; only archive contents change.
  fs.writeFileSync(path.join(root, 'package/index.js'), 'export const newlyAddedExport = false;');
  execFileSync('tar', ['-czf', path.join(root, 'dependency.tgz'), '-C', root, 'package']);
  const changedBytes = await buildInputsChecksum(app);
  expect(changedBytes).not.toBe(before);
  const changedRule = { ...overrides, 'renderer>math': '0.19.1' };
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), `overrides: ${JSON.stringify(changedRule)}\npackages: []\n`);
  const changedSelection = await buildInputsChecksum(app);
  expect(changedSelection).not.toBe(changedBytes);
  const reordered = Object.fromEntries(Object.entries(changedRule).reverse());
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), `overrides: ${JSON.stringify(reordered)}\npackages: []\n`);
  const changedOrder = await buildInputsChecksum(app);
  expect(changedOrder).not.toBe(changedSelection);
  expect(await buildInputsChecksum(app)).toBe(changedOrder);
});

it('retains primary workspace precedence without losing distinct contextual rules', async () => {
  const first = fixture({ 'parent>child': '1.0.0', child: '2.0.0' });
  const second = fixture({ 'parent>child': '3.0.0', 'other>child': '4.0.0' });
  const result = await readWorkspaceOverrideInputs([first, second]);
  expect(result.overrides).toEqual({ 'parent>child': '1.0.0', child: '2.0.0', 'other>child': '4.0.0' });
  expect((await readWorkspaceOverrideInputs([second, first])).overrides['parent>child']).toBe('3.0.0');
});

it('retains own keys without interpreting package selectors as object prototypes', async () => {
  const overrides = JSON.parse('{"__proto__":"1.0.0","constructor":"2.0.0"}') as Record<string, string>;
  const root = fixture(overrides);
  for (const result of [await readWorkspaceOverrideInputs([root]), await readBundleOverrides([root])]) {
    expect(Object.getPrototypeOf(result.overrides)).toBe(Object.prototype);
    expect(Object.hasOwn(result.overrides, '__proto__')).toBe(true);
    expect(Object.entries(result.overrides)).toEqual(Object.entries(overrides));
  }
});

it('keeps workspace confinement for version-qualified local archives in checked build inputs', async () => {
  const source = fixture({});
  archive(source, '@example/dependency');
  const root = fixture({ '@example/dependency@1': 'file:dependency.tgz' });
  fs.symlinkSync(path.join(source, 'dependency.tgz'), path.join(root, 'dependency.tgz'));
  await expect(readWorkspaceOverrideInputs([root])).rejects.toThrow(/inside its source workspace/);
});

it('hashes identical cloned inputs equally and retains workspace/link policy in the fingerprint', async () => {
  const overrides = {
    '@example/dependency@1': 'file:dependency.tgz',
    linked: 'link:../linked',
    local: 'workspace:*',
  };
  const first = fixture(overrides), second = fixture(overrides);
  archive(first, '@example/dependency');
  fs.copyFileSync(path.join(first, 'dependency.tgz'), path.join(second, 'dependency.tgz'));
  const apps = [first, second].map(root => {
    const app = path.join(root, 'apps/app');
    fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0' }));
    return app;
  });
  expect((await readWorkspaceOverrideInputs([first])).overrides).toEqual(overrides);
  const before = await buildInputsChecksum(apps[0]!);
  expect(await buildInputsChecksum(apps[1]!)).toBe(before);
  fs.writeFileSync(path.join(second, 'pnpm-workspace.yaml'),
    `overrides: ${JSON.stringify({ ...overrides, local: 'workspace:^' })}\npackages: []\n`);
  expect(await buildInputsChecksum(apps[1]!)).not.toBe(before);
});

it.each([
  { 'parent@^2>child': '3.0.0' },
  { 'parent>child': 'npm:@fork/child@3.0.0' },
  { 'child:optional': '-' },
  { child: 'catalog:' },
])('directs unrepresentable npm bundles to checked releases without broadening %j', async (overrides) => {
  const root = fixture(overrides);
  await expect(readBundleOverrides([root])).rejects.toThrow('omnitron release build <project>');
  expect((await readWorkspaceOverrideInputs([root])).overrides).toEqual(overrides);
});

it('does not pretend a version-qualified archive can be flattened into a global npm override', async () => {
  const root = fixture({ '@example/dependency@1.0.0': 'file:dependency.tgz' });
  archive(root, '@example/dependency');
  await expect(readBundleOverrides([root])).rejects.toThrow('version-qualified local archive selection');
  expect((await readWorkspaceOverrideInputs([root])).archives).toHaveLength(1);
});
