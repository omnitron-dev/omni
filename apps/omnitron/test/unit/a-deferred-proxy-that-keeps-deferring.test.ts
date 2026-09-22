/**
 * What makes the startup race cheap, pinned so it cannot quietly stop being
 * true.
 *
 * `a-race-at-startup-reported-as-a-failure` covers the window where a
 * sibling service registers a beat after this process asks for it. The
 * reason that window was survivable at all — before and after that fix — is
 * `createDeferredTopologyProxy`: when the query fails, the token is still
 * registered, and the proxy connects and asks again the first time a
 * consumer calls a method on it.
 *
 * Nothing tested that. So the retry fix rests on behaviour nobody checks,
 * which is the shape of defect this repository keeps finding — a guarantee
 * held by a comment. Raised by omni-03 reviewing the fix; these are his
 * conditions.
 *
 * Two properties matter, and the second is the one that could rot silently:
 *
 *   1. A first resolution that FAILS does not poison the proxy. It stays
 *      deferred, and a later call tries again.
 *   2. A successful resolution is not repeated — the live handle is kept, so
 *      a consumer calling in a loop does not reconnect to the daemon on
 *      every call.
 */

import { describe, it, expect, vi } from 'vitest';

import { createDeferredTopologyProxy } from '../../src/orchestrator/bootstrap-process.js';

/** A netron whose `connect` fails `failures` times, then works. */
function netronThatWarmsUp(failures: number) {
  let connects = 0;
  const handle = { getAllStats: vi.fn(async () => [{ exchange: 'binance', connected: true }]) };
  return {
    connects: () => connects,
    handle,
    connect: vi.fn(async () => {
      connects += 1;
      if (connects <= failures) throw new Error(`Service 'CollectorWorker' not found`);
      return { queryInterface: vi.fn(async () => handle) };
    }),
  };
}

describe('a deferred proxy that keeps deferring', () => {
  it('a failed resolution leaves the proxy able to try again', async () => {
    const netron = netronThatWarmsUp(1);
    const proxy = createDeferredTopologyProxy(netron as never, 'CollectorWorker', 'unix:///tmp/d.sock') as {
      getAllStats: () => Promise<unknown>;
    };

    await expect(proxy.getAllStats(), 'the first call sees the service missing').rejects.toThrow(
      /unavailable/,
    );

    // The service registers in between.
    const stats = await proxy.getAllStats();

    expect(stats, 'and the second call gets it').toEqual([{ exchange: 'binance', connected: true }]);
    expect(netron.connects(), 'which took a second connect, not a cached failure').toBe(2);
  });

  it('a resolved proxy keeps its handle instead of reconnecting per call', async () => {
    // Control: consumers call this on every tick and every poll. Re-resolving
    // each time would turn a five-minute scheduler into a connection storm.
    const netron = netronThatWarmsUp(0);
    const proxy = createDeferredTopologyProxy(netron as never, 'CollectorWorker', 'unix:///tmp/d.sock') as {
      getAllStats: () => Promise<unknown>;
    };

    await proxy.getAllStats();
    await proxy.getAllStats();
    await proxy.getAllStats();

    expect(netron.connects(), 'one connect for three calls').toBe(1);
    expect(netron.handle.getAllStats).toHaveBeenCalledTimes(3);
  });

  it('the failure a consumer sees names the service', async () => {
    // Control: «unavailable» with no name was how a missing sibling read as
    // a generic outage.
    const netron = netronThatWarmsUp(Number.POSITIVE_INFINITY);
    const proxy = createDeferredTopologyProxy(netron as never, 'OhlcvAggregatorWorker', 'unix:///tmp/d.sock') as {
      aggregate5Min: () => Promise<unknown>;
    };

    await expect(proxy.aggregate5Min()).rejects.toThrow(/OhlcvAggregatorWorker/);
  });
});
