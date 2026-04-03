/**
 * WebSocket Client — Real-time event push from daemon
 *
 * Connects to the daemon's WebSocket transport and receives domain events
 * (app lifecycle, infrastructure, alerts, metrics) in real-time.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff
 *   - Subscription channel filtering
 *   - Connection state tracking
 *   - Heartbeat keep-alive
 */

import type { DaemonEvent } from '../../../src/shared/events.js';

type EventCallback = (event: DaemonEvent) => void;
type ConnectionCallback = (connected: boolean) => void;

interface WsClientOptions {
  /** WebSocket URL (default: auto-detect from window.location) */
  url?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
}

export class DaemonWsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private intentionalClose = false;
  private readonly eventListeners = new Map<string, Set<EventCallback>>();
  private readonly connectionListeners = new Set<ConnectionCallback>();
  private _connected = false;

  private readonly url: string;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly heartbeatInterval: number;

  constructor(options: WsClientOptions = {}) {
    // Auto-detect WebSocket URL from current page location
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const defaultPort = (parseInt(window.location.port || '9802', 10));
    this.url = options.url ?? `${wsProtocol}//${window.location.hostname}:${defaultPort}/ws`;

    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.reconnectDelay = options.reconnectDelay ?? 1000;
    this.maxReconnectDelay = options.maxReconnectDelay ?? 30_000;
    this.heartbeatInterval = options.heartbeatInterval ?? 30_000;
  }

  /** Current connection state. */
  get connected(): boolean {
    return this._connected;
  }

  /** Connect to the daemon WebSocket. */
  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return; // Already connected or connecting
    }

    this.intentionalClose = false;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._connected = true;
        this.reconnectAttempts = 0;
        this.startHeartbeat();
        this.notifyConnection(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as DaemonEvent;
          this.dispatchEvent(data);
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this._connected = false;
        this.stopHeartbeat();
        this.notifyConnection(false);

        if (!this.intentionalClose && this.autoReconnect) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // Error is followed by close event — reconnect handled there
      };
    } catch {
      // Connection failed — schedule reconnect
      if (this.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /** Disconnect from the daemon WebSocket. */
  disconnect(): void {
    this.intentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this._connected = false;
  }

  /**
   * Subscribe to events on specific channels.
   * Channels support wildcards: 'app.*' matches all app events.
   * Use '*' to subscribe to all events.
   */
  on(channel: string, callback: EventCallback): () => void {
    let listeners = this.eventListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(channel, listeners);
    }
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      listeners!.delete(callback);
      if (listeners!.size === 0) {
        this.eventListeners.delete(channel);
      }
    };
  }

  /** Subscribe to connection state changes. */
  onConnection(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback);
    return () => this.connectionListeners.delete(callback);
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private dispatchEvent(event: DaemonEvent): void {
    // Exact match listeners
    const exact = this.eventListeners.get(event.channel);
    if (exact) {
      for (const cb of exact) cb(event);
    }

    // Wildcard listeners (e.g., 'app.*' matches 'app.started')
    for (const [pattern, listeners] of this.eventListeners) {
      if (pattern === '*') {
        for (const cb of listeners) cb(event);
      } else if (pattern.endsWith('.*')) {
        const prefix = pattern.slice(0, -2);
        if (event.channel.startsWith(prefix + '.')) {
          for (const cb of listeners) cb(event);
        }
      }
    }
  }

  private notifyConnection(connected: boolean): void {
    for (const cb of this.connectionListeners) {
      try {
        cb(connected);
      } catch {
        // Listener error should not crash
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/** Singleton WebSocket client for the daemon. */
let _wsClient: DaemonWsClient | null = null;

export function getDaemonWsClient(): DaemonWsClient {
  if (!_wsClient) {
    _wsClient = new DaemonWsClient();
  }
  return _wsClient;
}
