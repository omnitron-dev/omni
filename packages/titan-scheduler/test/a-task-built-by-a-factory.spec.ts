/**
 * A `@Cron` on a class the container builds by FACTORY was never scheduled.
 *
 * Discovery walks registrations and read the PROVIDER to find the class, in
 * two shapes only — a bare class and `useClass`. A task registered `useValue`,
 * or built by a `useFactory` because its construction needs other services,
 * was skipped: no error, no log, just work that does not happen. That is the
 * same absence a sibling test in this directory exists for, reached by a
 * different route.
 *
 * The same blind spot was found the same day in Netron's auto-exposure, where
 * it left a `@Service` built, held in the container, and unreachable —
 * `Health@1.0.0` answering 404 on a live application while that module's
 * database and Redis indicators ran on a timer for nobody.
 *
 * The token names the class whenever a module files a provider under the class
 * itself, which is the usual shape, and reading it resolves nothing.
 */
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import { Injectable } from '@omnitron-dev/titan/decorators';
import { SchedulerDiscovery } from '../src/scheduler.discovery.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { Cron, Schedulable } from '../src/scheduler.decorators.js';

@Injectable()
@Schedulable()
class ByFactory {
  @Cron('0 0 3 * * *', { name: 'built-by-factory' })
  run(): void {}
}

@Injectable()
@Schedulable()
class ByValue {
  @Cron('0 0 4 * * *', { name: 'built-by-value' })
  run(): void {}
}

@Injectable()
@Schedulable()
class ByClassToken {
  @Cron('0 0 5 * * *', { name: 'built-plainly' })
  run(): void {}
}

const SYMBOLIC = Symbol('OpaqueTaskToken');

function containerWith(entries: Array<[unknown, unknown]>) {
  const registrations = new Map(entries.map(([token, provider]) => [token, { provider }]));
  const instances = new Map<unknown, unknown>();
  const build = (token: unknown): unknown => {
    if (instances.has(token)) return instances.get(token);
    const provider = (registrations.get(token) as { provider: any }).provider;
    const made =
      typeof provider === 'function'
        ? new provider()
        : provider.useValue !== undefined
          ? provider.useValue
          : provider.useFactory();
    instances.set(token, made);
    return made;
  };
  return {
    registrations,
    has: (token: unknown) => registrations.has(token),
    resolve: build,
    resolveAsync: async (token: unknown) => build(token),
  };
}

async function discovered(container: unknown): Promise<string[]> {
  const registry = new SchedulerRegistry();
  const discovery = new SchedulerDiscovery(container as never, registry, undefined, undefined);
  const jobs = await discovery.discover();
  return jobs.map((j) => j.name);
}

describe('a task the container builds by factory is scheduled', () => {
  it('finds it when the factory is filed under the task class', async () => {
    const names = await discovered(
      containerWith([
        [ByFactory, { useFactory: () => new ByFactory() }],
        [ByClassToken, ByClassToken],
      ]),
    );

    expect(names, 'the control: a plain class registration').toContain('built-plainly');
    expect(names, 'the token is the class, and it carries the job metadata').toContain(
      'built-by-factory',
    );
  });

  it('and one provided by value, which was skipped too', async () => {
    const names = await discovered(containerWith([[ByValue, { useValue: new ByValue() }]]));
    expect(names).toContain('built-by-value');
  });

  it('a factory under a symbolic token stays invisible, knowingly', async () => {
    // Nothing there names a class without resolving it, and discovery that
    // resolves in order to look depends on resolution order — which the
    // two-pass design exists to avoid. Recorded as a decision.
    const names = await discovered(
      containerWith([
        [SYMBOLIC, { useFactory: () => new ByFactory() }],
        [ByClassToken, ByClassToken],
      ]),
    );
    expect(names, 'the control, so an empty list cannot pass this').toContain('built-plainly');
    expect(names).not.toContain('built-by-factory');
  });
});
