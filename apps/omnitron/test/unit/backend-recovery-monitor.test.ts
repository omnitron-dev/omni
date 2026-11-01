import fs from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { BackendRecoveryMonitor } from '../../src/daemon/backend-recovery-monitor.js';
import { BackendRecoveryJournal } from '../../src/daemon/backend-recovery-journal.js';
import { recoveryState } from '../../src/daemon/recovery-state.js';

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
