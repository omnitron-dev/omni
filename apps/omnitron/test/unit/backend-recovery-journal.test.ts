import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { RecoveryState } from '../../src/daemon/recovery-state.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from '../../src/daemon/backend-recovery-journal.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

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
  journal.publish(record); await journal.close();
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
      expect(recovered.read()).toMatchObject({ status: 'invalid', previous: { controller: record.controller } });
    } finally { await recovered.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
});
