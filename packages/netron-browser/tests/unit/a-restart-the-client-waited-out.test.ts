/**
 * A restart the client waited out.
 *
 * When this platform deploys, every backend goes down and comes back. The
 * sockets are closed by the server, the clients back off, and the backoff is
 * a full-jitter draw from `[1000, min(1000·2^(attempt−1), 30000)]`. A restart
 * that takes minutes — six apps came back in 3 min 20 s on this platform's
 * own stand — walks a client to the sixth attempt, where the draw reaches
 * thirty seconds.
 *
 * So the socket can stay shut for up to half a minute AFTER the server is
 * answering again. Not because the server is down: because the client is
 * asleep. To the person watching, the chat is dead long past the outage.
 *
 * The server has always known the difference between «I am going down for
 * good» and «I am restarting» — RFC 6455 gives it 1012, «Service Restart» —
 * and it was sending 1001, which a BROWSER also sends when the page
 * navigates away. The client, for its part, did not read `event.code` at all.
 *
 * That is why this file holds BOTH sides. A close code nobody reads is a
 * comment with a number in it; a client that shortened its retry without
 * being told would hammer every endpoint that ever dropped it. The promise
 * is the pair:
 *
 *   the server announces a restart  →  the client comes back in seconds
 *   the server says anything else   →  the client backs off as before
 *   the announcement turns out false →  the client backs off from then on
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { WebSocketClient } from '../../src/client/ws-client.js';

/** The close code the server sends when it is coming back. */
const SERVICE_RESTART = 1012;
/** What it used to send, and what a navigating browser sends. */
const GOING_AWAY = 1001;

class ScriptedSocket {
  static instances: ScriptedSocket[] = [];

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
    }, 0);
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
  /** The server hanging up with a code of its choosing. */
  serverClose(code: number, reason = '') {
    this.readyState = 3;
    this.fire('close', { code, reason, wasClean: true });
  }
  private fire(type: string, e: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}

interface Scheduled {
  attempt: number;
  delay: number;
  announced?: boolean;
}

function build() {
  const client = new WebSocketClient({
    url: 'ws://localhost:1/never',
    reconnect: true,
    reconnectInterval: 1000,
    maxReconnectAttempts: Infinity,
    timeout: 30_000,
  });
  const scheduled: Scheduled[] = [];
  client.on('reconnecting', (info: Scheduled) => scheduled.push({ ...info }));
  return { client, scheduled };
}

/**
 * Open the pending socket, keep it alive `aliveMs`, have the server hang up
 * with `code`, then run the retry it scheduled.
 *
 * `aliveMs` matters: a session shorter than `STABLE_CONNECTION_MS` (5 s)
 * leaves the attempt counter where it was, which is how the backoff is
 * driven up here without waiting real minutes.
 */
async function cycle(code: number, aliveMs: number, scheduled: Scheduled[]) {
  await vi.advanceTimersByTimeAsync(1);
  const sock = ScriptedSocket.instances.at(-1)!;
  await vi.advanceTimersByTimeAsync(aliveMs);
  sock.serverClose(code);
  await vi.advanceTimersByTimeAsync(1);
  await vi.advanceTimersByTimeAsync((scheduled.at(-1)?.delay ?? 1000) + 5);
}

describe('a server that says it is restarting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ScriptedSocket.instances = [];
    (globalThis as any).WebSocket = ScriptedSocket;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).WebSocket;
  });

  it('is answered within seconds, not tens of seconds', async () => {
    const { client, scheduled } = build();
    // `void`, not `await`: this fake socket opens but never sends the Netron
    // handshake frame, so `connect()` does not settle until its own timeout.
    // Awaiting it here hangs the test on the very thing it is not about.
    void client.connect().catch(() => {});

    // Four quick failures to drive the ordinary backoff up, then the
    // announcement. Without it the fifth draw reaches sixteen seconds.
    for (let i = 0; i < 4; i += 1) await cycle(1006, 10, scheduled);
    const beforeAnnouncement = scheduled.at(-1)!;
    await cycle(SERVICE_RESTART, 10, scheduled);
    const afterAnnouncement = scheduled.at(-1)!;

    expect(beforeAnnouncement.attempt).toBeGreaterThanOrEqual(4);
    expect(afterAnnouncement.delay, 'the client slept through the restart').toBeLessThanOrEqual(
      3_000,
    );
    expect(afterAnnouncement.announced).toBe(true);

    client.disconnect();
  });

  it('spreads the returning clients rather than bringing them back together', async () => {
    // Every client of a restarted server was disconnected in the same
    // millisecond. A fixed delay would return all of them in the same one,
    // onto an application that has just finished starting.
    const delays = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      const { client, scheduled } = build();
      // `void`, not `await`: this fake socket opens but never sends the Netron
    // handshake frame, so `connect()` does not settle until its own timeout.
    // Awaiting it here hangs the test on the very thing it is not about.
    void client.connect().catch(() => {});
      await cycle(SERVICE_RESTART, 10, scheduled);
      delays.add(scheduled.at(-1)!.delay);
      client.disconnect();
    }

    expect(Math.min(...delays), 'below the floor').toBeGreaterThanOrEqual(1_000);
    expect(Math.max(...delays), 'above the ceiling').toBeLessThanOrEqual(3_000);
    expect(delays.size, 'every client came back in the same millisecond').toBeGreaterThan(5);
  });

  describe('and a server that says anything else', () => {
    it.each([
      ['1001, which a navigating browser also sends', GOING_AWAY],
      ['1006, an abrupt drop', 1006],
      ['1000, a clean close', 1000],
    ])('%s keeps the ordinary backoff', async (_name, code) => {
      const { client, scheduled } = build();
      // `void`, not `await`: this fake socket opens but never sends the Netron
    // handshake frame, so `connect()` does not settle until its own timeout.
    // Awaiting it here hangs the test on the very thing it is not about.
    void client.connect().catch(() => {});

      for (let i = 0; i < 5; i += 1) await cycle(code, 10, scheduled);
      const last = scheduled.at(-1)!;

      expect(last.announced).toBe(false);
      // Attempt 5 draws from [1000, 16000]; the point is that the window is
      // WIDER than the restart one, which a fixed assertion on the value
      // could not say, because the draw is random.
      expect(last.attempt).toBeGreaterThanOrEqual(5);

      client.disconnect();
    });
  });

  describe('an announcement that turns out to be false', () => {
    /**
     * A server may say «restarting» and stay down. One short retry is the
     * price of finding out; the second failure must cost what any other
     * does, or a lying endpoint is hammered for as long as it lies.
     */
    it('shortens exactly one retry, then backs off again', async () => {
      const { client, scheduled } = build();
      // `void`, not `await`: this fake socket opens but never sends the Netron
    // handshake frame, so `connect()` does not settle until its own timeout.
    // Awaiting it here hangs the test on the very thing it is not about.
    void client.connect().catch(() => {});

      for (let i = 0; i < 4; i += 1) await cycle(1006, 10, scheduled);
      await cycle(SERVICE_RESTART, 10, scheduled);
      expect(scheduled.at(-1)!.announced).toBe(true);

      // Still down, and now saying nothing.
      await cycle(1006, 10, scheduled);

      expect(scheduled.at(-1)!.announced).toBe(false);
      expect(scheduled.at(-1)!.attempt).toBeGreaterThan(scheduled.at(-2)!.attempt);

      client.disconnect();
    });
  });
});
