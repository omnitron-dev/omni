/**
 * EventBroadcasterService — Pushes daemon events to WebSocket clients
 *
 * Subscribes to typed domain events emitted by orchestrator, infrastructure,
 * alert services, etc. and broadcasts them to connected WebSocket clients.
 *
 * Webapp subscribes to specific channels (e.g., 'app.*', 'infra.*') and
 * receives real-time updates without polling.
 */

import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { DaemonEvent, EventChannel } from '../shared/events.js';

/** Subscriber callback — receives typed events */
type SubscriberCallback = (event: DaemonEvent) => void;

interface Subscriber {
  id: string;
  channels: Set<string>;
  callback: SubscriberCallback;
}

export class EventBroadcasterService {
  private readonly subscribers = new Map<string, Subscriber>();
  private subscriberCounter = 0;

  constructor(private readonly logger: ILogger) {}

  /**
   * Subscribe to event channels. Returns a subscriber ID for unsubscribing.
   *
   * Channels support wildcard matching:
   *   - 'app.*' matches all app events
   *   - 'infra.ready' matches only infra.ready
   *   - '*' matches everything
   */
  subscribe(channels: string[], callback: SubscriberCallback): string {
    const id = `sub_${++this.subscriberCounter}`;
    this.subscribers.set(id, {
      id,
      channels: new Set(channels),
      callback,
    });
    this.logger.debug({ subscriberId: id, channels }, 'Client subscribed to events');
    return id;
  }

  /** Unsubscribe by subscriber ID. */
  unsubscribe(subscriberId: string): void {
    this.subscribers.delete(subscriberId);
  }

  /**
   * Broadcast an event to all matching subscribers.
   * Called by orchestrator, infrastructure, alert services, etc.
   */
  broadcast(channel: EventChannel, data: unknown): void {
    const event: DaemonEvent = {
      channel,
      timestamp: Date.now(),
      data,
    };

    for (const subscriber of this.subscribers.values()) {
      if (this.matchesChannel(channel, subscriber.channels)) {
        try {
          subscriber.callback(event);
        } catch {
          // Subscriber error should not crash the broadcaster
        }
      }
    }
  }

  /** Get the number of active subscribers. */
  getSubscriberCount(): number {
    return this.subscribers.size;
  }

  /** Remove all subscribers. */
  clear(): void {
    this.subscribers.clear();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private matchesChannel(eventChannel: string, subscribedChannels: Set<string>): boolean {
    if (subscribedChannels.has('*')) return true;
    if (subscribedChannels.has(eventChannel)) return true;

    // Check wildcard patterns: 'app.*' matches 'app.started'
    for (const pattern of subscribedChannels) {
      if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (eventChannel.startsWith(prefix + '.')) return true;
      }
    }

    return false;
  }
}
