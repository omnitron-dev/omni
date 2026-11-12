import fs from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendRecoveryMonitor } from '../../src/daemon/backend-recovery-monitor.js';
import { BackendRecoveryJournal } from '../../src/daemon/backend-recovery-journal.js';
import { RecoveryState, recoveryState } from '../../src/daemon/recovery-state.js';

const fixtures: Array<{ root: string; monitor: BackendRecoveryMonitor; journal: BackendRecoveryJournal }> = [];
afterEach(async () => {
  for (const { root, monitor, journal } of fixtures.splice(0)) {
    await monitor.close(false); await journal.close(); fs.rmSync(root, { recursive: true, force: true });
  }
  vi.useRealTimers();
});

function fixture(inFlight: () => number) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const root = fs.mkdtempSync('/tmp/omni-checkpoint-'); fs.chmodSync(root, 0o700);
  const snapshot = vi.fn(async () => ({ status: { phase: 'active', inFlight: inFlight(),
    controller: { ownerId: 'owner', controllerId: 'backend', epoch: 1 } }, inventoryDigest: 'c'.repeat(64) }));
  const monitor = new BackendRecoveryMonitor(root, { runtimeHash: 'a'.repeat(64), entry: '/test/entry.js' } as never,
    { executionHost: { enabled: true } } as never, { recoverySnapshot: snapshot } as never,
    () => ({ watchConfig: { apps: [] }, infrastructure: null, projects: {
      captureRecoveryState: () => ({}), recoveryRegistryDigest: () => 'b'.repeat(64),
    } }) as never);
  const journal = new BackendRecoveryJournal(root);
  fixtures.push({ root, monitor, journal });
  return { monitor, journal, snapshot };
}

it('certifies between brief mutations aligned with the normal sampling period', async () => {
  const { monitor, journal, snapshot } = fixture(() => Date.now() % 5000 < 100 ? 1 : 0);
  await monitor.start();
  expect(monitor.status().status).toBe('pending');
  expect(journal.read()?.status).toBe('invalid');
  await vi.advanceTimersByTimeAsync(250);
  expect(monitor.status().status).toBe('ready');
  expect(journal.read()?.status).toBe('ready');
  await vi.advanceTimersByTimeAsync(5000);
  expect(monitor.status().status).toBe('ready');
  expect(snapshot).toHaveBeenCalledTimes(4);
});

it('keeps a busy owner uncertified, bounds extra queries and cancels retries on close', async () => {
  const { monitor, journal, snapshot } = fixture(() => 1);
  await monitor.start();
  await vi.advanceTimersByTimeAsync(4999);
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(monitor.status().status).toBe('pending');
  expect(journal.read()?.status).toBe('invalid');
  await vi.advanceTimersByTimeAsync(1); // another regular attempt, with a retry pending
  await monitor.close(false);
  await vi.advanceTimersByTimeAsync(10000);
  expect(snapshot).toHaveBeenCalledTimes(3);
});

it('does not certify a snapshot invalidated by concurrent ownership mutation', async () => {
  const { monitor, journal } = fixture(() => {
    recoveryState.run('concurrent-ownership-change', () => undefined);
    return 0;
  });
  await monitor.start();
  expect(monitor.status().status).toBe('pending');
  expect(journal.read()?.status).toBe('invalid');
});

it('reports the operations still running when a later reconciler invalidation has already finished', async () => {
  const { monitor, journal, snapshot } = fixture(() => 0);
  await monitor.start();
  const outer = Promise.withResolvers<void>(), inner = Promise.withResolvers<void>();
  const outerRun = recoveryState.run('Backup or restore in progress', () => outer.promise);
  const innerRun = recoveryState.run('Backup or restore in progress', () => inner.promise);
  try {
    recoveryState.run('reconcileEnabledStacks', () => undefined);
    expect(monitor.status()).toMatchObject({ status: 'pending',
      reason: 'Waiting for ownership operations: Backup or restore in progress (2)' });
    await monitor.capture();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(journal.read()?.status).toBe('invalid');
    inner.resolve(); await innerRun;
    expect(monitor.status().reason).toBe('Waiting for ownership operations: Backup or restore in progress');
    outer.resolve(); await outerRun;
    await monitor.capture();
    expect(monitor.status()).toMatchObject({ status: 'ready', reason: null });
    expect(journal.read()?.status).toBe('ready');
  } finally {
    inner.resolve(); outer.resolve(); await Promise.all([innerRun, outerRun]);
  }
});

it('releases failed operations without releasing an overlapping ownership fence', async () => {
  const state = new RecoveryState();
  const invalidate = vi.fn(); state.attach(invalidate);
  const pending = Promise.withResolvers<void>();
  const active = state.run('backup', () => pending.promise);
  try {
    expect(() => state.run('read-config', () => { throw Error('invalid config'); })).toThrow('invalid config');
    await expect(state.run('backup', async () => { throw Error('dump failed'); })).rejects.toThrow('dump failed');
    const observed = state.pendingOperations();
    expect(observed).toEqual([{ reason: 'backup', count: 1 }]);
    observed[0]!.count = 0;
    expect(state.pendingOperations()).toEqual([{ reason: 'backup', count: 1 }]);
    expect(state.token()).toBeNull();
    pending.resolve(); await active;
    expect(state.pendingOperations()).toEqual([]);
    expect(state.unchanged(state.token()!)).toBe(true);
  } finally { pending.resolve(); await active; }
});

it('refuses a mutation before tracking it when write-ahead invalidation fails', () => {
  const state = new RecoveryState();
  const invalidate = vi.fn(); state.attach(invalidate);
  invalidate.mockImplementation(() => { throw Error('journal unavailable'); });
  const work = vi.fn();
  const before = state.token();
  expect(() => state.run('backup', work)).toThrow('journal unavailable');
  expect(work).not.toHaveBeenCalled();
  expect(state.pendingOperations()).toEqual([]);
  expect(state.token()).toBe(before);
});
