/**
 * An event that reached nobody.
 *
 * `OmnitronEvents.subscribe` registered an empty callback: the daemon emitted
 * app, infra, node and stack events at fifteen points and not one left it,
 * and every subscription stayed for good. The console, for its part, called
 * itself live because a raw socket opened, and slowed its polling to match.
 *
 * On a real Netron WebSocket server, with the daemon's own invocation
 * wrapper: an event goes to the peer that subscribed — authenticated, over
 * the open connection — and to nobody else; a peer that never authenticated
 * is refused, and one that subscribes through Netron's own `subscribe` core
 * task receives nothing, because nothing is emitted on the Netron emitter.
 */

import 'reflect-metadata';

import net from 'node:net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Netron } from '@omnitron-dev/titan/netron';
import { AuthenticationManager } from '@omnitron-dev/titan/netron/auth';
import { WebSocketTransport } from '@omnitron-dev/titan/netron/transport/websocket';

import { EventBroadcasterService } from '../../src/services/event-broadcaster.service.js';
import { EventBroadcasterRpcService, readChannels } from '../../src/services/event-broadcaster.rpc-service.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import { APP_EVENTS, DAEMON_EVENT_TASK, INFRA_EVENTS } from '../../src/shared/events.js';

const logger: Record<string, unknown> = {};
for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) logger[level] = () => {};
logger['child'] = () => logger;
logger['isLevelEnabled'] = () => false;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
/** A viewer's session, as `validateToken` reads it. */
const VIEWER = Buffer.from(JSON.stringify({ userId: 'u-viewer', roles: ['viewer'], permissions: [] })).toString('base64');

describe('a daemon event', () => {
  let server: Netron;
  let clients: Netron[];
  let broadcaster: EventBroadcasterService;
  let port: number;

  beforeEach(async () => {
    port = await freePort();
    server = new Netron(logger as never, { id: 'daemon' });
    (server as any).authenticationManager = new AuthenticationManager(logger as never, {
      authenticate: async () => {
        throw new Error('tokens only');
      },
      validateToken: async (token: string) => JSON.parse(Buffer.from(token, 'base64').toString()),
    });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', {
      name: 'ws',
      options: { host: 'localhost', port, invocationWrapper: createAuthContextWrapper() },
    });
    await server.start();
    broadcaster = new EventBroadcasterService(logger as never);
    await server.peer.exposeService(new EventBroadcasterRpcService(broadcaster, server as never));
    clients = [];
  });

  afterEach(async () => {
    await settle(100);
    for (const c of clients) await c.stop().catch(() => undefined);
    await server?.stop();
    await settle(200);
  });

  /**
   * A console tab: a peer, and what reaches it as `emit(DAEMON_EVENT_TASK)`.
   * `local: false` leaves the name free for Netron's own `subscribe`, which
   * treats a name already held as already subscribed and never asks.
   */
  async function tab({ local = true } = {}): Promise<{ peer: any; received: unknown[] }> {
    const client = new Netron(logger as never, { id: `tab-${clients.length}` });
    client.registerTransport('ws', () => new WebSocketTransport());
    // Registers Netron's core tasks — `emit` among them — as a started peer has.
    await client.start();
    clients.push(client);
    const peer: any = await client.connect(`ws://localhost:${port}`);
    const received: unknown[] = [];
    // What the browser's `onTask('emit')` does: a local handler, no remote subscription.
    if (local) peer.eventSubscribers.set(DAEMON_EVENT_TASK, [(event: unknown) => received.push(event)]);
    return { peer, received };
  }
  const events = async (peer: any) => {
    const def = await peer.queryInterface('OmnitronEvents');
    return def;
  };

  it('is refused to a peer that never authenticated', async () => {
    const { peer } = await tab();
    const service = await events(peer).catch((err: unknown) => err);
    const refusal =
      service instanceof Error ? service : await service.subscribe({ channels: ['app.*'] }).catch((err: unknown) => err);
    expect(String((refusal as Error)?.message ?? refusal)).toMatch(/auth|denied|forbidden|required|unauthor/i);
    expect(broadcaster.getSubscriberCount()).toBe(0);
  });

  it('reaches the peer that subscribed, and only it', async () => {
    const a = await tab();
    const b = await tab();
    for (const t of [a, b]) await t.peer.runTask('authenticate', { token: VIEWER });
    await (await events(a.peer)).subscribe({ channels: ['app.*'] });

    broadcaster.broadcast(APP_EVENTS.CRASHED, { name: 'main' });
    broadcaster.broadcast(INFRA_EVENTS.READY, { service: 'postgres' });
    await settle();

    expect(a.received).toMatchObject([{ channel: 'app.crashed', data: { name: 'main' } }]);
    expect(b.received).toEqual([]);
  });

  it('reaches nobody through Netron’s own subscribe — nothing is emitted on its emitter', async () => {
    const listener = await tab({ local: false });
    const heard: unknown[] = [];
    await listener.peer.subscribe(DAEMON_EVENT_TASK, (event: unknown) => heard.push(event));
    await settle();
    // The core task's path is live: the daemon holds the forwarding handler.
    expect((server as any).peers.get('tab-0').remoteSubscriptions.has(DAEMON_EVENT_TASK)).toBe(true);
    const subscriber = await tab();
    await subscriber.peer.runTask('authenticate', { token: VIEWER });
    await (await events(subscriber.peer)).subscribe({ channels: ['*'] });

    broadcaster.broadcast(APP_EVENTS.STARTED, { name: 'main' });
    await settle();

    expect(subscriber.received).toHaveLength(1);
    expect(heard).toEqual([]);
  });

  it('keeps one subscription per peer — a second replaces the first — and lets go on disconnect', async () => {
    const a = await tab();
    await a.peer.runTask('authenticate', { token: VIEWER });
    const service = await events(a.peer);
    await service.subscribe({ channels: ['app.*'] });
    await service.subscribe({ channels: ['infra.*'] });
    expect(broadcaster.getSubscriberCount()).toBe(1);

    broadcaster.broadcast(APP_EVENTS.CRASHED, { name: 'main' });
    broadcaster.broadcast(INFRA_EVENTS.READY, { service: 'postgres' });
    await settle();
    expect(a.received).toMatchObject([{ channel: 'infra.ready' }]);

    await a.peer.disconnect();
    await settle(300);
    expect(broadcaster.getSubscriberCount()).toBe(0);
  });
});

describe('the channels asked for', () => {
  it('are the daemon’s own — an unknown one is refused by name', () => {
    expect(readChannels(['app.*', 'node.status_updated', '*'])).toEqual(['app.*', 'node.status_updated', '*']);
    expect(() => readChannels(['app.*', 'apps.*', 'disk.full'])).toThrow(/no such channel: apps\.\*, disk\.full/);
    expect(() => readChannels([])).toThrow(/non-empty list/);
  });
});
