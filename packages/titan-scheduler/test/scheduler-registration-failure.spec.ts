/**
 * A scheduled job that fails to register must not disappear quietly.
 *
 * `SchedulerDiscovery.registerJob` returned `null` for two situations that
 * mean opposite things:
 *
 *   - `options.disabled` — the developer turned this job off;
 *   - `catch { return null }` — registration THREW, and the error was
 *     discarded without being logged, named or counted.
 *
 * The caller does `if (job) jobs.push(job)`, so both look identical from
 * outside. The realistic failure is a name collision: `registry.registerJob`
 * throws `JOB_ALREADY_EXISTS` when two definitions claim one name, and the
 * loser then never runs. Nothing logs it, the application reports a
 * successful start, and the first evidence is a nightly task that did not
 * happen.
 *
 * Fail-fast is this module's existing answer to configuration that would
 * otherwise produce silently wrong behaviour — `onStart` already refuses to
 * run distributed mode without a lock provider rather than fire every job on
 * every node.
 *
 * What must NOT become an error is the same job reached twice. A class
 * registered under two tokens resolves to two instances, and both carry the
 * same `@Cron`; that job is already registered and will run. So the conflict
 * is compared by class and method, and only a collision between genuinely
 * different definitions — where one of them is guaranteed never to run — is
 * raised.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'reflect-metadata';

import { Injectable } from '@omnitron-dev/titan/decorators';
import { SchedulerDiscovery } from '../src/scheduler.discovery.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { Cron, Schedulable } from '../src/scheduler.decorators.js';

@Injectable()
@Schedulable()
class NightlyReport {
  @Cron('0 3 * * *', { name: 'nightly' })
  run(): void {}
}

@Injectable()
@Schedulable()
class NightlyCleanup {
  // A different job, same name. One of the two can never run.
  @Cron('0 4 * * *', { name: 'nightly' })
  run(): void {}
}

@Injectable()
@Schedulable()
class DisabledJob {
  @Cron('0 5 * * *', { name: 'switched-off', disabled: true })
  run(): void {}
}

describe('SchedulerDiscovery registration failures', () => {
  let registry: SchedulerRegistry;
  let discovery: SchedulerDiscovery;

  beforeEach(() => {
    registry = new SchedulerRegistry();
    discovery = new SchedulerDiscovery(null, registry);
  });

  it('refuses a name claimed by a different job instead of dropping one', async () => {
    await discovery.discoverProviderJobs(new NightlyReport());

    await expect(discovery.discoverProviderJobs(new NightlyCleanup())).rejects.toThrow(/nightly/);
  });

  it('names the losing job and the class it came from', async () => {
    await discovery.discoverProviderJobs(new NightlyReport());

    // The message has to be enough to act on without a debugger: two classes
    // claim one name, and the developer has to know which two.
    await expect(discovery.discoverProviderJobs(new NightlyCleanup())).rejects.toThrow(/NightlyCleanup/);
  });

  it('stays silent when the same job is reached twice', async () => {
    // Two instances of one class: registered under two tokens, resolved twice.
    // The job exists and will run — there is nothing to report.
    const first = await discovery.discoverProviderJobs(new NightlyReport());
    const second = await discovery.discoverProviderJobs(new NightlyReport());

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(registry.getJobCount()).toBe(1);
  });

  it('still treats a disabled job as absent rather than failed', async () => {
    const jobs = await discovery.discoverProviderJobs(new DisabledJob());

    expect(jobs).toHaveLength(0);
    expect(registry.hasJob('switched-off')).toBe(false);
  });

  it('propagates a registry failure that is not a name collision', async () => {
    // Anything the registry can throw other than a conflict is information
    // that only exists once. Swallowing it loses the job AND the reason.
    const exploding = {
      registerJob() {
        throw new Error('registry is out of order');
      },
      getJob: () => undefined,
    } as unknown as SchedulerRegistry;

    const isolated = new SchedulerDiscovery(null, exploding);

    await expect(isolated.discoverProviderJobs(new NightlyReport())).rejects.toThrow(
      /registry is out of order/
    );
  });
});
