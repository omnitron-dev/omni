import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { RuntimeInstallation, selectedBackend } from '../../src/daemon/runtime-installation.js';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const roots: string[] = [];
const stores: RuntimeInstallation[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omni-runtime-'")); roots.push(root);
  const home = path.join(root, 'instance');
  const store = await RuntimeInstallation.open(home);
  if (!store) throw new Error('Fixture store was not opened');
  stores.push(store);
  const make = async (name: string, launcher = true) => {
    const source = path.join(root, name);
    const dist = path.join(source, 'packages/0/dist');
    const build = { commit: name === 'first' ? 'a'.repeat(40) : 'b'.repeat(40), dirty: false, builtAt: new Date().toISOString() };
    await fs.mkdir(path.join(dist, 'daemon'), { recursive: true });
    await fs.mkdir(path.join(dist, 'cli'));
    await fs.mkdir(path.join(dist, 'database/migrations'), { recursive: true });
    await fs.writeFile(path.join(dist, 'BUILD.json'), JSON.stringify(build));
    await fs.writeFile(path.join(dist, 'daemon/daemon-entry.js'), 'export {};');
    if (launcher) await fs.writeFile(path.join(dist, 'cli/installed.js'), 'export {};');
    // Only the preflight protocol is exercised here; runtime integration tests
    // use the sealed real Node executable and actual application processes.
    await fs.writeFile(path.join(source, 'node'), `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ protocol: 1, build })}'\n`, { mode: 0o700 });
    const hash = await runtimeArtifactDigest(source);
    await fs.writeFile(path.join(source, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: hash,
      platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 }));
    return { source, hash, dist };
  };
  return { root, home, store, make };
}

it('installs an independent verified copy without changing the running selection or source', async () => {
  const { store, make } = await fixture(); const first = await make('first');
  const artifact = await store.exclusive(() => store.install(first.source));
  expect(store.selection()).toBeNull();
  expect(artifact.runtimeRoot).toBe(store.releasePath(first.hash));
  await fs.writeFile(path.join(first.dist, 'daemon/daemon-entry.js'), 'changed source');
  expect((await store.artifact(first.hash)).runtimeHash).toBe(first.hash);
  expect(await fs.readdir(store.releases)).toEqual([first.hash]);
});

it('persists startup selection and rollback while keeping a stable bootstrap launcher', async () => {
  const { store, home, make } = await fixture(); const first = await make('first'), next = await make('next');
  await store.exclusive(async () => {
    await store.install(first.source); await store.install(next.source);
    await store.select(first.hash, 0);
    const launcher = await store.writeLauncher();
    expect((await fs.stat(launcher)).mode & 0o777).toBe(0o700);
    expect(await fs.readFile(launcher, 'utf8')).toContain("'\\''");
    await store.select(next.hash, 1);
    await store.writeLauncher();
    expect(await fs.readFile(launcher, 'utf8')).toContain(first.hash);
  });
  expect(store.selection()).toMatchObject({ current: next.hash, previous: first.hash, bootstrap: first.hash, revision: 2 });
  expect((await selectedBackend(home))?.runtimeHash).toBe(next.hash);
});

it('retains installation and recovery commands after rollback to a backend without an installation CLI', async () => {
  const { store, home, make } = await fixture();
  const legacy = await make('first', false), current = await make('current');
  await store.exclusive(async () => {
    await store.install(legacy.source); await store.install(current.source);
    await store.select(current.hash, 0); await store.writeLauncher();
    await store.select(legacy.hash, 1);
    const launcher = await store.writeLauncher();
    expect(await fs.readFile(launcher, 'utf8')).toContain(current.hash);
  });
  expect((await selectedBackend(home))?.runtimeHash).toBe(legacy.hash);
  expect((await selectedBackend(home, 'management'))?.runtimeHash).toBe(current.hash);
});

it('promotes proven management code and keeps it available through a subsequent interrupted activation', async () => {
  const { store, home, root, make } = await fixture();
  const first = await make('first'), next = await make('next');
  await store.exclusive(async () => {
    await store.install(first.source); await store.install(next.source);
    await store.select(first.hash, 0); await store.writeLauncher();
    store.beginActivation(next.hash, first.hash, path.join(root, 'first-transition.json'));
    expect((await selectedBackend(home, 'management'))?.runtimeHash).toBe(first.hash);
    await store.select(next.hash, 1, true);
    store.beginActivation(first.hash, next.hash, path.join(root, 'next-transition.json'));
    expect((await selectedBackend(home, 'management'))?.runtimeHash).toBe(next.hash);
    store.abortActivation();
    await store.select(first.hash, 2);
    expect(store.selection()?.bootstrap).toBe(next.hash);
  });
});

