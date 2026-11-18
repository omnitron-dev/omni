import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { RecoveryState } from '../../src/daemon/recovery-state.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import { inspectMigrationSdk, withMigrationSdk, releaseTerminalMigrationSdk, sdkCommand, type MigrationSdkReference } from '../../bin/sdk.js';
import { assertSdkAvailable, exclusively, prepareSdkState, sdkWorkspaceIdentity, withMigrationSdkLocks } from '../../bin/sdk-operation.js';
import { prepareSdkTransition, beginSdkTransition, finishSdkTransition, sdkTransitionStatus } from '../../bin/sdk-transition.js';

let directory: string, root: string, source: string, store: DaemonStateStore, journal: OperationJournal;
const marker = (workspace: string) => path.join(workspace, '.omnitron/dev-sdk/pending-selection');
const bytes = (file: string) => fs.readFile(file, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-migration-')));
  root = path.join(directory, 'consumer'); source = path.join(directory, 'source');
  for (const workspace of [root, source]) {
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'package.json'), JSON.stringify({ name: path.basename(workspace), private: true }));
  }
  store = new DaemonStateStore(createNullLogger(), path.join(directory, 'daemon-state.db'));
  journal = new OperationJournal(store, new RecoveryState());
  vi.stubEnv('OMNITRON_HOME', path.join(directory, 'offline-owner'));
  vi.stubEnv('OMNITRON_SOCKET', path.join(directory, 'absent.sock'));
  vi.stubEnv('OMNITRON_DEV_CACHE', path.join(directory, 'retained'));
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await store.dispose(); await fs.rm(directory, { recursive: true, force: true }); });
function operation(id = randomUUID()): MigrationSdkReference {
  journal.prepare({ id, kind: 'migration', inputDigest: 'a'.repeat(64),
    resources: [{ kind: 'stack-migration', project: 'example', stack: 'dev', name: 'migrations' }] });
  return { id, review: 'a'.repeat(64), journal: store.dbPath, read: () => journal.read(id) };
}
const identities = () => Promise.all([root, source].map(sdkWorkspaceIdentity));
const finish = (ref: MigrationSdkReference, state: 'failed' | 'cancelled' | 'unknown' = 'failed') => {
  const current = journal.read(ref.id)!;
  return journal.transition(ref.id, current.revision, state);
};

it('reviews registry inputs without creating state or invoking a package manager, and exposes only fingerprints', async () => {
  await fs.writeFile(path.join(root, '.npmrc'), '//registry.invalid/:_authToken=private-test-token\n');
  const before = await inspectMigrationSdk(root);
  expect(before).toMatchObject({ root, source: null, workspaces: [await sdkWorkspaceIdentity(root)] });
  expect(JSON.stringify(before)).not.toContain('private-test-token');
  expect(await fs.stat(path.join(root, '.omnitron')).catch(() => null)).toBeNull();
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.pnpmfile.mjs', '.npmrc', 'package.json']) {
    const old = await bytes(path.join(root, file));
    await fs.writeFile(path.join(root, file), file.endsWith('.json') ? '{"name":"changed"}' : 'changed input');
    expect((await inspectMigrationSdk(root)).inputsSha256, file).not.toBe(before.inputsSha256);
    if (old === null) await fs.rm(path.join(root, file)); else await fs.writeFile(path.join(root, file), old);
  }
});

it('keeps its own inspection stable and holds ordinary SDK writers until canonical completion', async () => {
  const reviewed = await inspectMigrationSdk(root), ref = operation();
  await withMigrationSdk(root, ref, async hold => {
    await hold.retain();
    expect(await inspectMigrationSdk(root)).toEqual(reviewed);
    expect(JSON.parse((await bytes(marker(root)))!)).toEqual({ kind: 'migration', root, id: ref.id, review: ref.review, journal: ref.journal });
    await expect(sdkCommand(['init', '--project-dir', root])).rejects.toThrow('Another development SDK operation');
    await expect(hold.release()).rejects.toThrow('canonical outcome is terminal');
    finish(ref); await hold.release();
  });
  expect(await bytes(marker(root))).toBeNull();
  await expect(assertSdkAvailable(root)).resolves.toBeUndefined();
});

