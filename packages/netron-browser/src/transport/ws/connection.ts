/**
 * WebSocket Connection for Browser
 *
 * Browser-compatible WebSocket connection using native WebSocket API.
 * Handles connection lifecycle, message queueing, and reconnection logic.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { NetronErrors } from '../../errors/index.js';
import { encodePacket, decodePacket, Packet } from '../../packet/index.js';

/**
 * Connection state enum
 */
export enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error',
}

/**
 * WebSocket connection options
 */
export interface WebSocketConnectionOptions {
  /** WebSocket protocols */
  protocols?: string | string[];
  /** Enable automatic reconnection */
  reconnect?: boolean;
  /** Initial reconnection delay in milliseconds */
  reconnectDelay?: number;
  /** Maximum reconnection delay in milliseconds */
  maxReconnectDelay?: number;
  /** Reconnection backoff multiplier */
  reconnectBackoffMultiplier?: number;
  /** Maximum number of reconnection attempts (Infinity for unlimited) */
  maxReconnectAttempts?: number;
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Keep-alive ping interval in milliseconds */
  keepAliveInterval?: number;
  /** Keep-alive pong timeout in milliseconds */
  keepAliveTimeout?: number;
  /** Queue messages during disconnection */
  queueMessages?: boolean;
  /** Maximum queue size */
  maxQueueSize?: number;
}

/**
 * Default WebSocket connection options
 */
const DEFAULT_OPTIONS: Required<WebSocketConnectionOptions> = {
  protocols: [],
  reconnect: true,
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectBackoffMultiplier: 1.5,
  maxReconnectAttempts: Infinity,
  connectTimeout: 10000,
  keepAliveInterval: 30000,
  keepAliveTimeout: 5000,
  queueMessages: true,
  maxQueueSize: 100,
};

/**
 * WebSocket Connection implementation for browser
 */
export class WebSocketConnection extends EventEmitter {
  readonly id: string;
  readonly url: string;
  readonly options: Required<WebSocketConnectionOptions>;

  private ws?: WebSocket;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimeout?: number;
  private connectTimeout?: number;
  private keepAliveInterval?: number;
  private keepAlivePongTimeout?: number;
  private lastPongTime = 0;
  private isManualClose = false;
  private messageQueue: Uint8Array[] = [];

  // Metrics
  private metrics = {
    bytesSent: 0,
    bytesReceived: 0,
    messagesSent: 0,
    messagesReceived: 0,
    reconnectCount: 0,
    lastConnectTime: 0,
    lastDisconnectTime: 0,
  };

  get state(): ConnectionState {
    return this._state;
  }

  get remoteAddress(): string {
    return this.url;
  }

  get localAddress(): string | undefined {
    return undefined; // Not applicable for browser WebSocket
  }

  get isConnected(): boolean {
    return this._state === ConnectionState.CONNECTED && this.ws?.readyState === WebSocket.OPEN;
  }

