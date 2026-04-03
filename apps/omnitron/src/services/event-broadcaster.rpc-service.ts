/**
 * EventBroadcaster RPC Service — WebSocket subscription endpoint
 *
 * Clients call `subscribe(channels)` to register for real-time events.
 * Events are pushed via the WebSocket connection as they occur.
 *
 * This service is exposed on the daemon's WebSocket transport.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';
import type { EventBroadcasterService } from './event-broadcaster.service.js';
import { VIEWER_ROLES } from '../shared/roles.js';

@Service({ name: 'OmnitronEvents' })
export class EventBroadcasterRpcService {
  constructor(private readonly broadcaster: EventBroadcasterService) {}

  /**
   * Subscribe to event channels. Returns recent events as initial payload.
   * The actual real-time push happens via WebSocket transport push.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async subscribe(data: {
    channels: string[];
  }): Promise<{ subscriberId: string; channels: string[] }> {
    // The actual callback is wired at the transport level — this RPC just registers intent.
    // The WebSocket transport layer handles pushing events to the connection.
    const subscriberId = this.broadcaster.subscribe(data.channels, () => {
      // Push callback is wired by WebSocket transport handler
    });

    return { subscriberId, channels: data.channels };
  }

  /** Unsubscribe from events. */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async unsubscribe(data: { subscriberId: string }): Promise<{ success: boolean }> {
    this.broadcaster.unsubscribe(data.subscriberId);
    return { success: true };
  }

  /** Get current subscriber count (admin/debugging). */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async getStats(): Promise<{ subscriberCount: number }> {
    return { subscriberCount: this.broadcaster.getSubscriberCount() };
  }

  /**
   * Push an event manually (for testing/admin purposes).
   * In production, events are emitted by services via the broadcaster.
   */
  @Public({ auth: { roles: ['admin'] } })
  async pushEvent(data: { channel: string; payload: unknown }): Promise<{ success: boolean }> {
    this.broadcaster.broadcast(data.channel as any, data.payload);
    return { success: true };
  }
}
