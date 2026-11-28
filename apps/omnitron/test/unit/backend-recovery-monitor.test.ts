import fs from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendRecoveryMonitor } from '../../src/daemon/backend-recovery-monitor.js';
import { BackendRecoveryJournal } from '../../src/daemon/backend-recovery-journal.js';
import { OmnitronDaemon } from '../../src/daemon/daemon.js';
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

it.each([false, true])('re-reads the same owner after a busy snapshot (inventory changed: %s)', async changed => {
  const { monitor } = fixture(() => 0);
  const grant = { ownerId: 'owner', controllerId: 'backend', epoch: 1 };
  const busy = { status: { phase: 'active', inFlight: 1, controller: grant }, inventoryDigest: 'c'.repeat(64) };
  const idle = { status: { ...busy.status, inFlight: 0 }, inventoryDigest: changed ? 'd'.repeat(64) : busy.inventoryDigest };
  const readOwner = vi.fn().mockResolvedValueOnce(busy).mockResolvedValue(idle);
  const projects = { recoveryRegistryDigest: () => 'b'.repeat(64), captureRecoveryState: () => ({
    projects: [], stacks: [], infrastructure: [], resumeBackoff: [], reconciling: false,
  }) };
  const daemon: OmnitronDaemon = Object.assign(Object.create(OmnitronDaemon.prototype), {
    recoveryMonitor: monitor, execution: { controlledOwnerSnapshot: readOwner }, watchConfig: { apps: [] },
    app: { container: { resolveAsync: async () => projects } },
    backendRuntimeStatus: () => ({ phase: 'active', blockers: {}, recovery: { status: 'ready' } }),
  });
  const review = daemon.reviewBackendHandoff();
  const assertion = changed ? expect(review).rejects.toThrow('ownership changed') :
    expect(review).resolves.toMatchObject({ admission: { backend: { controller: grant }, backups: [] } });
  await vi.advanceTimersByTimeAsync(250);
  await assertion;
  expect(readOwner.mock.calls.slice(1).every(([expected]) => expected === grant)).toBe(true);
  expect(readOwner).toHaveBeenCalledTimes(changed ? 2 : 3);
});

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

it('permits a read-only token for exact known operations without certifying them', async () => {
  const state = new RecoveryState(), done = Promise.withResolvers<void>();
  state.hold('owned-backup', 'backup');
  const active = state.run('backup', () => done.promise);
  try {
    const allowed = new Map([['backup', 1]]), holds = new Set(['owned-backup']);
    expect(state.reviewToken(allowed, holds)).not.toBeNull();
    expect(state.token()).toBeNull();
    expect(state.reviewToken(new Map(), holds)).toBeNull();
    state.hold('foreign-operation', 'restore');
    expect(state.reviewToken(allowed, holds)).toBeNull();
    state.release('foreign-operation');
    expect(state.reviewToken(allowed, holds)).not.toBeNull();
  } finally { done.resolve(); await active; state.release('owned-backup'); }
});

it('joins the current certification instead of returning before its ownership observation', async () => {
  const { monitor, snapshot } = fixture(() => 0);
  const observe = snapshot.getMockImplementation()!;
  const barrier = Promise.withResolvers<void>();
  snapshot.mockImplementation(async () => { await barrier.promise; return observe(); });
  const first = monitor.capture(), second = monitor.capture();
  expect(second).toBe(first);
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(monitor.status().status).toBe('pending');
  barrier.resolve(); await Promise.all([first, second]);
  expect(monitor.status().status).toBe('ready');
});

it('waits for a certificate when a completed observation still reports a busy owner', async () => {
  const { monitor, journal } = fixture(() => Date.now() < 500 ? 1 : 0);
  let settled = false;
  const admission = monitor.certify(1000).then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(250);
  expect(settled).toBe(false);
  expect(journal.read()?.status).toBe('invalid');
  await vi.advanceTimersByTimeAsync(250);
  await admission;
  expect(monitor.status().status).toBe('ready');
  expect(journal.read()?.status).toBe('ready');
});

it('bounds certification of a busy owner and does not leave an admission retry running', async () => {
  const { monitor, journal, snapshot } = fixture(() => 1);
  const admission = expect(monitor.certify(500)).rejects.toThrow('Recovery certification did not settle');
  await vi.advanceTimersByTimeAsync(500);
  await admission;
  expect(journal.read()?.status).toBe('invalid');
  const queries = snapshot.mock.calls.length;
  await vi.advanceTimersByTimeAsync(5000);
  expect(snapshot).toHaveBeenCalledTimes(queries);
});

it('fails certification immediately on an invalid observation instead of retrying it as busy', async () => {
  const { monitor, snapshot, journal } = fixture(() => 0);
  snapshot.mockRejectedValue(new Error('Invalid owner identity'));
  await expect(monitor.certify()).rejects.toThrow('Invalid owner identity');
  expect(journal.read()?.status).toBe('invalid');
  expect(snapshot).toHaveBeenCalledTimes(1);
});

it('does not grant admission from an observation that finishes after the monitor closes', async () => {
  const { monitor, snapshot } = fixture(() => 0);
  const observe = snapshot.getMockImplementation()!;
  const barrier = Promise.withResolvers<void>();
  snapshot.mockImplementation(async () => { await barrier.promise; return observe(); });
  const admission = expect(monitor.certify()).rejects.toThrow('Recovery monitor is closed');
  await monitor.close(false);
  barrier.resolve();
  await admission;
});