it('blocks cold start after an interrupted activation until a proven commit or abort', async () => {
  const { store, home, root, make } = await fixture(); const first = await make('first'), next = await make('next');
  await store.exclusive(async () => {
    await store.install(first.source); await store.install(next.source); await store.select(first.hash, 0);
    store.beginActivation(next.hash, first.hash, path.join(root, 'handoff.json'));
  });
  await expect(selectedBackend(home)).rejects.toThrow('activation is unfinished');
  expect(store.selection()?.current).toBe(first.hash);
  await store.exclusive(() => store.select(next.hash, 1));
  expect(store.activation()).toBeNull();
  expect((await selectedBackend(home))?.runtimeHash).toBe(next.hash);
});

it('serializes different registry connections and rejects stale selection revisions', async () => {
  const { store, home, make } = await fixture(); const first = await make('first');
  const other = await RuntimeInstallation.open(home); if (!other) throw new Error('No second store'); stores.push(other);
  await store.exclusive(async () => {
    await expect(other.exclusive(async () => 'unsafe')).rejects.toThrow('Another runtime operation');
    await store.install(first.source); await store.select(first.hash, 0);
  });
  await expect(other.exclusive(() => other.select(first.hash, 0))).rejects.toThrow('selection changed');
  await expect(other.exclusive(() => other.select(first.hash, 1))).resolves.toMatchObject({ revision: 2 });
});

it('refuses modified artifacts and does not replace an installed directory with a link', async () => {
  const { store, make, root } = await fixture(); const first = await make('first');
  await fs.symlink(first.source, store.releasePath(first.hash));
  await expect(store.exclusive(() => store.install(first.source))).rejects.toThrow('symbolic link');
  await fs.unlink(store.releasePath(first.hash));
  await store.exclusive(() => store.install(first.source));
  await fs.writeFile(path.join(store.releasePath(first.hash), 'node'), 'corrupt');
  await expect(store.exclusive(() => store.select(first.hash, 0))).rejects.toThrow('changed after sealing');
  expect(store.selection()).toBeNull();
  expect(await fs.readdir(root)).toContain('first');
});

it('does not treat corrupt selection data as an unconfigured installation', async () => {
  const { store } = await fixture();
  const raw = new DaemonStateStore(createNullLogger(), path.join(store.directory, 'state.db'));
  try {
    raw.kvSetSync('runtime.selection', { protocol: 1, current: '../../outside', revision: 1 });
    expect(() => store.selection()).toThrow('Invalid runtime selection');
    raw.initSync().prepare('UPDATE state_kv SET value = ? WHERE key = ?').run('{broken', 'runtime.selection');
    expect(() => store.selection()).toThrow();
  } finally { await raw.dispose(); }
});

