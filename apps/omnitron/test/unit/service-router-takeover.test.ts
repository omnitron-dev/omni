/**
 * A restart must not leave the daemon holding a dead registration.
 *
 * `launchTopology` builds a fresh `ServiceRouter` on every app launch, so
 * after a restart the router's own map is empty while the daemon's Netron
 * still holds the registration from the previous launch — bound to a pool
 * whose workers are gone. The guard asked the empty map, found nothing, and
 * called `exposeService`, which threw `Service already exposed`. The caller
 * logs that and carries on, so the daemon kept the DEAD registration.
 *
 * The symptom is not a failure to resolve: `queryInterface` still returns the
 * full method list, because the definition is there. It is the first real call
 * that throws `Socket closed during RPC`, on every tick, for the life of the
 * daemon. Measured on 2026-09-11: pricing's OHLCV aggregation stopped for
 * forty minutes across three restarts and only `omnitron down && up` cleared it.
 */

import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { SERVICE_ANNOTATION } from '@omnitron-dev/titan/decorators';

import { ServiceRouter } from '../../src/orchestrator/service-router.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

/** A Netron peer that refuses a second expose under the same name, as the real one does. */
function fakeNetron() {
  const exposed = new Map<string, unknown>();
  return {
    exposed,
    netron: {
      peer: {
        // Keyed the way the real peer keys it: the @Service metadata the
        // router attaches to the proxy's constructor.
        exposeService: vi.fn(async (instance: object) => {
          const meta = Reflect.getMetadata?.(SERVICE_ANNOTATION, instance.constructor) as
            | { name: string; version: string }
            | undefined;
          const name = meta ? `${meta.name}@${meta.version}` : instance.constructor.name;
          if (exposed.has(name)) throw new Error(`Service already exposed: ${name}`);
          exposed.set(name, instance);
        }),
        unexposeService: vi.fn(async (qualifiedName: string) => {
          if (!exposed.has(qualifiedName)) throw new Error(`Unknown service: ${qualifiedName}`);
          exposed.delete(qualifiedName);
        }),
      },
    } as never,
  };
}

const pool = (id: string) => ({ execute: async () => id }) as never;

describe('exposing a pool service a second time', () => {
  it('takes over the name instead of leaving the previous registration', async () => {
    const { netron, exposed } = fakeNetron();

    // First launch.
    const first = new ServiceRouter(netron, logger);
    await first.exposePoolService('ohlcv-aggregator', 'OhlcvAggregatorWorker', '1.0.0', pool('old'), ['getStats']);
    expect(exposed.size).toBe(1);
    const before = exposed.get('OhlcvAggregatorWorker@1.0.0');

    // App restarts: a NEW router, with an empty map, against the same daemon.
    const second = new ServiceRouter(netron, logger);
    await second.exposePoolService('ohlcv-aggregator', 'OhlcvAggregatorWorker', '1.0.0', pool('new'), ['getStats']);

    expect(exposed.size).toBe(1);
    // The whole defect in one assertion: this used to still be the old proxy,
    // routing to a pool that no longer had workers.
    expect(exposed.get('OhlcvAggregatorWorker@1.0.0')).not.toBe(before);
    expect(second.getServiceNames()).toContain('OhlcvAggregatorWorker@1.0.0');
  });

  it('does not throw on the ordinary first launch', async () => {
    const { netron, exposed } = fakeNetron();
    const router = new ServiceRouter(netron, logger);
    await expect(
      router.exposePoolService('transform', 'TransformWorker', '1.0.0', pool('a'), ['ping'])
    ).resolves.toBeUndefined();
    expect(exposed.size).toBe(1);
  });

  it('re-exposing through the SAME router also replaces', async () => {
    // A pool replaced in place is the same situation from the other side.
    const { netron, exposed } = fakeNetron();
    const router = new ServiceRouter(netron, logger);
    await router.exposePoolService('p', 'Svc', '1.0.0', pool('one'), ['m']);
    const before = exposed.get('Svc@1.0.0');
    await router.exposePoolService('p', 'Svc', '1.0.0', pool('two'), ['m']);
    expect(exposed.size).toBe(1);
    expect(exposed.get('Svc@1.0.0')).not.toBe(before);
  });
});
