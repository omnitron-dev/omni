import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extract } from 'tar';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { importKernelBuild, listKernelBuilds, resolveKernelBuild } from '../../src/services/kernel-catalog.js';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';

const commit = 'a'.repeat(40);
const variant = { platform: 'linux', arch: 'x64', nodeVersion: 'v22.23.4' };
let temp: string, source: string, home: string;
async function seal() {
  const sha256 = await runtimeArtifactDigest(source);
  await fs.writeFile(path.join(source, 'RUNTIME.json'), JSON.stringify({ protocol: 1, ...variant, sha256, packages: 1 }), { mode: 0o600 });
  return sha256;
}
beforeEach(async () => {
  temp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kernel-catalog-')));
  source = path.join(temp, 'build'); home = path.join(temp, 'instance');
  const dist = path.join(source, 'packages/0/dist');
  await fs.mkdir(dist, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dist, 'BUILD.json'), JSON.stringify({ commit, dirty: false, builtAt: '2026-01-01' }), { mode: 0o600 });
  await fs.writeFile(path.join(source, 'node'), 'foreign executable', { mode: 0o500 });
  await fs.symlink('packages/0', path.join(source, 'app'));
  await seal();
});
afterEach(async () => { await fs.rm(temp, { recursive: true, force: true }); });

it('imports a foreign build without executing it and preserves its exact runtime hash after extraction', async () => {
  expect(await listKernelBuilds(home)).toEqual([]);
  const [a, b] = await Promise.all([importKernelBuild(source, home), importKernelBuild(source, home)]);
  expect(a).toEqual(b);
  expect(await listKernelBuilds(home)).toEqual([a]);
  const { entry, archive } = await resolveKernelBuild(commit, variant, home);
  expect(entry).toMatchObject({ ...variant, commit });
  const copy = path.join(temp, 'copy');
  await fs.mkdir(copy, { mode: 0o700 });
  await extract({ file: archive, cwd: copy, strict: true, chmod: true, umask: 0o022, dmode: 0o700, fmode: 0o600 });
  expect(await runtimeArtifactDigest(copy)).toBe(entry.artifact);
  expect((await fs.lstat(path.join(copy, 'node'))).mode & 0o111).toBe(0o100);
  expect(await fs.readlink(path.join(copy, 'app'))).toBe('packages/0');
});

it('refuses a modified archive, an unsealed input, and reuse of an admitted variant with different bytes', async () => {
  const a = await importKernelBuild(source, home);
  await fs.chmod(path.join(source, 'node'), 0o700);
  await fs.writeFile(path.join(source, 'node'), 'different executable');
  await expect(importKernelBuild(source, home)).rejects.toThrow('changed after it was sealed');
  await seal();
  await expect(importKernelBuild(source, home)).rejects.toThrow('immutable build variant');
  const { archive } = await resolveKernelBuild(commit, variant, home);
  const file = await fs.open(archive, 'r+');
  try { await file.write(Buffer.from([0]), 0, 1, 0); } finally { await file.close(); }
  await expect(resolveKernelBuild(commit, a, home)).rejects.toThrow('SHA-256');
});

it('refuses a missing exact Node version and a catalog slot redirected outside the instance', async () => {
  const entry = await importKernelBuild(source, home);
  await expect(resolveKernelBuild(commit, { ...variant, nodeVersion: 'v22.17.0' }, home)).rejects.toThrow('Missing controller build');
  const { archive } = await resolveKernelBuild(commit, entry, home);
  const slot = path.dirname(archive);
  await fs.rename(slot, path.join(temp, 'outside'));
  await fs.symlink(path.join(temp, 'outside'), slot);
  await expect(listKernelBuilds(home)).rejects.toThrow('Unsafe');
});
