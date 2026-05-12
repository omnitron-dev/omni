/**
 * Regression test for T#57 — Orchestrator `startApp` lacked a
 * per-name lock so concurrent calls for the same app raced through
 * to parallel `launchBootstrapMode`/`launchClassicMode` calls,
 * spawning duplicate worker pools that competed for the same port
 * and left the orphan-reaper's owned-pid accounting split between
 * two phantoms.
 *
 * Fix: promise coalescing on `entry.name`. The second concurrent
 * call returns the in-flight promise from the first and never
 * triggers a second launch.
 *
 * We exercise the contract surgically: monkey-patch
 * `startAppInternal` with a slow-resolving stub, fire two
 * `startApp(...)` calls in parallel, and assert the internal
 * runs exactly once and both callers receive the same handle.
 */

import { describe, it, expect, vi } from 'vitest';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { ProcessManager } from '../../src/orchestrator/process-manager.js';
import type { StateStore } from '../../src/daemon/state-store.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';

const noopLogger: any = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => noopLogger,
};

describe('OrchestratorService.startApp — per-name coalescing (T#57)', () => {
  it('coalesces concurrent calls for the same app into a single launch', async () => {
    const stateStore = { save: () => undefined, load: () => null, clear: () => undefined } as unknown as StateStore;
    const pm = {} as ProcessManager;
    const svc = new OrchestratorService(noopLogger, pm, stateStore, process.cwd());

    // Replace the heavy internal launch with a controllable stub.
    // We can't run a real launch here without spinning up a child
    // process — and we don't need to. The contract under test is
    // "internal is called exactly once for two parallel callers
    // and both observe the same returned handle."
    let resolveInternal: ((handle: unknown) => void) | undefined;
    const fakeHandle = { name: 'main', status: 'online' } as any;
    const internalSpy = vi.fn().mockImplementation(
      () =>
        new Promise<unknown>((r) => {
          resolveInternal = r;
        }),
    );
    (svc as any).startAppInternal = internalSpy;

    const entry: IEcosystemAppEntry = { name: 'main' };

    const a = svc.startApp(entry);
    const b = svc.startApp(entry);

    // Allow the microtask queue to drain so both startApp calls
    // get a chance to register themselves.
    await new Promise((r) => setImmediate(r));

    // Internal launch ran exactly once even though startApp was
    // called twice.
    expect(internalSpy).toHaveBeenCalledTimes(1);

    // Release the in-flight launch; both callers should receive
    // the same handle.
    resolveInternal!(fakeHandle);
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(fakeHandle);
    expect(rb).toBe(fakeHandle);

    // After settle, a NEW startApp must trigger a fresh internal —
    // the lock is per-launch, not permanent.
    let resolveSecond: ((handle: unknown) => void) | undefined;
    (svc as any).startAppInternal = vi
      .fn()
      .mockImplementation(() => new Promise<unknown>((r) => (resolveSecond = r)));
    const c = svc.startApp(entry);
    await new Promise((r) => setImmediate(r));
    resolveSecond!(fakeHandle);
    await c;
    expect((svc as any).startAppInternal).toHaveBeenCalledTimes(1);
  });

  it('releases the lock on failure so a retry can proceed', async () => {
    const stateStore = { save: () => undefined, load: () => null, clear: () => undefined } as unknown as StateStore;
    const pm = {} as ProcessManager;
    const svc = new OrchestratorService(noopLogger, pm, stateStore, process.cwd());

    const failingInternal = vi.fn().mockRejectedValueOnce(new Error('boom'));
    (svc as any).startAppInternal = failingInternal;

    const entry: IEcosystemAppEntry = { name: 'main' };
    await expect(svc.startApp(entry)).rejects.toThrow(/boom/);

    // The lock must be cleared in the finally — a follow-up call
    // proceeds to a fresh launch rather than being stuck on the
    // rejected promise.
    const okHandle = { name: 'main', status: 'online' } as any;
    (svc as any).startAppInternal = vi.fn().mockResolvedValueOnce(okHandle);
    const second = await svc.startApp(entry);
    expect(second).toBe(okHandle);
  });
});
