/**
 * Regression test for T#63 — `OrchestratorService.startApp` did not
 * run the cold-start orphan reap because the reap was gated on
 * `startAll`. Project-mode boots flow through
 * `projectService.startStack → orchestrator.startApp` and bypass
 * `startAll` entirely, so a previous daemon's children (now
 * reparented to init) survived the new daemon's boot and held
 * their listen ports hostage from their successors.
 *
 * Fix: extract `ensureBootReconciled()` and arm it from BOTH entry
 * points. One-shot — the first caller pays the reap cost, every
 * subsequent caller is a fast bool check.
 *
 * Contract pinned here:
 *   1. First `startApp` call triggers `coldStartSweep` + janitor
 *      `start()` before launching the app.
 *   2. Subsequent `startApp` calls don't re-fire the reconcile.
 *   3. Concurrent first `startApp`s share the in-flight reconcile.
 *   4. `startAll` exhibits the same one-shot behaviour (idempotent
 *      with `startApp`-driven reconcile).
 */

import { describe, it, expect, vi } from 'vitest';

/**
 * `ensureBootReconciled` calls `discoverManagedProcesses()` before it reaches
 * the janitor, and that function walks `ps` synchronously.
 *
 * The janitor stub below carries a comment saying this test "never shells out
 * to `ps`". It was wrong: the stub covers the sweep, not the discovery pass
 * ahead of it, and the two are separate calls on the same path.
 *
 * What that cost, measured: this file timed out twice in a full run — at 30s
 * and at 102s — while passing three times out of three on its own, and in
 * isolation the `ps` walk is 20% of the file's runtime against 0% with it
 * mocked. Both timeouts happened with something heavy running alongside (a
 * `turbo build`, then a browser), and `ps` on this machine enumerates the
 * daemon, six apps and Docker. This suite runs with `fileParallelism: false`,
 * so it is external load rather than sibling workers — the first version of
 * this note said "a hundred parallel workers", which is not what happens
 * here.
 *
 * The mock removes the dependency rather than making it faster, which is the
 * part that does not depend on getting the mechanism right.
 *
 * Mocked at the module boundary because the import is resolved at module
 * scope in `orchestrator.service.ts`, so nothing the test does to the
 * instance can reach it.
 */
vi.mock('@omnitron-dev/titan-pm', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  discoverManagedProcesses: () => [],
}));

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

function makeService() {
  const stateStore = { save: () => undefined, load: () => null, clear: () => undefined } as unknown as StateStore;
  const pm = {} as ProcessManager;
  const svc = new OrchestratorService(noopLogger, pm, stateStore, process.cwd());

  // Inject a janitor stub so the sweep never shells out and never starts a
  // real periodic timer. The discovery pass that runs before it is mocked at
  // the module boundary above — see the note there.
  const coldStart = vi.fn().mockResolvedValue(0);
  const start = vi.fn();
  const stop = vi.fn();
  const stubJanitor: any = { coldStartSweep: coldStart, start, stop };
  (svc as any).janitor = stubJanitor;

  // Stub the launch path — we only care about whether the reconcile
  // fires, not about the heavy spawn machinery.
  const fakeHandle = { name: 'app', status: 'online' } as any;
  const internalSpy = vi.fn().mockResolvedValue(fakeHandle);
  (svc as any).startAppInternal = internalSpy;

  return { svc, coldStart, start, stop, internalSpy };
}

describe('OrchestratorService.ensureBootReconciled — T#63', () => {
  it('first startApp triggers coldStartSweep + janitor.start exactly once', async () => {
    const { svc, coldStart, start } = makeService();
    await svc.startApp({ name: 'main' } as IEcosystemAppEntry);
    expect(coldStart).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('subsequent startApp calls do not re-run the reconcile', async () => {
    const { svc, coldStart, start } = makeService();
    await svc.startApp({ name: 'a' } as IEcosystemAppEntry);
    await svc.startApp({ name: 'b' } as IEcosystemAppEntry);
    await svc.startApp({ name: 'c' } as IEcosystemAppEntry);
    expect(coldStart).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('concurrent first calls share the in-flight reconcile', async () => {
    const { svc, coldStart, start } = makeService();
    // Make the reconcile slow so both calls are guaranteed to land
    // before it completes.
    let resolveReap: ((n: number) => void) | undefined;
    coldStart.mockImplementation(
      () =>
        new Promise<number>((r) => {
          resolveReap = r;
        }),
    );

    const a = svc.startApp({ name: 'a' } as IEcosystemAppEntry);
    const b = svc.startApp({ name: 'b' } as IEcosystemAppEntry);

    // Both calls have registered against the in-flight reconcile;
    // neither has resolved.
    await new Promise((r) => setImmediate(r));
    expect(coldStart).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(0); // start() runs AFTER coldStart resolves

    resolveReap!(0);
    await Promise.all([a, b]);

    expect(coldStart).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('startApp then startAll is idempotent — reconcile fires once total', async () => {
    const { svc, coldStart, start } = makeService();
    await svc.startApp({ name: 'first' } as IEcosystemAppEntry);
    // Build a minimal ecosystem config — startAll iterates `apps`
    // but the heavy startApp path is already stubbed.
    const config: any = {
      apps: [{ name: 'second' }],
      monitoring: { metrics: { interval: 60_000 } },
    };
    await svc.startAll(config);

    expect(coldStart).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
