/**
 * A service registration outlives the process behind it.
 *
 * `ServiceRouter` registers an app's topology services on the DAEMON's Netron,
 * and the daemon lives far longer than any app. Two paths dropped an app while
 * its registrations were still live:
 *
 *   - `registerApp`'s stale-duplicate branch deletes an errored or stopped
 *     handle outright. `stopApp` never ran for it, so nothing ever gave the
 *     services back — and that branch is the one a CRASHED app takes when it
 *     is re-registered under a different key.
 *   - `stopApp` did give them back, but by spelling the loop out itself, so
 *     the teardown existed in one place and was missing in the other.
 *
 * `takeOverExisting` rescues a name the next launch re-exposes (see
 * `service-router-takeover.test.ts`). A name the next launch does NOT
 * re-expose — a changed topology, a launch that fails before exposing — stays
 * advertised, bound to a pool whose workers are gone, for the life of the
 * daemon. `queryInterface` answers with the full method list and the first
 * real call throws at the socket.
 *
 * The router now owns its own teardown, and both paths call it.
 */

import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import { SERVICE_ANNOTATION } from '@omnitron-dev/titan/decorators';

import { ServiceRouter } from '../../src/orchestrator/service-router.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function fakeNetron() {
  const exposed = new Map<string, unknown>();
  return {
    exposed,
    netron: {
      peer: {
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

describe('the router gives back what it registered', () => {
  it('releases every service it holds', async () => {
    const net = fakeNetron();
    const router = new ServiceRouter(net.netron, logger);

    await router.exposePoolService('ohlcv', 'OhlcvAggregator', '1.0.0', pool('a'), ['aggregate']);
    await router.exposePoolService('candles', 'CandleWriter', '1.0.0', pool('b'), ['write']);
    expect(net.exposed.size).toBe(2);

    await router.releaseAll();

    expect(net.exposed.size, 'the daemon still advertises a dead app’s services').toBe(0);
    expect(router.getServiceNames()).toEqual([]);
  });

  it('does not stop at the first name that is already gone', async () => {
    // The daemon may have dropped a registration on its own — a peer
    // disconnect, a previous takeover. That must not leave the rest behind.
    const net = fakeNetron();
    const router = new ServiceRouter(net.netron, logger);

    await router.exposePoolService('a', 'Alpha', '1.0.0', pool('a'), ['go']);
    await router.exposePoolService('b', 'Beta', '1.0.0', pool('b'), ['go']);
    net.exposed.delete('Alpha@1.0.0');

    await router.releaseAll();

    expect(net.exposed.size).toBe(0);
    expect(router.getServiceNames()).toEqual([]);
  });

  it('is safe to call twice', async () => {
    const net = fakeNetron();
    const router = new ServiceRouter(net.netron, logger);
    await router.exposePoolService('a', 'Alpha', '1.0.0', pool('a'), ['go']);

    await router.releaseAll();
    await expect(router.releaseAll()).resolves.toBeUndefined();
    expect(net.exposed.size).toBe(0);
  });

  it('lets the name be exposed again afterwards', async () => {
    // The point of giving a name back: the next launch must be able to take it
    // without relying on `takeOverExisting` to clean up after the last one.
    const net = fakeNetron();
    const router = new ServiceRouter(net.netron, logger);
    await router.exposePoolService('a', 'Alpha', '1.0.0', pool('old'), ['go']);
    await router.releaseAll();

    const next = new ServiceRouter(net.netron, logger);
    await next.exposePoolService('a', 'Alpha', '1.0.0', pool('new'), ['go']);

    expect(net.exposed.has('Alpha@1.0.0')).toBe(true);
  });
});

describe('both orchestrator paths release before dropping the handle', () => {
  /** Comments are stripped: the prose explaining the call contains the call. */
  function bodyOf(fnName: string): string {
    const src = require('node:fs').readFileSync(
      new URL('../../src/orchestrator/orchestrator.service.ts', import.meta.url),
      'utf8',
    ) as string;
    const bare = src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, (_m: string, p1: string) => p1);
    const at = bare.indexOf(fnName);
    return at === -1 ? '' : bare.slice(at, at + 4000);
  }

  it('stopApp releases through the router rather than looping itself', () => {
    const body = bodyOf('async stopApp(');
    expect(body).toContain('releaseExposedServices');
    expect(
      /for \(const svcName of [\s\S]{0,60}getServiceNames\(\)\)/.test(body),
      'the teardown loop is inline again — it belongs on the router',
    ).toBe(false);
  });

  it('the stale-duplicate branch releases before deleting the handle', () => {
    const body = bodyOf('Replacing stale duplicate handle');
    const releaseAt = body.indexOf('releaseExposedServices');
    const deleteAt = body.indexOf('this.handles.delete(key)');
    expect(releaseAt, 'the handle is dropped with its services still registered').toBeGreaterThan(0);
    expect(deleteAt).toBeGreaterThan(releaseAt);
  });
});
