/**
 * `shutdownTimeout: 0` waited half a minute.
 *
 *     const timeout = this.config?.shutdownTimeout || 30000;
 *     await this.waitForJobsCompletion(timeout);
 *
 * `0` is an operator saying «do not wait for running jobs — stop now», and
 * `0 || 30000` is the opposite instruction. A scheduler told to stop
 * immediately held its shutdown for thirty seconds against whatever was
 * still running, which is the difference between a deploy that finishes and
 * one that gets killed by its supervisor half a minute later.
 *
 * The fourth appearance of one shape in a single day, all of them mine or
 * next to mine: `port: 0` read as absent in netron's WebSocket transport (on
 * two layers), then in its TCP transport, then `TITAN_SHUTDOWN_TIMEOUT_MS=0`
 * read as 5000 by both of titan-pm's readers. The rule is narrow and it is
 * not «never use `||`»: it is that a zero which the caller can state ON
 * PURPOSE — a port, a window, a deadline — must be read with `??`.
 */

import { describe, it, expect, vi } from 'vitest';

import { SchedulerService } from '../src/scheduler.service.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { SchedulerExecutor } from '../src/scheduler.executor.js';
import type { ISchedulerConfig } from '../src/scheduler.interfaces.js';

function schedulerWith(shutdownTimeout: number | undefined, runningJobs: number) {
  const config: ISchedulerConfig = {
    enabled: true,
    maxConcurrent: 5,
    queueSize: 100,
    ...(shutdownTimeout === undefined ? {} : { shutdownTimeout }),
  };
  const registry = new SchedulerRegistry(config);
  const executor = new SchedulerExecutor(config);
  // A scheduler with nothing running stops instantly whatever the window is,
  // so the window is only observable while something IS running.
  vi.spyOn(executor, 'getRunningJobCount').mockReturnValue(runningJobs);
  vi.spyOn(executor, 'cancelAllJobs').mockImplementation(() => undefined as never);
  return new SchedulerService(registry, executor, config);
}

/**
 * `onStop` returns immediately unless the scheduler was started — which the
 * first draft of this court did not do, so every case passed in 0 ms and the
 * control case is what caught it. A court that cannot reach the code it
 * describes is worse than none.
 */
async function running(scheduler: SchedulerService): Promise<SchedulerService> {
  await scheduler.onStart();
  return scheduler;
}

describe('a zero shutdown timeout waited thirty seconds', () => {
  it('stops at once when told not to wait', async () => {
    const scheduler = await running(schedulerWith(0, 1));

    const started = Date.now();
    await scheduler.onStop();
    const waited = Date.now() - started;

    // Under `|| 30000` this sat for thirty seconds against a job that never
    // finishes. The loop polls at 100 ms, so anything under a second is the
    // zero being honoured.
    expect(waited, 'a stated zero means stop now').toBeLessThan(1_000);
  });

  it('still waits when a window was actually named', async () => {
    // Control: the window has to keep working, or «stop now» would just be
    // the new behaviour for everyone.
    const scheduler = await running(schedulerWith(300, 1));

    const started = Date.now();
    await scheduler.onStop();
    const waited = Date.now() - started;

    expect(waited, 'a named window is respected').toBeGreaterThanOrEqual(250);
    expect(waited, 'and not extended to the default').toBeLessThan(5_000);
  });

  it('falls back when nothing was said', async () => {
    // Control: absent is not zero. A config that never mentions the timeout
    // must still get the default, which is why `??` and not a bare read.
    const scheduler = await running(schedulerWith(undefined, 0));

    await expect(scheduler.onStop()).resolves.toBeUndefined();
  });
});