it('recovers a durable installation lease after its actual process dies', async () => {
  const { root, home, store } = await fixture();
  const script = path.join(root, 'lease.mjs');
  const source = fileURLToPath(new URL('../../src/daemon/runtime-installation.ts', import.meta.url));
  await fs.writeFile(script, `import { RuntimeInstallation } from ${JSON.stringify(source)};
    const store = await RuntimeInstallation.open(${JSON.stringify(home)});
    await store.exclusive(async () => { process.send({ type: 'locked' }); await new Promise(() => setInterval(() => {}, 1000)); });`);
  const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let errors = '';
  child.stderr?.on('data', data => { errors += String(data); });
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Lease fixture exited ${code}: ${errors}`)));
      child.once('message', () => resolve());
    });
    await expect(store.exclusive(async () => undefined)).rejects.toThrow('Another runtime operation');
    child.kill('SIGKILL');
    await exited;
    await expect(store.exclusive(async () => 'recovered')).resolves.toBe('recovered');
  } finally { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } }
});

it('rejects a resealed replacement before executing its preflight under an existing identity', async () => {
  const { root, store, make } = await fixture(); const first = await make('first');
  await store.exclusive(() => store.install(first.source));
  const installed = store.releasePath(first.hash);
  const marker = path.join(root, 'unexpected-execution');
  await fs.writeFile(path.join(installed, 'node'), `#!/bin/sh\ntouch '${marker.replaceAll("'", "'\\''")}'\n`);
  const manifestFile = path.join(installed, 'RUNTIME.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  manifest.sha256 = await runtimeArtifactDigest(installed);
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  await expect(store.artifact(first.hash)).rejects.toThrow('manifest does not match');
  await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('does not create state for an uninstalled instance and refuses public or symlink registries', async () => {
  const { root, home, store } = await fixture();
  expect(await selectedBackend(path.join(root, 'absent'))).toBeNull();
  await expect(fs.access(path.join(root, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
  await store.close();
  const db = path.join(store.directory, 'state.db');
  await fs.chmod(db, 0o644);
  await expect(RuntimeInstallation.open(home)).rejects.toThrow('private regular file');
  await fs.chmod(db, 0o600); await fs.rename(db, db + '.original'); await fs.symlink(db + '.original', db);
  await expect(RuntimeInstallation.open(home)).rejects.toThrow('private regular file');
});


it('inspects an existing registry without creating its directories, migrating its schema or acquiring a lease', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-registry-')); roots.push(root);
  const home = path.join(root, 'instance');
  expect(await RuntimeInstallation.openReadOnly(home)).toBeNull();
  expect(await fs.readdir(root)).toEqual([]);
  const directory = path.join(home, 'runtime');
  await fs.mkdir(path.join(directory, 'releases'), { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'state.db'), db = openSqliteDatabase(file);
  db.exec('CREATE TABLE state_kv (key TEXT PRIMARY KEY, value TEXT)'); db.close(); await fs.chmod(file, 0o600);
  const bytes = await fs.readFile(file);
  const installation = await RuntimeInstallation.openReadOnly(home);
  expect(installation).not.toBeNull();
  try {
    expect(installation!.selection()).toBeNull(); expect(installation!.activation()).toBeNull(); expect(() => installation!.settledSelection()).toThrow(/No runtime/);
    expect(installation!.settledSelection({ allowEmpty: true })).toBeNull();
    await expect(installation!.exclusive(async () => undefined)).rejects.toThrow(/read-only/);
  } finally { await installation!.close(); }
  expect(await fs.readFile(file)).toEqual(bytes);
  expect((await fs.readdir(directory)).sort()).toEqual(['releases', 'state.db']);
});

it('refuses an abandoned or malformed lease and an unfinished activation during passive inspection', async () => {
  const { home } = await fixture(), file = path.join(home, 'runtime', 'state.db');
  const db = openSqliteDatabase(file), reader = await RuntimeInstallation.openReadOnly(home);
  const insert = db.prepare('INSERT INTO state_kv (key,value,updated_at) VALUES (?,?,?)');
  const selection = { protocol: 1, revision: 1, current: 'a'.repeat(64), previous: null, bootstrap: null, selectedAt: new Date().toISOString() };
  try {
    insert.run('runtime.selection', JSON.stringify(selection), selection.selectedAt);
    expect(reader!.settledSelection()).toEqual(selection);
    for (const key of ['runtime.lease', 'runtime.activation']) {
      insert.run(key, 'null', selection.selectedAt);
      expect(() => reader!.settledSelection()).toThrow(/unsettled/);
      expect(() => reader!.settledSelection({ allowEmpty: true })).toThrow(/unsettled/);
      db.prepare('DELETE FROM state_kv WHERE key=?').run(key);
    }
    db.prepare("UPDATE state_kv SET value='null' WHERE key='runtime.selection'").run();
    expect(() => reader!.settledSelection({ allowEmpty: true })).toThrow(/Invalid runtime registry record/);
  } finally { db.close(); await reader?.close(); }
});

it('reads committed WAL state without schema changes, journal entries or a reader-selected runtime', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guardian-wal-')); roots.push(root);
  const directory = path.join(root, 'runtime'); await fs.mkdir(path.join(directory, 'releases'), { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'state.db'), writer = openSqliteDatabase(file); await fs.chmod(file, 0o600);
  writer.pragma('journal_mode = WAL'); writer.exec('CREATE TABLE state_kv (key TEXT PRIMARY KEY, value TEXT)');
  const selection = { protocol: 1, revision: 2, current: 'b'.repeat(64), previous: null, bootstrap: null, selectedAt: new Date().toISOString() };
  writer.prepare('INSERT INTO state_kv VALUES (?,?)').run('runtime.selection', JSON.stringify(selection));
  const bytes = await fs.readFile(file), wal = await fs.readFile(file + '-wal');
  let reader = await RuntimeInstallation.openReadOnly(root);
  try { expect(reader!.settledSelection()).toEqual(selection); } finally { await reader?.close(); writer.close(); }
  // Closing the last writer may checkpoint. A subsequent reader may create
  // coordination sidecars, but must never write database pages or any WAL frame.
  expect(wal.length).toBeGreaterThan(0);
  const checkpointed = await fs.readFile(file); expect(checkpointed.equals(bytes)).toBe(false);
  reader = await RuntimeInstallation.openReadOnly(root);
  try { expect(reader!.settledSelection()).toEqual(selection); } finally { await reader?.close(); }
  expect(await fs.readFile(file)).toEqual(checkpointed);
  const sidecar = await fs.stat(file + '-wal').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null; });
  expect(sidecar?.size ?? 0).toBe(0);
});
