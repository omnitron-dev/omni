import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { ProjectRegistry } from '../../src/project/registry.js';

const roots: string[] = [];
const stores: DaemonStateStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.dispose();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-recovery-')); roots.push(root);
  const store = new DaemonStateStore(createNullLogger(), path.join(root, 'state.db')); stores.push(store);
  store.initSync();
  const registration = { name: 'example', path: path.join(root, 'project'), registeredAt: '2026-01-01T00:00:00.000Z', enabledStacks: ['prod', 'dev'] };
  store.upsertProjectSync({ name: registration.name, path: registration.path, added_at: registration.registeredAt, last_seen: registration.registeredAt });
  store.kvSetSync('project:example:enabled-stacks', registration.enabledStacks);
  // The cached controller comparison uses the real public method without
  // invoking constructor migration or touching a user's projects directory.
  const registry = Object.create(ProjectRegistry.prototype) as ProjectRegistry;
  Object.assign(registry, { store, listRegistrations: () => [registration] });
  return { root, store, registry };
}
async function identity(file: string) {
  const stat = await fs.lstat(file);
  return { inode: stat.ino, mtime: stat.mtimeMs, ctime: stat.ctimeMs, mode: stat.mode,
    sha256: createHash('sha256').update(await fs.readFile(file)).digest('hex') };
}

it('reads the same canonical registry identity without rewriting rows, files or initialization state', async () => {
  const { root, store, registry } = await fixture();
  const before = await identity(store.dbPath), wal = await identity(store.dbPath + '-wal');
  const names = await fs.readdir(root);
  expect(ProjectRegistry.readRecoveryDigest(store.dbPath)).toBe(registry.recoveryDigest());
  expect(await identity(store.dbPath)).toEqual(before); expect(await identity(store.dbPath + '-wal')).toEqual(wal);
  expect(await fs.readdir(root)).toEqual(names);
  store.kvSetSync('project:example:enabled-stacks', ['dev']);
  expect(() => registry.recoveryDigest()).toThrow('changed outside');
  expect(ProjectRegistry.readRecoveryDigest(store.dbPath)).toMatch(/^[a-f0-9]{64}$/);
});

it('does not initialize a missing database and refuses corrupt intent or registry symlinks', async () => {
  const { root, store } = await fixture();
  const missing = path.join(root, 'missing.db');
  expect(() => ProjectRegistry.readRecoveryDigest(missing)).toThrow();
  await expect(fs.lstat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  store.kvSetSync('project:example:enabled-stacks', 'prod');
  expect(() => ProjectRegistry.readRecoveryDigest(store.dbPath)).toThrow('Corrupt enabled-stack');
  const link = path.join(root, 'link.db'); await fs.symlink(store.dbPath, link);
  expect(() => ProjectRegistry.readRecoveryDigest(link)).toThrow('private regular file');
});
