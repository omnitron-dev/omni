import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { ExecutionJournal, readPrivateRecord, writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { runtimeArtifactDigest, verifyRuntimeArtifact } from '../../src/shared/runtime-artifact.js';
import { backendMigrationDigest } from '../../src/daemon/backend-candidate.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function root() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-checkpoint-')); roots.push(directory); return directory; }
it('persists grants in a private atomic record and refuses an unrelated owner', async () => {
  const file = path.join(await root(), 'controller.json');
  const journal = new ExecutionJournal(file);
  const owner = { id: 'owner', pid: 1, startedAt: new Date().toISOString() };
  await journal.write({ protocol: 1, owner, grant: { ownerId: owner.id, controllerId: 'next', epoch: 2 } });
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  expect((await journal.read())?.grant.epoch).toBe(2);
  await writePrivateRecord(file, { protocol: 1, owner, grant: { ownerId: 'different', controllerId: 'next', epoch: 2 } });
  await expect(journal.read()).rejects.toThrow('Invalid execution journal');
});
it('rejects public and symlink checkpoints instead of silently tightening their permissions', async () => {
  const directory = await root(), file = path.join(directory, 'record');
  await fs.writeFile(file, '{}', { mode: 0o644 });
  await expect(readPrivateRecord(file)).rejects.toThrow('private regular file');
  await fs.chmod(file, 0o600);
  const link = path.join(directory, 'link'); await fs.symlink(file, link);
  await expect(readPrivateRecord(link)).rejects.toThrow('private regular file');
  await fs.chmod(directory, 0o755);
  await expect(writePrivateRecord(file, {})).rejects.toThrow('directory must be private');
});
it('detects changed dependency bytes and refuses links outside a sealed runtime', async () => {
  const directory = await root(), file = path.join(directory, 'module.js');
  await fs.writeFile(file, 'export const value = 1;');
  const manifest = { protocol: 1, sha256: await runtimeArtifactDigest(directory), platform: process.platform,
    arch: process.arch, nodeVersion: process.version, packages: 1 };
  await fs.writeFile(path.join(directory, 'RUNTIME.json'), JSON.stringify(manifest));
  await expect(verifyRuntimeArtifact(directory)).resolves.toMatchObject({ sha256: manifest.sha256 });
  await fs.writeFile(file, 'export const value = 2;');
  await expect(verifyRuntimeArtifact(directory)).rejects.toThrow('changed after sealing');
  await fs.symlink(process.execPath, path.join(directory, 'external-node'));
  await expect(runtimeArtifactDigest(directory)).rejects.toThrow('escapes its release');
});

it('includes both master and local node migrations in backend compatibility', async () => {
  const directory = await root();
  await fs.mkdir(path.join(directory, 'database/migrations'), { recursive: true });
  await fs.writeFile(path.join(directory, 'database/migrations/001.js'), 'export const up = () => {};');
  const masterOnly = await backendMigrationDigest(directory);
  await fs.mkdir(path.join(directory, 'database/slave-migrations'));
  await fs.writeFile(path.join(directory, 'database/slave-migrations/001.js'), 'export const up = () => {};');
  const withNode = await backendMigrationDigest(directory);
  expect(withNode).not.toBe(masterOnly);
  await fs.writeFile(path.join(directory, 'database/slave-migrations/001.js'), 'export const up = () => { throw Error(); };');
  expect(await backendMigrationDigest(directory)).not.toBe(withNode);
  await fs.symlink(path.join(directory, 'database/migrations/001.js'), path.join(directory, 'database/slave-migrations/002.js'));
  await expect(backendMigrationDigest(directory)).rejects.toThrow('must not be symlinks');
});
