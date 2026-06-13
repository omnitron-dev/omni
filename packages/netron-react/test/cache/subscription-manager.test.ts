/**
 * NR-8: SubscriptionManager coverage.
 *
 * The WebSocket subscription layer (real-time events backing useSubscription)
 * had ZERO direct tests. This locks the core contracts: refcounted server
 * subscribe/unsubscribe (one server subscription per event regardless of
 * handler count), the disconnected→pending→resubscribe-on-connect handshake,
 * packet dispatch with per-handler error isolation, disconnect/reconnect
 * re-subscription, and the buffered subscription strategies.
 *
 * Driven by a minimal mock WebSocketClient (on/emit/invoke) — no real socket.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SubscriptionManager } from '../../src/cache/subscription-manager.js';
import type { WebSocketClient } from '@omnitron-dev/netron-browser';

class MockWsClient {
  private handlers = new Map<string, Array<(...a: any[]) => void>>();
  invoke = vi.fn().mockResolvedValue(undefined);

  on(event: string, handler: (...a: any[]) => void): this {
    const arr = this.handlers.get(event) ?? [];
    arr.push(handler);
    this.handlers.set(event, arr);
    return this;
  }

  /** Test helper: fire a client-level event (connect/disconnect/packet). */
  fire(event: string, ...args: any[]): void {
    for (const h of this.handlers.get(event) ?? []) h(...args);
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const eventPacket = (name: string, ...args: unknown[]) => ({ data: ['event', name, ...args] });

describe('SubscriptionManager (NR-8)', () => {
  let ws: MockWsClient;
  let mgr: SubscriptionManager;

  beforeEach(() => {
    ws = new MockWsClient();
    mgr = new SubscriptionManager(ws as unknown as WebSocketClient);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('server subscribe refcounting', () => {
    it('subscribes on the server only for the FIRST handler of an event', async () => {
      ws.fire('connect'); // isConnected = true

      const h1 = vi.fn();
      const h2 = vi.fn();
      mgr.subscribe('orders', h1);
      mgr.subscribe('orders', h2); // second handler — must NOT re-subscribe on server
      await flush();

      const subscribeCalls = ws.invoke.mock.calls.filter(
        ([svc, method, args]) => svc === '__netron__' && method === 'subscribe' && args[0] === 'orders',
      );
      expect(subscribeCalls).toHaveLength(1);
      expect(mgr.getHandlerCount('orders')).toBe(2);
    });

    it('unsubscribes from the server only when the LAST handler is removed', async () => {
      ws.fire('connect');
      const h1 = vi.fn();
      const h2 = vi.fn();
      const off1 = mgr.subscribe('orders', h1);
      const off2 = mgr.subscribe('orders', h2);
      await flush();

      off1();
      expect(mgr.isSubscribed('orders')).toBe(true); // h2 still attached
      let unsub = ws.invoke.mock.calls.filter(([, m]) => m === 'unsubscribe');
      expect(unsub).toHaveLength(0);

      off2();
      unsub = ws.invoke.mock.calls.filter(([svc, m, a]) => svc === '__netron__' && m === 'unsubscribe' && a[0] === 'orders');
      expect(unsub).toHaveLength(1);
      expect(mgr.isSubscribed('orders')).toBe(false);
      expect(mgr.getActiveSubscriptions()).not.toContain('orders');
    });
  });

  describe('connect handshake', () => {
    it('queues a subscription made while disconnected and flushes it on connect', async () => {
      // Not connected yet (fresh manager): subscribe → pending, no server call.
      mgr.subscribe('ticks', vi.fn());
      await flush();
      expect(ws.invoke).not.toHaveBeenCalled();
      expect(mgr.getStats().pendingSubscriptions).toBe(1);

      ws.fire('connect'); // resubscribeAll drains pending
      await flush();
      expect(ws.invoke).toHaveBeenCalledWith('__netron__', 'subscribe', ['ticks']);
      expect(mgr.getStats().pendingSubscriptions).toBe(0);
      expect(mgr.getStats().serverSubscribed).toBe(1);
    });

    it('re-subscribes existing events after a disconnect/reconnect cycle', async () => {
      ws.fire('connect');
      mgr.subscribe('orders', vi.fn());
      await flush();
      expect(mgr.getStats().serverSubscribed).toBe(1);

      ws.fire('disconnect'); // marks serverSubscribed = false, keeps handlers
      expect(mgr.getStats().serverSubscribed).toBe(0);
      expect(mgr.isSubscribed('orders')).toBe(true);

      ws.invoke.mockClear();
      ws.fire('connect'); // resubscribeAll re-subscribes events with handlers
      await flush();
      expect(ws.invoke).toHaveBeenCalledWith('__netron__', 'subscribe', ['orders']);
      expect(mgr.getStats().serverSubscribed).toBe(1);
    });
  });

  describe('packet dispatch', () => {
    it('routes an incoming event packet to all handlers of that event only', () => {
      ws.fire('connect');
      const orders = vi.fn();
      const ticks = vi.fn();
      mgr.subscribe('orders', orders);
      mgr.subscribe('ticks', ticks);

      ws.fire('packet', eventPacket('orders', { id: 1 }));

      expect(orders).toHaveBeenCalledTimes(1);
      expect(orders).toHaveBeenCalledWith([{ id: 1 }]); // handler receives the rest-args array
      expect(ticks).not.toHaveBeenCalled();
    });

    it('isolates a throwing handler so siblings still receive the event', () => {
      ws.fire('connect');
      const bad = vi.fn(() => {
        throw new Error('boom');
      });
      const good = vi.fn();
      mgr.subscribe('orders', bad);
      mgr.subscribe('orders', good);

      expect(() => ws.fire('packet', eventPacket('orders', 'x'))).not.toThrow();
      expect(good).toHaveBeenCalledWith(['x']);
    });

    it('ignores non-event packets', () => {
      ws.fire('connect');
      const h = vi.fn();
      mgr.subscribe('orders', h);
      ws.fire('packet', { data: ['response', 42] });
      ws.fire('packet', { data: undefined });
      expect(h).not.toHaveBeenCalled();
    });
  });

  describe('buffered subscription', () => {
    it('flushes immediately once the buffer reaches `size`', () => {
      vi.useFakeTimers();
      ws.fire('connect');
      const handler = vi.fn();
      mgr.subscribeBuffered('ticks', handler, { size: 3, timeout: 1000, strategy: 'all' });

      ws.fire('packet', eventPacket('ticks', 'a'));
      ws.fire('packet', eventPacket('ticks', 'b'));
      expect(handler).not.toHaveBeenCalled(); // below size
      ws.fire('packet', eventPacket('ticks', 'c'));

      // buffered handler receives each dispatched value (the rest-args array) as one buffer item
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![0]).toEqual([['a'], ['b'], ['c']]);
    });

    it('flushes on timeout with the chosen strategy (latest)', () => {
      vi.useFakeTimers();
      ws.fire('connect');
      const handler = vi.fn();
      mgr.subscribeBuffered('ticks', handler, { size: 100, timeout: 500, strategy: 'latest' });

      ws.fire('packet', eventPacket('ticks', 'a'));
      ws.fire('packet', eventPacket('ticks', 'b'));
      vi.advanceTimersByTime(500);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![0]).toEqual([['b']]); // latest only
    });

    it('flushes remaining buffered items on unsubscribe', () => {
      vi.useFakeTimers();
      ws.fire('connect');
      const handler = vi.fn();
      const off = mgr.subscribeBuffered('ticks', handler, { size: 100, timeout: 5000, strategy: 'all' });

      ws.fire('packet', eventPacket('ticks', 'a'));
      off(); // should flush the pending 'a' before tearing down

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]![0]).toEqual([['a']]);
    });
  });

  describe('stats + cleanup', () => {
    it('reports accurate stats and clears everything on cleanup', async () => {
      ws.fire('connect');
      mgr.subscribe('a', vi.fn());
      mgr.subscribe('a', vi.fn());
      mgr.subscribe('b', vi.fn());
      await flush();

      let stats = mgr.getStats();
      expect(stats.totalSubscriptions).toBe(2);
      expect(stats.totalHandlers).toBe(3);

      mgr.cleanup();
      stats = mgr.getStats();
      expect(stats.totalSubscriptions).toBe(0);
      expect(stats.totalHandlers).toBe(0);
      expect(mgr.getActiveSubscriptions()).toEqual([]);
    });
  });
});