  constructor(url: string, options?: WebSocketConnectionOptions) {
    super();
    this.id = this.generateId();
    this.url = url;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate unique connection ID
   */
  private generateId(): string {
    return `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnected) {
        resolve();
        return;
      }

      this.isManualClose = false;
      this._state = ConnectionState.CONNECTING;

      try {
        // Create WebSocket connection
        this.ws = new WebSocket(this.url, this.options.protocols);
        this.ws.binaryType = 'arraybuffer';

        // Setup timeout for connection
        this.connectTimeout = window.setTimeout(() => {
          if (this._state === ConnectionState.CONNECTING) {
            this.ws?.close();
            reject(NetronErrors.connectionTimeout('websocket', this.url));
          }
        }, this.options.connectTimeout);

        // Handle connection open
        this.ws.addEventListener('open', () => {
          if (this.connectTimeout) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = undefined;
          }

          this._state = ConnectionState.CONNECTED;
          this.reconnectAttempts = 0;
          this.metrics.lastConnectTime = Date.now();
          this.lastPongTime = Date.now();

          // Start keep-alive if enabled
          if (this.options.keepAliveInterval > 0) {
            this.startKeepAlive();
          }

          // Send queued messages
          this.flushMessageQueue();

          this.emit('connect');
          resolve();
        });

        // Handle incoming messages
        this.ws.addEventListener('message', (event: MessageEvent) => {
          this.handleMessage(event.data);
        });

        // Handle errors
        this.ws.addEventListener('error', () => {
          const error = NetronErrors.connectionFailed(
            'websocket',
            this.url,
            new Error('WebSocket error')
          );
          this._state = ConnectionState.ERROR;
          this.emit('error', error);

          if (this.connectTimeout) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = undefined;
            reject(error);
          }
        });

        // Handle close
        this.ws.addEventListener('close', (event: CloseEvent) => {
          this.handleDisconnect(event.code, event.reason);

          if (this.connectTimeout) {
            clearTimeout(this.connectTimeout);
            this.connectTimeout = undefined;
            reject(NetronErrors.connectionClosed('websocket', event.reason));
          }
        });
      } catch (error) {
        this._state = ConnectionState.ERROR;
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: ArrayBuffer | string): void {
    try {
      // Convert to Uint8Array
      const buffer = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data);

      this.metrics.bytesReceived += buffer.byteLength;
      this.metrics.messagesReceived++;

      // Decode packet
      const packet = decodePacket(buffer);

      // Emit packet event
      this.emit('packet', packet);
      this.emit('message', buffer, false);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(code: number, reason: string): void {
    this._state = ConnectionState.DISCONNECTED;
    this.metrics.lastDisconnectTime = Date.now();

    // Clear timers
    this.clearTimers();

    this.emit('disconnect', { code, reason });

    // Attempt reconnection if enabled and not manually closed
    if (this.options.reconnect && !this.isManualClose) {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.emit('reconnect-failed', this.reconnectAttempts);
      return;
    }

    this._state = ConnectionState.RECONNECTING;
    this.reconnectAttempts++;

    // Calculate exponential backoff delay
    const delay = Math.min(
      this.options.reconnectDelay * Math.pow(this.options.reconnectBackoffMultiplier, this.reconnectAttempts - 1),
      this.options.maxReconnectDelay
    );

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        this.metrics.reconnectCount++;
        await this.connect();
        this.emit('reconnect', this.reconnectAttempts);
      } catch (error) {
        // Error will trigger another reconnect attempt via close event
      }
    }, delay);
  }

  /**
   * Start keep-alive mechanism
   */
  private startKeepAlive(): void {
    this.keepAliveInterval = window.setInterval(() => {
      if (!this.isConnected) {
        return;
      }

      // Check if we received a pong recently
      const timeSinceLastPong = Date.now() - this.lastPongTime;
      if (timeSinceLastPong > this.options.keepAliveInterval + this.options.keepAliveTimeout) {
        // No pong received, consider connection dead
        this.ws?.close(1000, 'Keep-alive timeout');
        return;
      }

      // Send ping packet
      try {
        const pingPacket = new Packet(Packet.nextId());
        pingPacket.setImpulse(1); // Request
        pingPacket.setType(0x00); // TYPE_PING
        pingPacket.data = null;

        const encoded = encodePacket(pingPacket);
        this.sendRaw(encoded);

        // Set timeout for pong response
        this.keepAlivePongTimeout = window.setTimeout(() => {
          // No pong received, close connection
          this.ws?.close(1000, 'Keep-alive pong timeout');
        }, this.options.keepAliveTimeout);
      } catch (error) {
        this.emit('error', error);
      }
    }, this.options.keepAliveInterval);
  }

  /**
   * Handle pong response
   */
  private handlePong(): void {
    this.lastPongTime = Date.now();
    if (this.keepAlivePongTimeout) {
      clearTimeout(this.keepAlivePongTimeout);
      this.keepAlivePongTimeout = undefined;
    }
  }

  /**
   * Send packet through WebSocket
   */
  async send(packet: Packet): Promise<void> {
    const encoded = encodePacket(packet);
    return this.sendRaw(encoded);
  }

  /**
   * Send raw data through WebSocket
   */
  async sendRaw(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        // Queue message if enabled
        if (this.options.queueMessages) {
          if (this.messageQueue.length >= this.options.maxQueueSize) {
            reject(NetronErrors.connectionClosed('websocket', 'Message queue full'));
            return;
          }
          this.messageQueue.push(data);
          resolve();
          return;
        }
        reject(NetronErrors.connectionClosed('websocket', 'WebSocket is not connected'));
        return;
      }

      try {
        this.ws!.send(data);
        this.metrics.bytesSent += data.byteLength;
        this.metrics.messagesSent++;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Flush queued messages
   */
  private flushMessageQueue(): void {
    if (!this.isConnected || this.messageQueue.length === 0) {
      return;
    }

    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const data of queue) {
      this.sendRaw(data).catch((error) => {
        this.emit('error', error);
      });
    }
  }

  /**
   * Close the WebSocket connection
   */
  async close(code = 1000, reason = 'Normal closure'): Promise<void> {
    return new Promise((resolve) => {
      this.isManualClose = true;

      if (this._state === ConnectionState.DISCONNECTED) {
        resolve();
        return;
      }

      this._state = ConnectionState.DISCONNECTING;

      // Clear timers
      this.clearTimers();

      // Clear message queue
      this.messageQueue = [];

      if (this.ws) {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          const closeHandler = () => {
            this.ws?.removeEventListener('close', closeHandler);
            resolve();
          };

          this.ws.addEventListener('close', closeHandler);
          this.ws.close(code, reason);

          // Force close after timeout
          setTimeout(() => {
            if (this._state !== ConnectionState.DISCONNECTED) {
              this._state = ConnectionState.DISCONNECTED;
              resolve();
            }
          }, 5000);
        } else {
          this._state = ConnectionState.DISCONNECTED;
          resolve();
        }
      } else {
        this._state = ConnectionState.DISCONNECTED;
        resolve();
      }
    });
  }

  /**
   * Ping the server to measure round-trip time
   */
  async ping(): Promise<number> {
    if (!this.isConnected) {
      throw NetronErrors.connectionClosed('websocket', 'Connection is not established');
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const pingPacket = new Packet(Packet.nextId());
      pingPacket.setImpulse(1); // Request
      pingPacket.setType(0x00); // TYPE_PING
      pingPacket.data = null;

      const timeout = setTimeout(() => {
        this.off('packet', pongHandler);
        reject(NetronErrors.connectionTimeout('websocket', this.url));
      }, 5000);

      const pongHandler = (packet: Packet) => {
        if (packet.id === pingPacket.id && packet.getType() === 0x00 && packet.getImpulse() === 0) {
          clearTimeout(timeout);
          this.off('packet', pongHandler);
          const rtt = Date.now() - startTime;
          this.handlePong();
          resolve(rtt);
        }
      };

      this.on('packet', pongHandler);
      this.send(pingPacket).catch((error) => {
        clearTimeout(timeout);
        this.off('packet', pongHandler);
        reject(error);
      });
    });
  }

  /**
   * Clear all timers
   */
  private clearTimers(): void {
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = undefined;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = undefined;
    }
    if (this.keepAlivePongTimeout) {
      clearTimeout(this.keepAlivePongTimeout);
      this.keepAlivePongTimeout = undefined;
    }
  }

  /**
   * Get connection metrics
   */
  getMetrics() {
    return {
      id: this.id,
      url: this.url,
      state: this._state,
      ...this.metrics,
      queuedMessages: this.messageQueue.length,
    };
  }

  /**
   * Reconnect the WebSocket
   */
  async reconnect(): Promise<void> {
    await this.close();
    this.isManualClose = false;
    await this.connect();
  }

  /**
   * Check if connection is alive
   */
  isAlive(): boolean {
    return this.isConnected;
  }
}
