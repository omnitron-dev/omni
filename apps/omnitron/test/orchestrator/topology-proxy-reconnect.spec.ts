/**
 * A topology proxy has to survive losing its connection.
 *
 * The interface `queryInterface` returns is bound to one socket. When that
 * socket goes — a daemon restart, a transport hiccup, anything — every later
 * call rejects with "Socket closed during RPC", and nothing reconnects:
 * consumers resolve the token once, at construction, so they keep calling the
 * same dead object until the process is restarted.
 *
 * Seen exactly that way. pricing's OHLCV aggregation failed on every
 * five-minute tick with that message while the same service on the daemon
 * answered a freshly connected client immediately, and the app process held
 * zero open connections to the daemon socket.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

import {
  createReconnectingTopologyProxy,
  createDeferredTopologyProxy,
} from '../../src/orchestrator/bootstrap-process.js';

const proxyFor = (netron: unknown, serviceName: string, url: string, initial: unknown) =>
  createReconnectingTopologyProxy(netron as never, serviceName, url, initial);

const closedError = () => new Error('Socket closed during RPC');

describe('topology proxy reconnection', () => {
  it('reconnects and retries a call that lost its socket', async () => {
    const dead = { getStats: vi.fn().mockRejectedValue(closedError()) };
    const fresh = { getStats: vi.fn().mockResolvedValue({ ok: true }) };
    const queryInterface = vi.fn().mockResolvedValue(fresh);
    const netron = { connect: vi.fn().mockResolvedValue({ queryInterface }) };

    const proxy = proxyFor(netron, 'OhlcvAggregatorWorker', 'unix:///tmp/d.sock', dead) as {
      getStats(): Promise<unknown>;
    };

    await expect(proxy.getStats()).resolves.toEqual({ ok: true });
    expect(netron.connect).toHaveBeenCalledTimes(1);
    expect(queryInterface).toHaveBeenCalledWith('OhlcvAggregatorWorker');
  });

  it('does not reconnect for an error the service itself raised', async () => {
    // A method that threw on its own terms is an answer, not a broken pipe.
    const live = { aggregate5Min: vi.fn().mockRejectedValue(new Error('nothing to aggregate')) };
    const netron = { connect: vi.fn() };

    const proxy = proxyFor(netron, 'Worker', 'unix:///tmp/d.sock', live) as {
      aggregate5Min(): Promise<unknown>;
    };

    await expect(proxy.aggregate5Min()).rejects.toThrow('nothing to aggregate');
    expect(netron.connect).not.toHaveBeenCalled();
  });

  it('surfaces the original failure when reconnecting also fails', async () => {
    // The caller asked about their call, not about the reconnect.
    const dead = { ping: vi.fn().mockRejectedValue(closedError()) };
    const netron = { connect: vi.fn().mockRejectedValue(new Error('daemon is gone')) };

    const proxy = proxyFor(netron, 'Worker', 'unix:///tmp/d.sock', dead) as { ping(): Promise<unknown> };

    await expect(proxy.ping()).rejects.toThrow('Socket closed during RPC');
  });

  it('reconnects once for concurrent calls', async () => {
    const dead = {
      a: vi.fn().mockRejectedValue(closedError()),
      b: vi.fn().mockRejectedValue(closedError()),
    };
    const fresh = { a: vi.fn().mockResolvedValue('a'), b: vi.fn().mockResolvedValue('b') };
    const netron = {
      connect: vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ queryInterface: vi.fn().mockResolvedValue(fresh) }), 10)
          )
      ),
    };

    const proxy = proxyFor(netron, 'Worker', 'unix:///tmp/d.sock', dead) as {
      a(): Promise<unknown>;
      b(): Promise<unknown>;
    };

    await expect(Promise.all([proxy.a(), proxy.b()])).resolves.toEqual(['a', 'b']);
    expect(netron.connect, 'each call opened its own connection').toHaveBeenCalledTimes(1);
  });

  /**
   * The second way a handle goes stale, and the one with no way back.
   *
   * A reconnect that lands while the worker's service is not yet registered on
   * the daemon gets an interface WITHOUT the methods. `current` is replaced by
   * it, and every later call fails on a name — `Unknown member: 'aggregate5Min'
   * is not defined in the service interface` — which is not a socket error, so
   * nothing re-queried and the proxy was wrong until the app restarted. Two of
   * those on the stand, either side of a worker-pool restart.
   */
  describe('a handle that came back without the methods', () => {
    const unknownMember = () =>
      new Error("Unknown member: 'aggregate5Min' is not defined in the service interface");

    it('re-queries and retries rather than staying wrong forever', async () => {
      const stale = { aggregate5Min: vi.fn().mockRejectedValue(unknownMember()) };
      const fresh = { aggregate5Min: vi.fn().mockResolvedValue({ success: true, processed: 7 }) };
      const queryInterface = vi.fn().mockResolvedValue(fresh);
      const netron = { connect: vi.fn().mockResolvedValue({ queryInterface }) };

      const proxy = proxyFor(netron, 'OhlcvAggregatorWorker', 'unix:///tmp/d.sock', stale) as {
        aggregate5Min(): Promise<{ processed: number }>;
      };

      await expect(proxy.aggregate5Min()).resolves.toEqual({ success: true, processed: 7 });
      expect(queryInterface).toHaveBeenCalledWith('OhlcvAggregatorWorker');
    });

    it('still raises when the method is genuinely absent', async () => {
      // Widening the retry class must not turn a real mistake into silence:
      // one re-query, the same error, and the caller hears it.
      const stale = { typo: vi.fn().mockRejectedValue(unknownMember()) };
      const alsoStale = { typo: vi.fn().mockRejectedValue(unknownMember()) };
      const netron = {
        connect: vi.fn().mockResolvedValue({ queryInterface: vi.fn().mockResolvedValue(alsoStale) }),
      };

      const proxy = proxyFor(netron, 'Worker', 'unix:///tmp/d.sock', stale) as { typo(): Promise<unknown> };

      await expect(proxy.typo()).rejects.toThrow(/Unknown member/);
      expect(netron.connect, 'it must try exactly once, not spin').toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The deadline half. A topology call is a worker-pool JOB, and netron's 5 s
   * default is a deadline for a wire request: `connect()` reads
   * `requestTimeout` out of the transport registry, and this path registered
   * the unix transport without options. 70 of the 97 `OHLCV … aggregation
   * failed` lines on the stand were `RPC request timed out after 5000ms`,
   * scattered through healthy runs between ticks that succeeded.
   *
   * Asserted on the SOURCE with comments stripped — the prose above contains
   * every string being looked for, and a test that reads its own explanation
   * passes on a fix that has been reverted.
   */
  it('gives topology connections a job-sized deadline, not the wire default', () => {
    const raw = fs.readFileSync(
      new URL('../../src/orchestrator/bootstrap-process.ts', import.meta.url),
      'utf8',
    );
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, (_m, p1: string) => p1);

    const at = code.indexOf("registerTransport('unix'");
    expect(at, 'the unix transport registration moved — re-point this test').toBeGreaterThan(0);

    // Applied to the same transport, right where it is registered.
    const after = code.slice(at, at + 400);
    expect(after).toMatch(/setTransportOptions\(\s*'unix'[\s\S]{0,120}requestTimeout/);

    const value = /TOPOLOGY_REQUEST_TIMEOUT\s*=\s*([0-9_]+)/.exec(code)?.[1];
    expect(value, 'no topology deadline is declared at all').toBeTruthy();
    const ms = Number(value!.replace(/_/g, ''));
    // Longer than the wire default it replaces, and inside the 5-minute
    // aggregation interval so a genuine hang still surfaces on the next tick.
    expect(ms).toBeGreaterThan(5_000);
    expect(ms).toBeLessThan(5 * 60_000);
  });
});
/**
 * And a proxy for a service that was not there YET.
 *
 * When the first `queryInterface` failed, the child registered a proxy that
 * throws on every call for the life of the process — so a service that
 * appeared a second later was never seen. For a pool that is rare: pools
 * register before any consumer starts. For a sibling child it is the normal
 * case, because provider and consumer are children of one supervisor and the
 * provider can only be asked for its services after they have all started.
 *
 * Measured on priceverse: `CollectorWorker` registered on the daemon seven
 * seconds after the server process asked for it, and the server's health
 * check answered
 *
 *     Topology service 'CollectorWorker' unavailable: Service 'CollectorWorker' not found
 *
 * to every call for the rest of that process's life — while the same service,
 * queried from a fresh client, answered `6 exchanges, 6 connected`.
 */
describe('a topology service that was not there yet', () => {
  it('asks again on use, and answers once it is there', async () => {
    const live = { getAllStats: vi.fn().mockResolvedValue([{ exchange: 'binance', connected: true }]) };
    const queryInterface = vi
      .fn()
      .mockRejectedValueOnce(new Error("Service 'CollectorWorker' not found"))
      .mockResolvedValue(live);
    const netron = { connect: vi.fn().mockResolvedValue({ queryInterface }) };

    const proxy = createDeferredTopologyProxy(
      netron as never,
      'CollectorWorker',
      'unix:///tmp/d.sock',
    ) as { getAllStats(): Promise<unknown> };

    // First call: still absent, and the reason is the one from THIS attempt.
    await expect(proxy.getAllStats()).rejects.toThrow(/CollectorWorker' unavailable.*not found/);

    // Second: it has registered in the meantime.
    await expect(proxy.getAllStats()).resolves.toEqual([{ exchange: 'binance', connected: true }]);
    expect(queryInterface).toHaveBeenCalledTimes(2);
  });

  it('asks once, not once per call, after it succeeds', async () => {
    const live = { getAllStats: vi.fn().mockResolvedValue([]) };
    const queryInterface = vi.fn().mockResolvedValue(live);
    const netron = { connect: vi.fn().mockResolvedValue({ queryInterface }) };

    const proxy = createDeferredTopologyProxy(netron as never, 'CollectorWorker', 'unix:///tmp/d.sock') as {
      getAllStats(): Promise<unknown>;
    };

    await proxy.getAllStats();
    await proxy.getAllStats();
    await proxy.getAllStats();

    expect(queryInterface).toHaveBeenCalledTimes(1);
  });

  it('keeps reconnecting once it has a handle', async () => {
    // What it hands over to is the reconnecting proxy, so a socket lost
    // later is still recovered — the two halves compose.
    const dead = { getAllStats: vi.fn().mockRejectedValueOnce(closedError()).mockResolvedValue(['after']) };
    const queryInterface = vi.fn().mockResolvedValue(dead);
    const netron = { connect: vi.fn().mockResolvedValue({ queryInterface }) };

    const proxy = createDeferredTopologyProxy(netron as never, 'CollectorWorker', 'unix:///tmp/d.sock') as {
      getAllStats(): Promise<unknown>;
    };

    await expect(proxy.getAllStats()).resolves.toEqual(['after']);
    // One query to resolve it, one to re-query after the closed socket.
    expect(queryInterface).toHaveBeenCalledTimes(2);
  });

  it('does not hold a failed attempt against the next one', async () => {
    const queryInterface = vi.fn().mockRejectedValue(new Error('daemon is down'));
    const netron = { connect: vi.fn().mockResolvedValue({ queryInterface }) };

    const proxy = createDeferredTopologyProxy(netron as never, 'CollectorWorker', 'unix:///tmp/d.sock') as {
      getAllStats(): Promise<unknown>;
    };

    await expect(proxy.getAllStats()).rejects.toThrow(/daemon is down/);
    await expect(proxy.getAllStats()).rejects.toThrow(/daemon is down/);
    expect(queryInterface).toHaveBeenCalledTimes(2);
  });
});
