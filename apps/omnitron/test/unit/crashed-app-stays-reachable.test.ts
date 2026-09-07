/**
 * An app that exhausts its restart budget must still answer the operator.
 *
 * Omnitron escalates a hopeless app to `crashed` and then, ten minutes later,
 * resets the budget and tries once more — "bounded self-healing", by its own
 * comment. The wait was implemented as a lifecycle-queue op whose `run()`
 * slept for the whole cool-down.
 *
 * The lifecycle queue serialises per app name and, by design, will not preempt
 * a RUNNING head: `if (i === 0 && queue.running) continue`. With an empty
 * queue the sleeper became the head immediately, so it was never preemptible
 * and the `onPreempt` hook written to cancel it could not fire. Every operator
 * command for that app queued behind ten minutes of sleep. Observed on the
 * dev stand: `omnitron restart daos/dev/main` and `omnitron stop daos/dev/main`
 * each returned `RPC request timed out after 60000ms` having logged nothing,
 * `omnitron start` refused a project-scoped name, and `omnitron stack start`
 * reported "5/6 apps online" without attempting the sixth. The only recovery
 * left was restarting the daemon — for a process manager, that is the one
 * failure it exists to prevent.
 *
 * Worse than hanging: the timed-out ops stayed queued, to fire against the app
 * whenever the cool-down finally elapsed.
 *
 * So the cool-down now waits on a plain timer the orchestrator owns, and the
 * queue slot is taken only for the restart attempt itself. The three
 * properties that matter are asserted below: the operator gets through, a stop
 * still means stay-down, and self-healing still heals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

function config(maxRestarts = 2): IEcosystemConfig {
  return {
    apps: [],
    supervision: {
      strategy: 'one_for_one',
      maxRestarts,
      window: 60_000,
      backoff: { type: 'exponential', initial: 50, max: 200, factor: 2 },
    },
    monitoring: { healthCheck: { interval: 15_000, timeout: 5_000 }, metrics: { interval: 5_000, retention: 3_600_000 } },
    logging: { level: 'info', maxSize: '50mb', maxFiles: 10, compress: true, databaseRetentionDays: 14 },
  } as unknown as IEcosystemConfig;
}

function orchestrator() {
  const pm: any = { getWorkerHandle: () => undefined, getProcess: () => undefined };
  const stateStore: any = { save() {}, load: () => null };
  return new OrchestratorService(logger, pm, stateStore, process.cwd());
}

const entry: IEcosystemAppEntry = { name: 'demo', script: './demo.js' } as IEcosystemAppEntry;

/** Run `demo` into the ground until the budget escalates it to `crashed`. */
async function driveToCrashed(orch: any, cfg: IEcosystemConfig) {
  const attempts = { n: 0 };
  orch.launchClassicMode = async () => {
    attempts.n++;
    throw new Error('Worker startup timed out after 30000ms');
  };
  await expect(orch.startApp(entry, cfg)).rejects.toThrow();
  // Past every backoff the policy can produce, well short of the cool-down.
  await vi.advanceTimersByTimeAsync(30_000);
  expect(orch.handles.get('demo').status, 'the budget escalated it').toBe('crashed');
  return attempts;
}

describe('a crashed app keeps answering the operator during its cool-down', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('completes a stop without waiting out the ten-minute cool-down', async () => {
    const orch: any = orchestrator();
    await driveToCrashed(orch, config());

    let settled = false;
    const stopping = orch.stopApp('demo').then(
      () => { settled = true; },
      () => { settled = true; },
    );

    // A second of app time — three orders of magnitude short of the
    // cool-down. If the stop is queued behind it, nothing settles.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled, 'the operator stop must not wait out the cool-down').toBe(true);
    await stopping;
  });

  it('completes a restart without waiting out the cool-down', async () => {
    const orch: any = orchestrator();
    await driveToCrashed(orch, config());

    let settled = false;
    const restarting = orch.restartApp('demo').then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled, 'the operator restart must not wait out the cool-down').toBe(true);
    await restarting;
  });

  it('does not resurrect an app the operator stopped', async () => {
    const orch: any = orchestrator();
    const attempts = await driveToCrashed(orch, config());

    await orch.stopApp('demo');
    const before = attempts.n;

    // Past the cool-down. A stop means stay down.
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(attempts.n, 'a stopped app must not come back on its own').toBe(before);
  });

  it('still heals on its own when nobody intervenes', async () => {
    const orch: any = orchestrator();
    const attempts = await driveToCrashed(orch, config());
    const before = attempts.n;

    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(attempts.n, 'the cool-down must still try again').toBeGreaterThan(before);
  });
});
