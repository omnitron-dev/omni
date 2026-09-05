/**
 * `persistenceProvider` and `metricsProvider` must actually be used.
 *
 * Both are declared in ISchedulerModuleOptions as customisation points, with
 * doc comments saying "Custom persistence provider" / "Custom metrics
 * provider". Neither was read: the module registered its built-in classes
 * unconditionally, so a caller who supplied a token got the built-in service
 * and their jobs persisted somewhere other than where they configured — with
 * no error and no log to say so.
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';

import { SchedulerModule } from '../src/scheduler.module.js';
import { SCHEDULER_PERSISTENCE_TOKEN, SCHEDULER_METRICS_TOKEN } from '../src/scheduler.constants.js';

/** The provider entry registered for a token, whatever its shape. */
function providerFor(providers: unknown[], token: unknown): Record<string, unknown> | undefined {
  for (const entry of providers) {
    if (Array.isArray(entry) && entry[0] === token) {
      return entry[1] as Record<string, unknown>;
    }
  }
  return undefined;
}

describe('SchedulerModule provider overrides', () => {
  const CustomPersistence = Symbol('CustomPersistence');
  const CustomMetrics = Symbol('CustomMetrics');

  it('uses the built-in services when nothing is supplied', () => {
    const module = SchedulerModule.forRoot({});
    const persistence = providerFor(module.providers as unknown[], SCHEDULER_PERSISTENCE_TOKEN);

    expect(persistence).toBeDefined();
    expect(persistence!['useClass']).toBeDefined();
    expect(persistence!['useExisting']).toBeUndefined();
  });

  it('aliases the persistence token to a supplied provider', () => {
    const module = SchedulerModule.forRoot({ persistenceProvider: CustomPersistence as never });
    const persistence = providerFor(module.providers as unknown[], SCHEDULER_PERSISTENCE_TOKEN);

    expect(persistence!['useExisting']).toBe(CustomPersistence);
    expect(persistence!['useClass']).toBeUndefined();
  });

  it('aliases the metrics token to a supplied provider', () => {
    const module = SchedulerModule.forRoot({ metricsProvider: CustomMetrics as never });
    const metrics = providerFor(module.providers as unknown[], SCHEDULER_METRICS_TOKEN);

    expect(metrics!['useExisting']).toBe(CustomMetrics);
  });

  it('honours the same overrides from forRootAsync', () => {
    // The providers are chosen when the module is built, not inside the
    // factory, so they cannot come from the resolved config — which is why
    // the async options carry these fields too.
    const module = SchedulerModule.forRootAsync({
      useFactory: () => ({}),
      persistenceProvider: CustomPersistence as never,
      metricsProvider: CustomMetrics as never,
    });

    expect(providerFor(module.providers as unknown[], SCHEDULER_PERSISTENCE_TOKEN)!['useExisting']).toBe(
      CustomPersistence
    );
    expect(providerFor(module.providers as unknown[], SCHEDULER_METRICS_TOKEN)!['useExisting']).toBe(CustomMetrics);
  });
});
