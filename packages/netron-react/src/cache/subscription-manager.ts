/**
 * SubscriptionManager - Manages WebSocket event subscriptions
 */

import type { WebSocketClient } from '@omnitron-dev/netron-browser';
import type { Unsubscribe, EventHandler } from '../core/types.js';

/**
 * Subscription entry
 */
interface Subscription {
  event: string;
  handlers: Set<EventHandler>;
  serverSubscribed: boolean;
}

/**
 * SubscriptionManager
 *
 * Manages event subscriptions over WebSocket, handling
 * subscription lifecycle and message routing.
 */
export class SubscriptionManager {
  private wsClient: WebSocketClient;
  private subscriptions = new Map<string, Subscription>();
  private isConnected = false;
  private pendingSubscriptions = new Set<string>();

  constructor(wsClient: WebSocketClient) {
    this.wsClient = wsClient;
    this.setupClientHandlers();
  }

  /**
   * Setup WebSocket client event handlers
   */
  private setupClientHandlers(): void {
    this.wsClient.on('connect', () => {
      this.isConnected = true;
      this.resubscribeAll();
    });

    this.wsClient.on('disconnect', () => {
      this.isConnected = false;
      // Mark all as not server subscribed
      for (const sub of this.subscriptions.values()) {
        sub.serverSubscribed = false;
      }
    });

    this.wsClient.on('packet', (packet: any) => {
      this.handlePacket(packet);
    });
  }

  /**
   * Handle incoming packet
   */
  private handlePacket(packet: any): void {
    // Check if this is an event packet
    // Event packets typically have a specific type or structure
    if (packet.data && Array.isArray(packet.data) && packet.data[0] === 'event') {
      const [, eventName, ...args] = packet.data;
      this.dispatchEvent(eventName, args);
    }
  }

  /**
   * Dispatch event to handlers
   */
  private dispatchEvent(event: string, data: unknown): void {
    const subscription = this.subscriptions.get(event);
    if (!subscription) return;

    for (const handler of subscription.handlers) {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in subscription handler for "${event}":`, error);
      }
    }
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Subscribe to an event
   */
  subscribe<T = unknown>(event: string, handler: EventHandler<T>): Unsubscribe {
    let subscription = this.subscriptions.get(event);

    if (!subscription) {
      subscription = {
        event,
        handlers: new Set(),
        serverSubscribed: false,
      };
      this.subscriptions.set(event, subscription);
    }

    subscription.handlers.add(handler as EventHandler);

    // Subscribe on server if this is the first handler
    if (subscription.handlers.size === 1 && !subscription.serverSubscribed) {
      this.subscribeOnServer(event);
    }

    return () => {
      this.unsubscribe(event, handler as EventHandler);
    };
  }

  /**
   * Unsubscribe a handler from an event
   */
  private unsubscribe(event: string, handler: EventHandler): void {
    const subscription = this.subscriptions.get(event);
    if (!subscription) return;

    subscription.handlers.delete(handler);

    // Unsubscribe from server if no more handlers
    if (subscription.handlers.size === 0) {
      this.unsubscribeOnServer(event);
      this.subscriptions.delete(event);
    }
  }

  /**
   * Subscribe to event on server
   */
  private async subscribeOnServer(event: string): Promise<void> {
    if (!this.isConnected) {
      this.pendingSubscriptions.add(event);
      return;
    }

    try {
      // Use runTask for subscribe core task
      await this.wsClient.invoke('__netron__', 'subscribe', [event]);

      const subscription = this.subscriptions.get(event);
      if (subscription) {
        subscription.serverSubscribed = true;
      }
      this.pendingSubscriptions.delete(event);
    } catch (error) {
      console.error(`Failed to subscribe to "${event}":`, error);
    }
  }

  /**
   * Unsubscribe from event on server
   */
  private async unsubscribeOnServer(event: string): Promise<void> {
    if (!this.isConnected) {
      this.pendingSubscriptions.delete(event);
      return;
    }

    try {
      await this.wsClient.invoke('__netron__', 'unsubscribe', [event]);
    } catch (error) {
      console.error(`Failed to unsubscribe from "${event}":`, error);
    }
  }

  /**
   * Resubscribe all events after reconnection
   */
  private async resubscribeAll(): Promise<void> {
    // Subscribe pending events
    for (const event of this.pendingSubscriptions) {
      await this.subscribeOnServer(event);
    }

    // Re-subscribe existing events
    for (const [event, subscription] of this.subscriptions.entries()) {
      if (!subscription.serverSubscribed && subscription.handlers.size > 0) {
        await this.subscribeOnServer(event);
      }
    }
  }

  // ============================================================================
  // Buffer Support
  // ============================================================================

  /**
   * Create a buffered subscription
   */
  subscribeBuffered<T = unknown>(
    event: string,
    handler: EventHandler<T[]>,
    options: {
      size: number;
      timeout: number;
      strategy: 'latest' | 'all' | 'first';
    }
  ): Unsubscribe {
    const buffer: T[] = [];
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
      if (buffer.length === 0) return;

      let data: T[];
      switch (options.strategy) {
        case 'latest':
          data = [buffer[buffer.length - 1]!];
          break;
        case 'first':
          data = [buffer[0]!];
          break;
        case 'all':
        default:
          data = [...buffer];
      }

      buffer.length = 0;
      handler(data);
    };

    const scheduleFlush = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(flush, options.timeout);
    };

    const bufferedHandler: EventHandler<T> = (data) => {
      buffer.push(data);

      if (buffer.length >= options.size) {
        flush();
      } else {
        scheduleFlush();
      }
    };

    const unsubscribe = this.subscribe(event, bufferedHandler);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      flush(); // Flush remaining
      unsubscribe();
    };
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get list of active subscriptions
   */
  getActiveSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  /**
   * Get subscription handler count
   */
  getHandlerCount(event: string): number {
    return this.subscriptions.get(event)?.handlers.size ?? 0;
  }

  /**
   * Check if subscribed to event
   */
  isSubscribed(event: string): boolean {
    const subscription = this.subscriptions.get(event);
    return subscription !== undefined && subscription.handlers.size > 0;
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup(): void {
    for (const event of this.subscriptions.keys()) {
      this.unsubscribeOnServer(event);
    }
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSubscriptions: number;
    totalHandlers: number;
    pendingSubscriptions: number;
    serverSubscribed: number;
  } {
    let totalHandlers = 0;
    let serverSubscribed = 0;

    for (const sub of this.subscriptions.values()) {
      totalHandlers += sub.handlers.size;
      if (sub.serverSubscribed) serverSubscribed++;
    }

    return {
      totalSubscriptions: this.subscriptions.size,
      totalHandlers,
      pendingSubscriptions: this.pendingSubscriptions.size,
      serverSubscribed,
    };
  }
}
