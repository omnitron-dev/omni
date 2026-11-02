import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runtimeArtifactDigest, verifyRuntimeArtifact } from '../../src/shared/runtime-artifact.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

it('proves a sealed tree predates the native owner and refuses even restored bytes after birth', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owner-birth-'));
  directories.push(root);
  const entry = path.join(root, 'owner.js');
  await fs.writeFile(entry, 'sealed owner');
  const sha256 = await runtimeArtifactDigest(root);
  await fs.writeFile(path.join(root, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256, platform: process.platform, arch: process.arch }));
  const born = Date.now() + 50;
  await expect(verifyRuntimeArtifact(root, sha256, born)).resolves.toMatchObject({ sha256 });
  await new Promise(resolve => setTimeout(resolve, 75));
  await fs.writeFile(entry, 'changed owner');
  await fs.writeFile(entry, 'sealed owner');
  expect(await runtimeArtifactDigest(root)).toBe(sha256);
  await expect(verifyRuntimeArtifact(root, sha256, born)).rejects.toThrow('changed after process startup');
});
