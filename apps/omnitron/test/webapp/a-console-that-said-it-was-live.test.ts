/**
 * A console that said it was live.
 *
 * The console opened a raw WebSocket to the daemon's Netron transport and
 * called itself connected the moment the socket opened — while nothing it
 * could read ever arrived. The apps, dashboard and nodes pages read that flag
 * and slowed their polling from 5 s to 15 s: a console three times slower to
 * notice anything, saying it was watching.
 *
 * `connected` now means subscribed: the socket opened, the session was
 * accepted over it (the `authenticate` core task — never a token in the URL,
 * which the proxy logs), and `OmnitronEvents.subscribe` answered. Events are
 * the daemon's `emit` of `DAEMON_EVENT_TASK`; a reconnect is a new peer and
 * is authenticated and subscribed again.
 */

import { describe, it, expect, vi } from 'vitest';

import { DaemonWsClient, CONSOLE_CHANNELS, type EventSocket } from '../../webapp/src/netron/ws-client.js';
import { DAEMON_EVENT_TASK } from '../../src/shared/events.js';

vi.mock('../../webapp/src/netron/client', () => ({ getStorageToken: () => null }));

/** A socket that answers as told, and records what it was asked. */
function fakeSocket(answers: { auth?: { success?: boolean } | Error; subscribe?: unknown | Error } = {}) {
  const tasks = new Map<string, (...args: any[]) => unknown>();
  const events = new Map<string, Array<(...args: any[]) => void>>();
  const asked: Array<[string, ...unknown[]]> = [];
  const socket: EventSocket & { fire(event: string, ...args: unknown[]): void; task(name: string, ...args: unknown[]): unknown } = {
    connect: async () => {},
    disconnect: async () => {},
    runTask: async (name: string, ...args: unknown[]) => {
      asked.push([name, ...args]);
      if (answers.auth instanceof Error) throw answers.auth;
      return (answers.auth ?? { success: true }) as never;
    },
    invoke: async (service: string, method: string, args: unknown[]) => {
      asked.push([`${service}.${method}`, ...args]);
      if (answers.subscribe instanceof Error) throw answers.subscribe;
      return answers.subscribe ?? { subscriberId: 'sub_1' };
    },
    onTask: (name, handler) => tasks.set(name, handler),
    on: (event, handler) => events.set(event, [...(events.get(event) ?? []), handler]),
    fire: (event, ...args) => events.get(event)?.forEach((h) => h(...args)),
    task: (name, ...args) => tasks.get(name)?.(...args),
  };
  return { socket, asked };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function client(answers?: Parameters<typeof fakeSocket>[0], token: string | null = 'session-token') {
  const { socket, asked } = fakeSocket(answers);
  const urls: string[] = [];
  const ws = new DaemonWsClient({
    url: 'ws://console.example/ws',
    token: () => token,
    socket: (url) => {
      urls.push(url);
      return socket;
    },
  });
  const states: boolean[] = [];
  ws.onConnection((c) => states.push(c));
  return { ws, socket, asked, urls, states };
}

describe('the console’s event socket', () => {
  it('is connected only once the daemon accepted the session and the subscription', async () => {
    const { ws, asked, urls, states } = client();
    ws.connect();
    await flush();

    expect(asked).toEqual([
      ['authenticate', { token: 'session-token' }],
      ['OmnitronEvents.subscribe', { channels: CONSOLE_CHANNELS }],
    ]);
    expect(urls).toEqual(['ws://console.example/ws']);
    expect(ws.connected).toBe(true);
    expect(states).toEqual([true]);
  });

  it('is not live when the session is refused, when subscribing fails, or with no session at all', async () => {
    for (const [answers, token] of [
      [{ auth: { success: false } }, 'session-token'],
      [{ subscribe: new Error('no such channel') }, 'session-token'],
      [{}, null],
    ] as const) {
      const { ws, asked, states } = client(answers, token);
      ws.connect();
      await flush();
      expect(ws.connected, JSON.stringify(answers)).toBe(false);
      expect(states).not.toContain(true);
      if (token === null) expect(asked).toEqual([]);
    }
  });

  it('hears the daemon’s events — only under their own task name — by channel and group', async () => {
    const { ws, socket } = client();
    const heard: string[] = [];
    ws.on('app.*', (e) => heard.push(`group:${e.channel}`));
    ws.on('infra.ready', (e) => heard.push(`exact:${e.channel}`));
    ws.connect();
    await flush();

    socket.task('emit', DAEMON_EVENT_TASK, { channel: 'app.crashed', timestamp: 1, data: {} });
    socket.task('emit', DAEMON_EVENT_TASK, { channel: 'infra.ready', timestamp: 2, data: {} });
    socket.task('emit', 'something:else', { channel: 'app.started', timestamp: 3, data: {} });

    expect(heard).toEqual(['group:app.crashed', 'exact:infra.ready']);
  });

  it('says it is down on a disconnect, and subscribes again after a reconnect', async () => {
    const { ws, socket, asked, states } = client();
    ws.connect();
    await flush();

    socket.fire('disconnect');
    expect(ws.connected).toBe(false);
    socket.fire('reconnect', { attempt: 1 });
    await flush();

    expect(ws.connected).toBe(true);
    expect(asked.filter(([name]) => name === 'authenticate')).toHaveLength(2);
    expect(states).toEqual([true, false, true]);
  });
});
