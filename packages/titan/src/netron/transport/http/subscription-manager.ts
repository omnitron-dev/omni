/**
 * Subscription Manager for WebSocket-based real-time updates
 * Provides real-time event subscriptions over WebSocket connection
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { HttpSubscriptionResponse } from './types.js';

/**
 * Subscription entry
 */
interface Subscription {
  id: string;
  service: string;
  event: string;
  handler: (data: any) => void;
  options?: SubscriptionOptions;
  createdAt: number;
  lastEvent?: number;
  eventCount: number;
}

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Filter for events */
  filter?: Record<string, any>;
  /** Whether to replay missed events */
  replayMissed?: boolean;
  /** Maximum number of events to buffer */
  bufferSize?: number;
  /** Reconnection strategy */
  reconnect?: boolean;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Reconnection delay in ms */
  reconnectDelay?: number;
}

/**
 * WebSocket message types
 */
type WSMessageType = 'subscribe' | 'unsubscribe' | 'event' | 'error' | 'ping' | 'pong' | 'ack';

/**
 * WebSocket message format
 */
interface WSMessage {
  type: WSMessageType;
  id?: string;
  subscriptionId?: string;
  service?: string;
  event?: string;
  data?: any;
  error?: any;
  timestamp?: number;
  options?: any;
}

/**
 * Subscription statistics
 */
export interface SubscriptionStats {
  activeSubscriptions: number;
  totalEventsReceived: number;
  totalEventsProcessed: number;
  connectionState: 'disconnected' | 'connecting' | 'connected';
  connectionUptime: number;
  reconnectAttempts: number;
  lastError?: string;
  averageEventRate: number;
}

/**
 * Subscription Manager for real-time event handling
 * Manages WebSocket connections for event subscriptions
 */
export class SubscriptionManager extends EventEmitter {
  private ws?: WebSocket;
  private subscriptions = new Map<string, Subscription>();
  private eventBuffer = new Map<string, any[]>();
  private connectionState: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private pingInterval?: NodeJS.Timeout;
  private connectionStartTime?: number;

  // Configuration
  private readonly wsEndpoint: string;
  private readonly reconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;
  private readonly pingIntervalMs: number;
  private readonly requestTimeout: number;

  // Statistics
  private stats = {
    totalEventsReceived: 0,
    totalEventsProcessed: 0,
    eventRates: [] as number[],
    lastEventTime: 0
  };

  // Pending operations
  private pendingAcks = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();

