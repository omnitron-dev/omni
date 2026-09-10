/**
 * A scheduled provider that cannot be resolved must say so.
 *
 * Discovery walks the container's registrations, keeps the classes that
 * carry `@Cron`/`@Interval`/`@Timeout`, and resolves each one. That resolve
 * was wrapped in a bare `catch {}` — "Skip providers that fail to resolve
 * (missing dependencies, etc.)" — so a provider whose dependency graph is
 * broken was dropped without a word. The application then starts cleanly
 * and reports nothing wrong, while the job it was supposed to run simply
 * never happens.
 *
 * That is not hypothetical. A daily key-expiry sweep in a production
 * application went unrun for four months because one of its transitive
 * dependencies was refused by the container's module-access check; the only
 * evidence was the absence of a job nobody was counting.
 *
 * The scheduler still starts — one broken provider must not take down every
 * other job — but the provider, its job count and the underlying error are
 * now reported.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'reflect-metadata';

import { Injectable } from '@omnitron-dev/titan/decorators';
import { SchedulerDiscovery } from '../src/scheduler.discovery.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { Cron, Schedulable } from '../src/scheduler.decorators.js';

@Injectable()
@Schedulable()
class ExpirySweep {
  @Cron('0 30 3 * * *', { name: 'expiry-sweep' })
  run(): void {}
}

@Injectable()
class PlainProvider {
  // No schedule at all. Its failure to resolve is somebody else's problem.
  run(): void {}
}

/** Minimal stand-in for the container internals discovery reaches into. */
const containerWith = (entries: Array<[unknown, unknown]>, failing: Set<unknown>) => {
  const registrations = new Map(entries.map(([token, cls]) => [token, { provider: cls }]));
  return {
    registrations,
    has: (token: unknown) => registrations.has(token),
    resolve: (token: unknown) => {
      if (failing.has(token)) throw new Error('Token not accessible: SomeRepository');
      return new (registrations.get(token) as { provider: new () => unknown }).provider();
    },
    resolveAsync: async (token: unknown) => {
      if (failing.has(token)) throw new Error('Token not accessible: SomeRepository');
      return new (registrations.get(token) as { provider: new () => unknown }).provider();
    },
  };
};

describe('SchedulerDiscovery unresolvable providers', () => {
  let registry: SchedulerRegistry;
  let logged: Array<Record<string, unknown>>;
  let logger: { error: (ctx: Record<string, unknown>, msg: string) => void };

  beforeEach(() => {
    registry = new SchedulerRegistry();
    logged = [];
    logger = { error: (ctx, msg) => logged.push({ ...ctx, msg }) };
  });

  it('reports a scheduled provider it could not resolve', async () => {
    const container = containerWith([[ExpirySweep, ExpirySweep]], new Set([ExpirySweep]));
    const discovery = new SchedulerDiscovery(container as never, registry, undefined, logger as never);

    const jobs = await discovery.discover();

    expect(jobs, 'the job cannot run').toHaveLength(0);
    expect(logged, 'the job vanished without a word').toHaveLength(1);
    expect(logged[0]?.['event']).toBe('scheduler.provider.unresolved');
    expect(logged[0]?.['provider']).toBe('ExpirySweep');
    expect(logged[0]?.['jobs']).toBe(1);
    expect(String((logged[0]?.['err'] as Error).message)).toMatch(/not accessible/);
  });

  it('keeps discovering the other providers', async () => {
    const container = containerWith(
      [
        [ExpirySweep, ExpirySweep],
        ['working', WorkingJob],
      ],
      new Set([ExpirySweep])
    );
    const discovery = new SchedulerDiscovery(container as never, registry, undefined, logger as never);

    const jobs = await discovery.discover();

    expect(jobs.map((j) => j.name)).toEqual(['working-job']);
    expect(logged).toHaveLength(1);
  });

  it('says nothing about a provider that schedules nothing', async () => {
    const container = containerWith([[PlainProvider, PlainProvider]], new Set([PlainProvider]));
    const discovery = new SchedulerDiscovery(container as never, registry, undefined, logger as never);

    await discovery.discover();

    expect(logged, 'an unscheduled provider is not the scheduler’s business').toHaveLength(0);
  });
});

@Injectable()
@Schedulable()
class WorkingJob {
  @Cron('0 0 4 * * *', { name: 'working-job' })
  run(): void {}
}
