import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { create } from 'tar';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { normalizePackedWorkspace } from '../../src/release/portable-archive.js';
import { assertReproducedFrameworkArchives, type FrameworkArchive } from '../../src/release/registry-framework.js';

const name = '@omnitron-dev/lumen', version = '0.4.0', commit = 'ab'.repeat(20);
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'reproduced-framework-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const manifest = () => ({
  name, version, bin: { lumen: './index.js' },
  dependencies: { zebra: '1.0.0', alpha: '2.0.0' },
  optionalDependencies: { zebra: '1.0.0', alpha: '2.0.0' },
  peerDependencies: { zebra: '1.0.0', alpha: '2.0.0' },
  peerDependenciesMeta: { zebra: { optional: true }, alpha: { optional: false } },
  devDependencies: { zebra: '1.0.0', alpha: '2.0.0' },
  exports: { '.': { node: './index.js', default: './browser.js' } },
});

interface ArchiveOptions {
  metadata?: Record<string, unknown>;
  mutate?: (directory: string) => Promise<void>;
  normalize?: boolean;
}

async function archive(options: ArchiveOptions = {}): Promise<FrameworkArchive> {
  const directory = await fs.mkdtemp(path.join(root, 'input-'));
  const pkg = path.join(directory, 'package');
  await fs.mkdir(pkg);
  const metadata = options.metadata ?? { ...manifest(), gitHead: commit };
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify(metadata, null, 2) + '\n');
  await fs.writeFile(path.join(pkg, 'index.js'),
    `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(root, 'executed'))}, 'must not run');\n`);
  await fs.writeFile(path.join(pkg, 'browser.js'), 'export const browser = true;\n');
  await fs.chmod(path.join(pkg, 'index.js'), 0o755);
  await options.mutate?.(pkg);
  const file = path.join(directory, 'archive.tgz');
  await create({ cwd: directory, file, gzip: true, portable: true, noMtime: true }, ['package']);
  if (options.normalize) await normalizePackedWorkspace(file);
  const integrity = 'sha512-' + createHash('sha512').update(await fs.readFile(file)).digest('base64');
  return { name: metadata['name'] as string, version: metadata['version'] as string, integrity, file };
}

it('binds publication to canonical independent files without executing or extracting the payload', async () => {
  const prepared = await archive();
  const reproduced = await archive({ metadata: manifest(), normalize: true });
  expect(prepared.integrity).not.toBe(reproduced.integrity);
  const before = await fs.readdir(root, { recursive: true });
  await expect(assertReproducedFrameworkArchives([prepared], [reproduced], commit)).resolves.toEqual({ packages: 1, files: 3 });
  expect(await fs.readdir(root, { recursive: true })).toEqual(before);
  await expect(fs.stat(path.join(root, 'executed'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('requires exactly the complete package inventory and version on both sides', async () => {
  const a = await archive(), b = await archive({ metadata: manifest(), normalize: true });
  for (const [prepared, reproduced] of [
    [[], []], [[a], []], [[], [b]], [[a, a], [b]], [[a], [b, b]],
    [[a], [{ ...b, name: '@omnitron-dev/titan' }]], [[a], [{ ...b, version: '0.3.5' }]],
  ] satisfies [FrameworkArchive[], FrameworkArchive[]][]) {
    await expect(assertReproducedFrameworkArchives(prepared, reproduced, commit)).rejects.toThrow(/inventories differ|duplicate/);
  }
});

it('requires the published gitHead and rejects a different commit on either side', async () => {
  const prepared = await archive(), reproduced = await archive({ metadata: manifest() });
  await expect(assertReproducedFrameworkArchives([reproduced], [reproduced], commit)).rejects.toThrow(/packed gitHead/);
  const wrong = await archive({ metadata: { ...manifest(), gitHead: 'cd'.repeat(20) } });
  await expect(assertReproducedFrameworkArchives([wrong], [reproduced], commit)).rejects.toThrow(/different release commit/);
  await expect(assertReproducedFrameworkArchives([prepared], [wrong], commit)).rejects.toThrow(/different Git commit/);
  await expect(assertReproducedFrameworkArchives([prepared], [reproduced], 'HEAD')).rejects.toThrow(/exact release commit/);
});

it('verifies each compressed archive against its own selected SHA-512', async () => {
  const a = await archive(), b = await archive({ metadata: manifest() });
  await expect(assertReproducedFrameworkArchives([{ ...a, integrity: b.integrity }], [b], commit)).rejects.toThrow(/SHA-512/);
  await expect(assertReproducedFrameworkArchives([a], [{ ...b, integrity: a.integrity }], commit)).rejects.toThrow(/SHA-512/);
});

it.each([
  ['code bytes', async (dir: string) => { await fs.appendFile(path.join(dir, 'browser.js'), 'export const changed = true;\n'); }],
  ['binary executable bit', async (dir: string) => { await fs.chmod(path.join(dir, 'index.js'), 0o644); }],
  ['extra file', async (dir: string) => { await fs.writeFile(path.join(dir, 'extra.js'), 'extra'); }],
  ['missing file', async (dir: string) => { await fs.rm(path.join(dir, 'browser.js')); }],
  ['same count with different paths', async (dir: string) => { await fs.rename(path.join(dir, 'browser.js'), path.join(dir, 'other.js')); }],
] as const)('rejects different %s', async (_label, mutate) => {
  const a = await archive(), b = await archive({ metadata: manifest(), mutate });
  await expect(assertReproducedFrameworkArchives([a], [b], commit)).rejects.toThrow(/archive files differ|independently reproduced SDK/);
});

it.each([
  ['export-condition order', { ...manifest(), exports: { '.': { default: './browser.js', node: './index.js' } } }],
  ['dependency edge', { ...manifest(), dependencies: { zebra: '3.0.0', alpha: '2.0.0' } }],
  ['peer optionality', { ...manifest(), peerDependenciesMeta: { zebra: { optional: false }, alpha: { optional: false } } }],
  ['extra metadata', { ...manifest(), injected: true }],
] as const)('does not normalize away %s', async (_label, metadata) => {
  const a = await archive(), b = await archive({ metadata, normalize: true });
  await expect(assertReproducedFrameworkArchives([a], [b], commit)).rejects.toThrow(/package.json/);
});

it('keeps bundled manifests exact and rejects undeclared bundled content', async () => {
  const metadata = { ...manifest(), bundledDependencies: ['alpha'] };
  const bundle = async (dir: string, reversed: boolean) => {
    const nested = path.join(dir, 'node_modules/alpha');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'package.json'), JSON.stringify({ name: 'alpha', version: '2.0.0',
      dependencies: reversed ? { a: '1.0.0', z: '1.0.0' } : { z: '1.0.0', a: '1.0.0' } }));
    await fs.writeFile(path.join(nested, 'index.js'), 'export const alpha = true;\n');
  };
  const a = await archive({ metadata: { ...metadata, gitHead: commit }, mutate: dir => bundle(dir, false) });
  const b = await archive({ metadata, mutate: dir => bundle(dir, true), normalize: true });
  await expect(assertReproducedFrameworkArchives([a], [b], commit)).rejects.toThrow(/node_modules\/alpha\/package.json/);
  const orphan = await archive({ metadata: manifest(), mutate: dir => bundle(dir, false) });
  await expect(assertReproducedFrameworkArchives([a], [orphan], commit)).rejects.toThrow(/undeclared bundled/);
});