it('retains unknown ownership after a failed caller and a canonical journal reopen', async () => {
  const ref = operation();
  await expect(withMigrationSdkLocks(await identities(), ref, async hold => {
    await hold.retain(); finish(ref, 'unknown');
    throw Error('backend response lost');
  })).rejects.toThrow('backend response lost');
  await store.dispose();
  store = new DaemonStateStore(createNullLogger(), path.join(directory, 'daemon-state.db'));
  journal = new OperationJournal(store, new RecoveryState());
  expect(journal.read(ref.id)?.state).toBe('unknown');
  for (const workspace of [root, source]) {
    // Process locks are free, while the durable reference still refuses writes.
    await exclusively(await prepareSdkState(workspace), async () => {
      await expect(assertSdkAvailable(workspace)).rejects.toThrow('held by a stack migration');
    });
  }
  for (const action of ['init', 'registry', 'recover'])
    await expect(sdkCommand([action, '--project-dir', root])).rejects.toThrow('held by a stack migration');
  expect(await bytes(path.join(root, '.pnpmfile.mjs'))).toBeNull();
  await expect(withMigrationSdkLocks(await identities(), ref, async () => {})).rejects.toThrow('held by a stack migration');
});

it('never clears held inputs from callback success, missing receipts or a reader failure', async () => {
  const ref = operation();
  await withMigrationSdk(root, ref, async hold => {
    await hold.retain();
    const read = ref.read;
    ref.read = () => null;
    await expect(hold.release()).rejects.toThrow('matching canonical migration receipt');
    ref.read = () => { throw Error('journal unavailable'); };
    await expect(hold.release()).rejects.toThrow('journal unavailable');
    ref.read = read;
  });
  await expect(assertSdkAvailable(root)).rejects.toThrow('held by a stack migration');
});

it('does not overwrite a newer ownership marker or partially release its other workspace', async () => {
  const ref = operation();
  await withMigrationSdkLocks(await identities(), ref, async hold => {
    await hold.retain(); finish(ref);
    const newer = JSON.stringify({ kind: 'migration', root, id: randomUUID(), review: ref.review, journal: ref.journal });
    await fs.writeFile(marker(source), newer);
    await expect(hold.release()).rejects.toThrow('newer marker preserved');
    expect(await bytes(marker(source))).toBe(newer);
    expect(JSON.parse((await bytes(marker(root)))!).id).toBe(ref.id);
  });
});

it('cleans a known pre-execution failure after a lost ownership-write acknowledgement', async () => {
  const ref = operation(), rename = fs.rename;
  await withMigrationSdkLocks(await identities(), ref, async hold => {
    const fault = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await rename(from, to);
      if (String(to) === marker(source)) throw Error('lost rename acknowledgement');
    });
    await expect(hold.retain()).rejects.toThrow('lost rename acknowledgement');
    fault.mockRestore(); finish(ref); await hold.release();
  });
  expect(await bytes(marker(root))).toBeNull(); expect(await bytes(marker(source))).toBeNull();
});

async function selection(consumer = root) {
  await prepareSdkState(consumer); await prepareSdkState(source);
  const output = path.join(source, 'dist'); await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'index.js'), 'previous');
  const transition = await prepareSdkTransition({ root: consumer, source, paths: [output], guards: [] });
  await beginSdkTransition(transition); await fs.writeFile(path.join(output, 'index.js'), 'current');
  await finishSdkTransition(transition, true);
  return { transition, output };
}

