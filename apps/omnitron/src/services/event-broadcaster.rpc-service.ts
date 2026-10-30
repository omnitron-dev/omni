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
import type { AuthContext } from '@omnitron-dev/titan/netron/auth';
import type { EventBroadcasterService } from './event-broadcaster.service.js';
import { VIEWER_ROLES } from '../shared/roles.js';
import { ALL_EVENT_CHANNELS, DAEMON_EVENT_TASK, type DaemonEvent } from '../shared/events.js';
import { getRequestContext } from './auth-context.js';

/** What this service needs of Netron: the connected peers, and its own peer's events. */
export interface EventPeers {
  peers: Map<string, {
    id: string; runTask(name: string, ...args: unknown[]): Promise<unknown>;
    getAuthContext(): AuthContext | undefined; close(): Promise<unknown>;
  }>;
  peer: { subscribe(event: string, handler: (...args: any[]) => void): unknown };
}

const KNOWN = new Set<string>(ALL_EVENT_CHANNELS);
const GROUPS = new Set<string>(ALL_EVENT_CHANNELS.map((channel) => channel.slice(0, channel.indexOf('.'))));
const MAX_QUEUED_EVENTS = 256;
const MAX_QUEUED_BYTES = 1024 * 1024;
const MAX_EVENT_BYTES = 256 * 1024;

interface Subscription {
  id: string;
  queue: Array<{ event: DaemonEvent; bytes: number }>;
  queuedBytes: number;
  sending: boolean;
}

/** The channels asked for, each one the daemon emits — or the refusal that names the rest. */
export function readChannels(input: unknown): string[] {
  const channels = Array.isArray(input) ? input : null;
  if (!channels || channels.length === 0 || channels.length > 128 || !channels.every((c) => typeof c === 'string' && c.length <= 128)) {
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
  private readonly byPeer = new Map<string, Subscription>();

  constructor(
    private readonly broadcaster: EventBroadcasterService,
    private readonly netron: EventPeers,
    private readonly validatePrincipal: (context: AuthContext) => Promise<void>,
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
    const subscription: Subscription = { id: '', queue: [], queuedBytes: 0, sending: false };
    const subscriberId = this.broadcaster.subscribe(channels, event => {
      if (this.byPeer.get(peer.id) !== subscription) return;
      let bytes: number;
      let serialized: string;
      try { serialized = JSON.stringify(event); bytes = Buffer.byteLength(serialized); }
      catch { this.refuse(peer.id, subscription); return; }
      if (bytes > MAX_EVENT_BYTES || subscription.queue.length >= MAX_QUEUED_EVENTS || subscription.queuedBytes + bytes > MAX_QUEUED_BYTES) {
        this.refuse(peer.id, subscription); return;
      }
      subscription.queue.push({ event: JSON.parse(serialized) as DaemonEvent, bytes });
      subscription.queuedBytes += bytes;
      void this.deliver(peer.id, subscription);
    });
    subscription.id = subscriberId;
    this.byPeer.set(peer.id, subscription);
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
    const subscription = this.byPeer.get(peerId);
    if (!subscription) return;
    this.broadcaster.unsubscribe(subscription.id);
    subscription.queue.length = 0;
    subscription.queuedBytes = 0;
    this.byPeer.delete(peerId);
  }

  private refuse(peerId: string, subscription: Subscription): void {
    if (this.byPeer.get(peerId) !== subscription) return;
    this.release(peerId);
    // A closed stream is visible to Console, which resumes polling. Never
    // silently leave a tab claiming live delivery after revocation or loss.
    void this.netron.peers.get(peerId)?.close().catch(() => undefined);
  }

  private async deliver(peerId: string, subscription: Subscription): Promise<void> {
    if (subscription.sending) return;
    subscription.sending = true;
    const current = () => this.byPeer.get(peerId) === subscription;
    try {
      while (current() && subscription.queue.length) {
        const peer = this.netron.peers.get(peerId);
        const context = peer?.getAuthContext();
        if (!peer || !context) throw Errors.unauthorized('Event subscription authority expired');
        const packet = subscription.queue.shift()!;
        subscription.queuedBytes -= packet.bytes;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
          await Promise.race([
            (async () => {
              await this.validatePrincipal(context);
              // Replaced/revoked peers and late DB replies cannot emit another event.
              if (timedOut || !current()) return;
              if (peer.getAuthContext() !== context) throw Errors.unauthorized('Event subscription authority changed');
              await peer.runTask('emit', DAEMON_EVENT_TASK, packet.event);
            })(),
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => { timedOut = true; reject(new Error('Event delivery timed out')); }, 5000);
              timeout.unref();
            }),
          ]);
        } finally { if (timeout) clearTimeout(timeout); }
      }
    } catch { this.refuse(peerId, subscription); }
    finally { subscription.sending = false; }
  }
}