  constructor(
    private baseUrl: string,
    private options: {
      wsEndpoint?: string;
      reconnect?: boolean;
      maxReconnectAttempts?: number;
      reconnectDelay?: number;
      pingInterval?: number;
      requestTimeout?: number;
      headers?: Record<string, string>;
    } = {}
  ) {
    super();

    this.wsEndpoint = options.wsEndpoint || '/netron/ws';
    this.reconnect = options.reconnect !== false;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.pingIntervalMs = options.pingInterval || 30000;
    this.requestTimeout = options.requestTimeout || 5000;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    if (this.connectionState !== 'disconnected') {
      return;
    }

    this.connectionState = 'connecting';
    this.emit('connecting');

    try {
      // Convert HTTP URL to WebSocket URL
      const wsUrl = this.baseUrl
        .replace(/^http/, 'ws')
        .replace(/\/$/, '') + this.wsEndpoint;

      this.ws = new WebSocket(wsUrl);

      // Setup event handlers
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      this.ws.onclose = this.handleClose.bind(this);

      // Wait for connection
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, this.requestTimeout);

        const openHandler = () => {
          clearTimeout(timer);
          resolve();
        };

        const errorHandler = (error: any) => {
          clearTimeout(timer);
          reject(error);
        };

        this.once('connected', openHandler);
        this.once('error', errorHandler);
      });

    } catch (error) {
      this.connectionState = 'disconnected';
      throw error;
    }
  }

  /**
   * Subscribe to an event
   */
  async subscribeTo(
    service: string,
    event: string,
    handler: (data: any) => void,
    options: SubscriptionOptions = {}
  ): Promise<() => void> {
    // Ensure connection
    if (this.connectionState === 'disconnected') {
      await this.connect();
    }

    const subscriptionId = `${service}.${event}.${Date.now()}.${Math.random()}`;

    // Store subscription
    const subscription: Subscription = {
      id: subscriptionId,
      service,
      event,
      handler,
      options,
      createdAt: Date.now(),
      eventCount: 0
    };

    this.subscriptions.set(subscriptionId, subscription);

    // Initialize event buffer if needed
    if (options.bufferSize && options.bufferSize > 0) {
      this.eventBuffer.set(subscriptionId, []);
    }

    // Send subscription request
    await this.sendMessage({
      type: 'subscribe',
      id: subscriptionId,
      service,
      event,
      options: {
        filter: options.filter,
        replayMissed: options.replayMissed
      }
    });

    this.emit('subscription-created', {
      subscriptionId,
      service,
      event
    });

    // Return unsubscribe function
    return () => this.unsubscribe(subscriptionId);
  }

  /**
   * Unsubscribe from an event
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    // Send unsubscribe request if connected
    if (this.connectionState === 'connected') {
      try {
        await this.sendMessage({
          type: 'unsubscribe',
          id: subscriptionId
        });
      } catch (error) {
        // Log but don't throw - we're cleaning up anyway
        console.warn('Failed to send unsubscribe message:', error);
      }
    }

    // Clean up local state
    this.subscriptions.delete(subscriptionId);
    this.eventBuffer.delete(subscriptionId);

    this.emit('subscription-removed', {
      subscriptionId,
      service: subscription.service,
      event: subscription.event
    });
  }

  /**
   * Unsubscribe from all events
   */
  async unsubscribeAll(): Promise<void> {
    const subscriptionIds = Array.from(this.subscriptions.keys());

    for (const id of subscriptionIds) {
      await this.unsubscribe(id);
    }
  }

  /**
   * Send a message to the WebSocket server
   */
  private async sendMessage(message: WSMessage): Promise<any> {
    if (!this.ws || this.connectionState !== 'connected') {
      throw new Error('WebSocket not connected');
    }

    const messageId = message.id || `msg-${Date.now()}-${Math.random()}`;
    message.id = messageId;
    message.timestamp = Date.now();

    // For messages that expect acknowledgment
    if (message.type === 'subscribe' || message.type === 'unsubscribe') {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingAcks.delete(messageId);
          reject(new Error(`Request timeout: ${message.type}`));
        }, this.requestTimeout);

        this.pendingAcks.set(messageId, {
          resolve,
          reject,
          timer
        });

        this.ws!.send(JSON.stringify(message));
      });
    }

    // Fire and forget
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Handle WebSocket open event
   */
  private handleOpen(): void {
    this.connectionState = 'connected';
    this.connectionStartTime = Date.now();
    this.reconnectAttempts = 0;

    this.emit('connected');

    // Re-establish subscriptions after reconnection
    if (this.subscriptions.size > 0) {
      this.reestablishSubscriptions();
    }

    // Start ping interval
    this.startPingInterval();
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(event: MessageEvent): void {
    try {
      const message: WSMessage = JSON.parse(event.data);

      switch (message.type) {
        case 'event':
          this.handleEventMessage(message);
          break;

        case 'ack':
          this.handleAckMessage(message);
          break;

        case 'error':
          this.handleErrorMessage(message);
          break;

        case 'pong':
          // Heartbeat response
          this.emit('pong');
          break;

        default:
          console.warn('Unknown WebSocket message type:', message.type);
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Handle event message
   */
  private handleEventMessage(message: WSMessage): void {
    const subscription = this.subscriptions.get(message.subscriptionId!);
    if (!subscription) {
      return;
    }

    this.stats.totalEventsReceived++;
    subscription.lastEvent = Date.now();
    subscription.eventCount++;

    // Buffer event if configured
    if (subscription.options?.bufferSize) {
      const buffer = this.eventBuffer.get(subscription.id) || [];
      buffer.push(message.data);

      // Trim buffer to size
      if (buffer.length > subscription.options.bufferSize) {
        buffer.shift();
      }

      this.eventBuffer.set(subscription.id, buffer);
    }

    // Call handler
    try {
      subscription.handler(message.data);
      this.stats.totalEventsProcessed++;

      this.emit('event-processed', {
        subscriptionId: subscription.id,
        service: subscription.service,
        event: subscription.event
      });
    } catch (error) {
      this.emit('event-error', {
        subscriptionId: subscription.id,
        error
      });
    }

    // Update event rate
    this.updateEventRate();
  }

  /**
   * Handle acknowledgment message
   */
  private handleAckMessage(message: WSMessage): void {
    const pending = this.pendingAcks.get(message.id!);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(message.data);
      this.pendingAcks.delete(message.id!);
    }
  }

  /**
   * Handle error message
   */
  private handleErrorMessage(message: WSMessage): void {
    const pending = this.pendingAcks.get(message.id!);
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message.error?.message || 'Unknown error'));
      this.pendingAcks.delete(message.id!);
    }

    this.emit('error', message.error);
  }

  /**
   * Handle WebSocket error
   */
  private handleError(event: Event): void {
    console.error('WebSocket error:', event);
    this.emit('error', event);
  }

  /**
   * Handle WebSocket close
   */
  private handleClose(event: CloseEvent): void {
    this.connectionState = 'disconnected';
    this.ws = undefined;

    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    // Clear pending acknowledgments
    for (const [id, pending] of this.pendingAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error('WebSocket connection closed'));
    }
    this.pendingAcks.clear();

    this.emit('disconnected', {
      code: event.code,
      reason: event.reason
    });

    // Attempt reconnection if configured
    if (this.reconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;

    const delay = this.reconnectDelay * Math.pow(2, Math.min(this.reconnectAttempts - 1, 5));

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      delay
    });

    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(error => {
        console.error('Reconnection failed:', error);
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      });
    }, delay);
  }

  /**
   * Re-establish subscriptions after reconnection
   */
  private async reestablishSubscriptions(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());

    for (const subscription of subscriptions) {
      try {
        await this.sendMessage({
          type: 'subscribe',
          id: subscription.id,
          service: subscription.service,
          event: subscription.event,
          options: {
            filter: subscription.options?.filter,
            replayMissed: subscription.options?.replayMissed
          }
        });
      } catch (error) {
        console.error(`Failed to re-establish subscription ${subscription.id}:`, error);
      }
    }
  }

  /**
   * Start ping interval for keep-alive
   */
  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      if (this.connectionState === 'connected') {
        this.sendMessage({ type: 'ping' }).catch(error => {
          console.warn('Ping failed:', error);
        });
      }
    }, this.pingIntervalMs);
  }

  /**
   * Update event rate statistics
   */
  private updateEventRate(): void {
    const now = Date.now();
    if (this.stats.lastEventTime > 0) {
      const rate = 1000 / (now - this.stats.lastEventTime);
      this.stats.eventRates.push(rate);

      // Keep only last 100 rates
      if (this.stats.eventRates.length > 100) {
        this.stats.eventRates.shift();
      }
    }
    this.stats.lastEventTime = now;
  }

  /**
   * Get subscription statistics
   */
  getStatistics(): SubscriptionStats {
    const averageEventRate = this.stats.eventRates.length > 0
      ? this.stats.eventRates.reduce((a, b) => a + b, 0) / this.stats.eventRates.length
      : 0;

    return {
      activeSubscriptions: this.subscriptions.size,
      totalEventsReceived: this.stats.totalEventsReceived,
      totalEventsProcessed: this.stats.totalEventsProcessed,
      connectionState: this.connectionState,
      connectionUptime: this.connectionStartTime
        ? Date.now() - this.connectionStartTime
        : 0,
      reconnectAttempts: this.reconnectAttempts,
      averageEventRate
    };
  }

  /**
   * Get event buffer for a subscription
   */
  getEventBuffer(subscriptionId: string): any[] {
    return this.eventBuffer.get(subscriptionId) || [];
  }

  /**
   * Disconnect and clean up
   */
  async disconnect(): Promise<void> {
    // Cancel reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // Unsubscribe all
    await this.unsubscribeAll();

    // Close WebSocket
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.connectionState = 'disconnected';
  }

  /**
   * Destroy the subscription manager
   */
  destroy(): void {
    this.disconnect();
    this.removeAllListeners();
  }
}