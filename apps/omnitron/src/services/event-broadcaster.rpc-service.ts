/**
 * OmnitronEvents — daemon events pushed to the console, over the connection
 * that asked for them.
 *
 * `subscribe` registered an EMPTY callback: not one event ever left the
 * daemon, and every subscription stayed for good. The console, for its part,
 * opened a raw WebSocket to the Netron transport and waited for JSON nobody
 * sent — and because the socket opened, it called itself live and slowed its
 * polling from 5 s to 15 s. What the operator had was a console three times
 * slower to notice anything, saying it was watching.
 *
 * Now the caller is an authenticated viewer on a WebSocket connection (the
 * console authenticates over the open connection — the `authenticate` core
 * task — so no token rides in a URL, where a proxy's log would keep it). The
 * channels are the typed ones (`ALL_EVENT_CHANNELS`, or `<group>.*`, or `*`);
 * an unknown one is refused by name. Each event goes to THAT peer, by running
 * `emit` on it — nothing is emitted on the Netron emitter, so a peer that
 * subscribes through the core task receives nothing. One subscription per
 * peer: a second replaces the first. A disconnect removes it.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import { NETRON_EVENT_PEER_DISCONNECT } from '@omnitron-dev/titan/netron';
import type { EventBroadcasterService } from './event-broadcaster.service.js';
import { VIEWER_ROLES } from '../shared/roles.js';
import { ALL_EVENT_CHANNELS, DAEMON_EVENT_TASK } from '../shared/events.js';
import { getRequestContext } from './auth-context.js';

/** What this service needs of Netron: the connected peers, and its own peer's events. */
export interface EventPeers {
  peers: Map<string, { id: string; runTask(name: string, ...args: unknown[]): Promise<unknown> }>;
  peer: { subscribe(event: string, handler: (...args: any[]) => void): unknown };
}

const KNOWN = new Set<string>(ALL_EVENT_CHANNELS);
const GROUPS = new Set<string>(ALL_EVENT_CHANNELS.map((channel) => channel.slice(0, channel.indexOf('.'))));

/** The channels asked for, each one the daemon emits — or the refusal that names the rest. */
export function readChannels(input: unknown): string[] {
  const channels = Array.isArray(input) ? input : null;
  if (!channels || channels.length === 0 || !channels.every((c) => typeof c === 'string')) {
    throw Errors.badRequest('OmnitronEvents.subscribe: channels must be a non-empty list of channel names');
  }
  const unknown = (channels as string[]).filter(
    (c) => c !== '*' && !KNOWN.has(c) && !(c.endsWith('.*') && GROUPS.has(c.slice(0, -2))),
  );
  if (unknown.length > 0) {
    throw Errors.badRequest(`OmnitronEvents.subscribe: no such channel: ${unknown.join(', ')}`);
  }
  return [...new Set(channels as string[])];
}

@Service({ name: 'OmnitronEvents' })
export class EventBroadcasterRpcService {
  /** peer id → its one subscription */
  private readonly byPeer = new Map<string, string>();

  constructor(
    private readonly broadcaster: EventBroadcasterService,
    private readonly netron: EventPeers,
  ) {
    netron.peer.subscribe(NETRON_EVENT_PEER_DISCONNECT, (event: { peerId?: string } | undefined) => {
      if (event?.peerId) this.release(event.peerId);
    });
  }

  /** Push the given channels' events to the calling connection, from now on. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async subscribe(data: { channels: string[] }): Promise<{ subscriberId: string; channels: string[] }> {
    const channels = readChannels(data?.channels);
    const peerId = getRequestContext()?.peerId;
    const peer = peerId ? this.netron.peers.get(peerId) : undefined;
    if (!peer) {
      throw Errors.badRequest(
        'OmnitronEvents.subscribe: events are pushed over a WebSocket connection, and this call did not arrive on one',
      );
    }

    this.release(peer.id);
    const subscriberId = this.broadcaster.subscribe(channels, (event) => {
      // A connection that cannot take an event is gone or going: let it go
      // rather than try it again on every event after.
      peer.runTask('emit', DAEMON_EVENT_TASK, event).catch(() => this.release(peer.id));
    });
    this.byPeer.set(peer.id, subscriberId);
    return { subscriberId, channels };
  }

  /** Stop pushing to the calling connection. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async unsubscribe(): Promise<{ success: boolean }> {
    const peerId = getRequestContext()?.peerId;
    if (peerId) this.release(peerId);
    return { success: true };
  }

  /** Get current subscriber count (admin/debugging). */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStats(): Promise<{ subscriberCount: number }> {
    return { subscriberCount: this.broadcaster.getSubscriberCount() };
  }

  private release(peerId: string): void {
    const subscriberId = this.byPeer.get(peerId);
    if (subscriberId === undefined) return;
    this.broadcaster.unsubscribe(subscriberId);
    this.byPeer.delete(peerId);
  }
}