it('preserves real SDK recovery history and prior terminal source ownership', async () => {
  const { transition } = await selection();
  const prior = JSON.stringify({ root, id: transition.journal.id }) + '\n';
  await fs.writeFile(marker(source), prior);
  const history = await bytes(path.join(root, '.omnitron/dev-sdk/transition.json')), ref = operation();
  await withMigrationSdkLocks(await identities(), ref, async hold => {
    await hold.retain();
    // The released watcher protocol accepts only its exact terminal selection.
    const owner = JSON.parse((await bytes(marker(source)))!);
    const retained = await sdkTransitionStatus(owner.root);
    expect(retained?.id).not.toBe(owner.id);
    expect(await bytes(path.join(root, '.omnitron/dev-sdk/transition.json'))).toBe(history);
    finish(ref, 'cancelled'); await hold.release();
  });
  expect(await bytes(marker(source))).toBe(prior);
  expect(await bytes(path.join(root, '.omnitron/dev-sdk/transition.json'))).toBe(history);
});

it('blocks public recovery by another consumer sharing a held source even without an online daemon', async () => {
  const other = path.join(directory, 'other'); await fs.mkdir(other);
  const { output } = await selection(other), ref = operation();
  await withMigrationSdkLocks(await identities(), ref, async hold => { await hold.retain(); finish(ref, 'unknown'); });
  await expect(sdkCommand(['recover', '--project-dir', other])).rejects.toThrow('held by a stack migration');
  expect(await bytes(path.join(output, 'index.js'))).toBe('current');
  expect(await sdkTransitionStatus(other)).toMatchObject({ phase: 'committed' });
});

it('refuses a migration UUID that could be mistaken for an already-terminal SDK selection', async () => {
  const { transition } = await selection(), ref = operation(transition.journal.id);
  await withMigrationSdkLocks(await identities(), ref, async hold => {
    await expect(hold.retain()).rejects.toThrow('already belongs to an SDK selection');
  });
  expect(await bytes(marker(root))).toBeNull(); expect(await bytes(marker(source))).toBeNull();
});

it('refuses to enter a second migration while either canonical SDK lock has a writer', async () => {
  const ref = operation();
  for (const workspace of [root, source]) await exclusively(await prepareSdkState(workspace), async () => {
    const effect = vi.fn();
    await expect(withMigrationSdkLocks(await identities(), ref, effect)).rejects.toThrow('Another development SDK operation');
    expect(effect).not.toHaveBeenCalled();
  });
});

it('completes only terminal cleanup after a lost completion reply, preserving the SDK history', async () => {
  await selection();
  const history = await bytes(path.join(root, '.omnitron/dev-sdk/transition.json'));
  const workspaces = await identities(), ref = operation();
  await expect(withMigrationSdkLocks(workspaces, ref, async hold => {
    await hold.retain(); finish(ref);
    throw Error('process ended after terminal commit');
  })).rejects.toThrow('process ended after terminal commit');
  await expect(assertSdkAvailable(source)).rejects.toThrow('held by a stack migration');
  await releaseTerminalMigrationSdk(workspaces, ref);
  await releaseTerminalMigrationSdk(workspaces, ref);
  expect(await bytes(marker(root))).toBeNull(); expect(await bytes(marker(source))).toBeNull();
  expect(await bytes(path.join(root, '.omnitron/dev-sdk/transition.json'))).toBe(history);
  expect(journal.read(ref.id)?.state).toBe('failed');
});

it('cannot use terminal cleanup to remove an unknown or foreign migration hold', async () => {
  const workspaces = await identities(), ref = operation();
  await withMigrationSdkLocks(workspaces, ref, async hold => { await hold.retain(); finish(ref, 'unknown'); });
  await expect(releaseTerminalMigrationSdk(workspaces, ref)).rejects.toThrow('canonical outcome is terminal');
  const anotherId = randomUUID();
  const another = { ...ref, id: anotherId, read: () => ({ id: anotherId, kind: 'migration', inputDigest: ref.review, state: 'succeeded' }) };
  await expect(releaseTerminalMigrationSdk(workspaces, another)).rejects.toThrow('held by a stack migration');
  expect(JSON.parse((await bytes(marker(source)))!).id).toBe(ref.id);
});
