/**
 * The reconnect backoff never backed off.
 *
 * `WebSocketClient` documents "1s → 2s → 4s → 8s → 16s → 30s cap with ±25%
 * jitter", and `attemptReconnect` computes exactly that. The counter it
 * computes from was reset in the `open` handler — on the socket OPENING,
 * not on it working.
 *
 * A gateway in front of a backend that is not answering completes the
 * upgrade and drops the socket at once. So: open → reset to 0 → close →
 * attempt 1, delay 1000 → open → reset to 0 → … Measured in the downstream portal
 * while messaging was restarting: **328 opens and 328 reconnects,
 * alternating, every one reported as «attempt 1, delay 1000ms»**. One tab
 * hammering a down service once a second for as long as it stayed down, and
 * a log line claiming a backoff the whole time.
 *
 * A socket that opens is not a connection that works. The counter is reset
 * on CLOSE now, and only for a session that lasted `STABLE_CONNECTION_MS` —
 * evidence the far side is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WebSocketClient } from '../../src/client/ws-client.js';

/** The smallest socket that can open, be closed, and report it. */
class ScriptedSocket {
  static instances: ScriptedSocket[] = [];
  static openDelay = 0;

  binaryType = 'arraybuffer';
  readyState = 0;
  url: string;
  private listeners = new Map<string, Array<(e: any) => void>>();

  constructor(url: string) {
    this.url = url;
    ScriptedSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.fire('open', {});
    }, ScriptedSocket.openDelay);
  }

  addEventListener(type: string, fn: (e: any) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 3;
    this.fire('close', { code: 1006, reason: 'gone', wasClean: false });
  }
  /** The far side hanging up — what a proxy does over a dead backend. */
  serverClose() {
    this.readyState = 3;
    this.fire('close', { code: 1006, reason: 'backend unavailable', wasClean: false });
  }
  private fire(type: string, e: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

function build() {
  const client = new WebSocketClient({
    url: 'ws://localhost:1/never',
    reconnect: true,
    reconnectInterval: 1000,
    maxReconnectAttempts: Infinity,
    timeout: 30_000,
  });
  const reconnects: Array<{ attempt: number; delay: number }> = [];
  client.on('reconnecting', (info: { attempt: number; delay: number }) => {
    reconnects.push({ attempt: info.attempt, delay: info.delay });
  });
  return { client, reconnects };
}

/**
 * One full cycle: let the pending socket open, keep it alive `aliveMs`, have
 * the server hang up, then advance exactly the delay the client scheduled so
 * the next socket is created.
 *
 * The "advance exactly the scheduled delay" part is load-bearing. The first
 * version of this helper advanced a flat 60 s between cycles, which meant
 * every socket had been open for ~59 s by the time it was closed — so the
 * client reset the counter, correctly, and the test read [1, 1, 1, 1] and
 * blamed the code. The fixture has to be able to express the difference it
 * is asserting.
 */
async function cycle(
  aliveMs: number,
  reconnects: Array<{ attempt: number; delay: number }>,
) {
  await vi.advanceTimersByTimeAsync(1);
  const sock = ScriptedSocket.instances.at(-1)!;
  await vi.advanceTimersByTimeAsync(aliveMs);
  sock.serverClose();
  await vi.advanceTimersByTimeAsync(1);
  // Fire the reconnect the close just scheduled.
  const delay = reconnects.at(-1)?.delay ?? 1000;
  await vi.advanceTimersByTimeAsync(delay + 5);
}

describe('a socket that opens and dies does not count as a connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ScriptedSocket.instances = [];
    (globalThis as any).WebSocket = ScriptedSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('the delay grows across repeated instant failures', async () => {
    const { client, reconnects } = build();
    void client.connect();

    for (let i = 0; i < 4; i++) await cycle(0, reconnects);

    expect(reconnects.length).toBeGreaterThanOrEqual(4);
    expect(
      reconnects.slice(0, 4).map((r) => r.attempt),
      'the attempt counter survives a socket that opened and died',
    ).toEqual([1, 2, 3, 4]);
    // Full jitter draws from [base, exponential], so the CEILING is what
    // grows; assert the bound rather than an exact figure.
    expect(reconnects[0]!.delay).toBe(1000);
    expect(reconnects[3]!.delay).toBeGreaterThan(1000);
    expect(reconnects[3]!.delay).toBeLessThanOrEqual(8000);
  });

  it('and a session that lasted starts the next backoff over', async () => {
    const { client, reconnects } = build();
    void client.connect();

    await cycle(0, reconnects);
    await cycle(0, reconnects);
    expect(reconnects.at(-1)!.attempt, 'two instant failures').toBe(2);

    // A real session: long enough to be evidence the far side works.
    await cycle(10_000, reconnects);
    expect(reconnects.at(-1)!.attempt, 'the counter went back to the start').toBe(1);
    expect(reconnects.at(-1)!.delay).toBe(1000);
  });

  it('a connection still reports zero attempts while it is up', async () => {
    const { client, reconnects } = build();
    void client.connect();

    await cycle(0, reconnects);
    await vi.advanceTimersByTimeAsync(1);
    // Now connected again (the socket opens immediately in this fake).
    expect(client.getReconnectAttempts(), 'the documented contract: 0 = not reconnecting').toBe(0);
  });
});
