import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { RecoveryState } from '../../src/daemon/recovery-state.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from '../../src/daemon/backend-recovery-journal.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

it('opens an existing recovery certificate read-only and never initializes a missing journal', async () => {
  const root = await fs.mkdtemp('/tmp/omni-recovery-'); roots.push(root);
  await fs.chmod(root, 0o700);
  expect(() => new BackendRecoveryJournal(root, { readOnly: true })).toThrow();
  expect(await fs.readdir(root)).toEqual([]);
  const journal = new BackendRecoveryJournal(root);
  journal.invalidate('fixture mutation'); await journal.close();
  const file = path.join(root, 'recovery.db'), before = await fs.readFile(file);
  const reader = new BackendRecoveryJournal(root, { readOnly: true });
  try {
    expect(reader.read()).toMatchObject({ status: 'invalid', reason: 'fixture mutation' });
    expect(() => reader.invalidate('not allowed')).toThrow('read-only');
    expect(() => reader.publish({} as BackendRecoveryRecord)).toThrow('read-only');
  } finally { await reader.close(); }
  expect(await fs.readFile(file)).toEqual(before);
});

it('invalidates before a synchronous side effect and refuses mutation when durability fails', () => {
  const state = new RecoveryState();
  let invalidated = false;
  const detach = state.attach(() => { invalidated = true; });
  invalidated = false;
  state.run('change', () => { expect(invalidated).toBe(true); expect(state.token()).toBeNull(); });
  detach();
  let refused = false;
  state.attach(() => { if (refused) throw new Error('disk unavailable'); });
  refused = true;
  let called = false;
  expect(() => state.run('change', () => { called = true; })).toThrow('disk unavailable');
  expect(called).toBe(false);
});

it('retains distinct invalidations across reopen and signals when their bounded evidence is incomplete', async () => {
  const root = await fs.mkdtemp('/tmp/omni-recovery-'); roots.push(root);
  const first = new BackendRecoveryJournal(root);
  try {
    first.invalidate('loadProjectConfig');
    first.invalidate('startStack');
    first.invalidate('loadProjectConfig');
    expect(first.read()).toMatchObject({ reason: 'loadProjectConfig', reasons: ['loadProjectConfig', 'startStack'] });
  } finally { await first.close(); }
  const reopened = new BackendRecoveryJournal(root);
  try {
    reopened.invalidate('operation-0');
    const firstAt = reopened.read()!.at;
    for (let i = 0; i < 16; i++) reopened.invalidate('operation-' + i);
    const state = reopened.read();
    expect(state).toMatchObject({ status: 'invalid', reason: 'loadProjectConfig', at: firstAt, additionalReasons: true });
    if (state?.status !== 'invalid') throw Error('Missing invalidation');
    expect(state.reasons).toHaveLength(16);
    expect(state.reasons!.slice(0, 2)).toEqual(['loadProjectConfig', 'startStack']);
    reopened.invalidate('later mutation');
    expect(reopened.read()).toEqual(state);
  } finally { await reopened.close(); }
});

it('does not certify overlapping or failed asynchronous operations as the previous generation', async () => {
  const state = new RecoveryState();
  state.attach(() => {});
  const token = state.token()!;
  let release!: () => void;
  const pending = state.run('change', () => new Promise<void>(resolve => { release = resolve; }));
  expect(state.token()).toBeNull();
  await expect(state.run('failure', async () => { throw new Error('partial operation'); })).rejects.toThrow('partial');
  expect(state.token()).toBeNull();
  release(); await pending;
  expect(state.unchanged(token)).toBe(false);
  expect(state.token()).not.toBeNull();
});

it('leaves a durable invalidation after an actual SIGKILL inside an unfinished operation', async () => {
  const root = await fs.mkdtemp('/tmp/omni-recovery-'); roots.push(root);
  await fs.chmod(root, 0o700);
  const journal = new BackendRecoveryJournal(root);
  const record = { protocol: 1, runtimeHash: 'a'.repeat(64), registryDigest: 'b'.repeat(64),
    state: { protocol: 1, executionInventory: 'c'.repeat(64) },
    controller: { ownerId: 'test-owner', controllerId: 'test-backend', epoch: 1 }, previousPid: 999,
    previousEntry: '/test/entry.js', cwd: root, daemonConfig: { executionHost: { enabled: true } }, environment: {},
  } as BackendRecoveryRecord;
  journal.publish(record);
  const certifiedAt = journal.read()!.at;
  await journal.close();
  const source = fileURLToPath(new URL('../../src/daemon/backend-recovery-journal.ts', import.meta.url));
  const tracker = fileURLToPath(new URL('../../src/daemon/recovery-state.ts', import.meta.url));
  const script = path.join(root, 'mutation.mjs');
  await fs.writeFile(script, `import { BackendRecoveryJournal } from ${JSON.stringify(source)};
    import { RecoveryState } from ${JSON.stringify(tracker)};
    const journal = new BackendRecoveryJournal(${JSON.stringify(root)});
    const state = new RecoveryState(); state.attach(reason => journal.invalidate(reason));
    await state.run('unfinished deployment', async () => {
      process.send({ type: 'entered' }); await new Promise(() => setInterval(() => {}, 1000));
    });`);
  const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture did not reach its mutation')), 10000);
      child.once('error', reject);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture exited early')); });
      child.once('message', () => { clearTimeout(timer); resolve(); });
    });
    child.kill('SIGKILL'); await exited;
    const recovered = new BackendRecoveryJournal(root);
    try {
      const before = recovered.read()!;
      expect(before).toMatchObject({ status: 'invalid', previous: { controller: record.controller }, previousCertifiedAt: certifiedAt });
      recovered.invalidate('new process startup');
      expect(recovered.read()).toMatchObject({ at: before.at, reason: 'Controller startup has not published a recovery snapshot',
        previousCertifiedAt: certifiedAt, reasons: expect.arrayContaining(['unfinished deployment', 'new process startup']) });
    } finally { await recovered.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
});
