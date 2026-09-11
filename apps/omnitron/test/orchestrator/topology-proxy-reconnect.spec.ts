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

import { createReconnectingTopologyProxy } from '../../src/orchestrator/bootstrap-process.js';

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
});
