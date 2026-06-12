/**
 * NB-4: ConnectionManager auto-reconnect.
 *
 * Two bugs the old code had:
 *  1. A dropped connection was rescheduled with a HARDCODED factory that always
 *     threw ("Connection factory not provided"), so disconnect-triggered
 *     reconnection could never succeed — it just looped on the throw.
 *  2. The reconnect attempt count was read from the just-removed
 *     ManagedConnection (always 0), so the exponential backoff never escalated
 *     and `maxAttempts` never tripped — an infinite baseDelay reconnect loop.
 *
 * Fix: a per-peer reconnect factory (registered via addConnection) + a surviving
 * per-peer attempt counter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { ConnectionManager } from '../../../src/transport/connection-manager.js';

function makeConn(): any {
  const conn: any = new EventEmitter();
  conn.close = vi.fn(async () => {});
  conn.ping = vi.fn(async () => {});
  conn.getMetrics = () => ({ bytesSent: 0, bytesReceived: 0 });
  return conn;
}

describe('ConnectionManager auto-reconnect (NB-4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('reconnects via the registered per-peer factory when a connection drops', async () => {
    const mgr = new ConnectionManager({
      reconnect: { enabled: true, baseDelay: 100, maxDelay: 1000, maxAttempts: 5, jitterFactor: 0 },
    });
    mgr.start();

    const conn1 = makeConn();
    const conn2 = makeConn();
    const factory = vi.fn(async () => conn2);
    mgr.addConnection('peer1', conn1, factory);

    const reconnected = vi.fn();
    mgr.on('connection:reconnected', reconnected);

    // Drop the connection → disconnect handler schedules a reconnect with the
    // REGISTERED factory (not the old throwing placeholder).
    conn1.emit('disconnect');
    await vi.advanceTimersByTimeAsync(150); // past baseDelay (jitter disabled)

    expect(factory).toHaveBeenCalledTimes(1);
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(mgr.hasAvailableConnection('peer1')).toBe(true);

    await mgr.stop();
  });

  it('escalates backoff and gives up after maxAttempts when the factory keeps failing', async () => {
    const mgr = new ConnectionManager({
      reconnect: { enabled: true, baseDelay: 100, maxDelay: 10_000, maxAttempts: 3, jitterFactor: 0 },
    });
    mgr.start();

    const conn1 = makeConn();
    const failing = vi.fn(async () => {
      throw new Error('cannot connect');
    });
    mgr.addConnection('peer1', conn1, failing);

    const failed = vi.fn();
    mgr.on('connection:reconnect_failed', failed);

    conn1.emit('disconnect');

    // Surviving counter ⇒ exponential backoff 100 → 200 → 400, then give up.
    await vi.advanceTimersByTimeAsync(100); // attempt 1
    await vi.advanceTimersByTimeAsync(200); // attempt 2
    await vi.advanceTimersByTimeAsync(400); // attempt 3
    await vi.advanceTimersByTimeAsync(800); // give-up check (no further timer)

    expect(failing).toHaveBeenCalledTimes(3); // exactly maxAttempts — not an infinite loop
    expect(failed).toHaveBeenCalledTimes(1);

    await mgr.stop();
  });

  it('does NOT reconnect when no factory was registered for the peer', async () => {
    const mgr = new ConnectionManager({
      reconnect: { enabled: true, baseDelay: 100, maxDelay: 1000, maxAttempts: 5, jitterFactor: 0 },
    });
    mgr.start();

    const conn1 = makeConn();
    mgr.addConnection('peer1', conn1); // no factory

    const reconnecting = vi.fn();
    mgr.on('connection:reconnecting', reconnecting);

    conn1.emit('disconnect');
    await vi.advanceTimersByTimeAsync(500);

    // Without a factory there is nothing to reconnect with — and crucially NO
    // throwing-placeholder loop.
    expect(reconnecting).not.toHaveBeenCalled();
    expect(mgr.hasAvailableConnection('peer1')).toBe(false);

    await mgr.stop();
  });
});
