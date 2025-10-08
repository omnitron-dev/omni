/**
 * Netron RPC Client for Browser
 * High-level WebSocket client with automatic reconnection
 */

import { RemotePeer } from './remote-peer.js';
import { BrowserLogger, type ILogger } from './logger.js';
import type { INetron } from './types.js';

/**
 * Options for NetronClient
 */
export interface NetronClientOptions {
  /** Base URL of WebSocket server */
  url: string;

  /** Request timeout in milliseconds (default: 30000ms) */
  timeout?: number;

  /** Enable automatic reconnection on disconnect (default: false) */
  reconnect?: boolean;

  /** Reconnect interval in milliseconds (default: 5000ms) */
  reconnectInterval?: number;

  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;

  /** Custom logger instance */
  logger?: ILogger;

  /** Binary type for WebSocket (default: 'arraybuffer') */
  binaryType?: 'blob' | 'arraybuffer';
}

/**
 * Netron RPC Client for Browser
 * Supports WebSocket with binary protocol (MessagePack)
 *
 * @example
 * ```typescript
 * const client = new NetronClient({
 *   url: 'ws://localhost:3000',
 *   reconnect: true
 * });
 *
 * await client.connect();
 * const service = await client.queryInterface<MyService>('MyService@1.0.0');
 * const result = await service.myMethod();
 * await client.disconnect();
 * ```
 */
export class NetronClient {
  private ws: WebSocket | null = null;
  private peer: RemotePeer | null = null;
  private logger: ILogger;
  private reconnectAttempts = 0;
  private shouldReconnect = false;

  constructor(private options: NetronClientOptions) {
    this.logger = options.logger ?? new BrowserLogger({ client: 'NetronClient' });
  }

  /**
   * Connect to Netron server
   * Establishes WebSocket connection and initializes RemotePeer
   *
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info({ url: this.options.url }, 'Connecting to Netron server');

      this.ws = new WebSocket(this.options.url);
      this.ws.binaryType = this.options.binaryType ?? 'arraybuffer';

      this.ws.onopen = async () => {
        this.logger.info({ url: this.options.url }, 'Connected to Netron server');
        this.reconnectAttempts = 0;

        // Create minimal INetron stub for RemotePeer
        const netronStub: INetron = {
          uuid: crypto.randomUUID(),
          logger: this.logger,
          options: undefined,
          services: new Map(),
          peer: null as any, // Will be set after creation
          peers: new Map(),
          transportServers: new Map(),
          transportServer: undefined,
          getLocalPeer: () => {
            throw new Error('getLocalPeer() not available in browser client');
          },
          findPeer: () => undefined,
          trackTask: async () => {
            throw new Error('trackTask() not available in browser client');
          },
          runTask: undefined,
          emitSpecial: () => {
            // No-op in browser client
          },
          getServiceNames: () => [],
          emit: () => false,
          on(this: INetron) {
            return this;
          },
          off(this: INetron) {
            return this;
          },
          removeListener(this: INetron) {
            return this;
          },
          getPeerEventName: undefined,
        };

        // Create RemotePeer
        this.peer = new RemotePeer(
          this.ws!,
          netronStub,
          crypto.randomUUID(),
          this.options.timeout
        );

        // Set peer reference in stub
        netronStub.peer = this.peer as any;

        try {
          // Initialize as connector (client mode)
          await this.peer.init(true);

          // Enable reconnection if configured
          if (this.options.reconnect !== false) {
            this.shouldReconnect = true;
          }

          resolve();
        } catch (error) {
          this.logger.error({ error }, 'Failed to initialize peer');
          reject(error);
        }
      };

      this.ws.onerror = (error) => {
        this.logger.error({ error }, 'WebSocket error');
        reject(error);
      };

      this.ws.onclose = (event) => {
        this.logger.warn({ code: event.code, reason: event.reason }, 'WebSocket closed');
        this.handleReconnect();
      };
    });
  }

  /**
   * Query service interface by name
   * Returns a proxy object that allows calling remote methods
   *
   * @param serviceName - Service name with optional version (e.g. 'Calculator@1.0.0')
   * @returns Promise resolving to service proxy
   * @throws Error if not connected or service not found
   *
   * @example
   * ```typescript
   * const calc = await client.queryInterface<Calculator>('Calculator@1.0.0');
   * const result = await calc.add(2, 3);
   * ```
   */
  async queryInterface<T = any>(serviceName: string): Promise<T> {
    if (!this.peer) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.peer.queryInterface<T>(serviceName);
  }

  /**
   * Subscribe to events from the server
   *
   * @param event - Event name to subscribe to
   * @param handler - Event handler function
   * @throws Error if not connected
   *
   * @example
   * ```typescript
   * await client.subscribe('user.created', (data) => {
   *   console.log('New user:', data);
   * });
   * ```
   */
  async subscribe(event: string, handler: (...args: any[]) => void): Promise<void> {
    if (!this.peer) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.peer.subscribe(event, handler);
  }

  /**
   * Unsubscribe from events
   *
   * @param event - Event name to unsubscribe from
   * @param handler - Event handler to remove
   * @throws Error if not connected
   */
  async unsubscribe(event: string, handler: (...args: any[]) => void): Promise<void> {
    if (!this.peer) {
      throw new Error('Not connected. Call connect() first.');
    }
    return this.peer.unsubscribe(event, handler);
  }

  /**
   * Disconnect from server
   * Closes WebSocket connection and cleans up resources
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.logger.info('Disconnecting from Netron server');

    if (this.peer) {
      try {
        await this.peer.close();
      } catch (error) {
        this.logger.warn({ error }, 'Error closing peer');
      }
    }

    if (this.ws) {
      this.ws.close();
    }

    this.peer = null;
    this.ws = null;
  }

  /**
   * Check if currently connected to server
   *
   * @returns true if WebSocket is open
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current peer instance
   * Useful for advanced operations
   *
   * @returns RemotePeer instance or null if not connected
   */
  getPeer(): RemotePeer | null {
    return this.peer;
  }

  /**
   * Handle automatic reconnection
   * Called when WebSocket closes unexpectedly
   */
  private async handleReconnect(): Promise<void> {
    if (!this.shouldReconnect) {
      this.logger.info('Reconnection disabled, not reconnecting');
      return;
    }

    const maxAttempts = this.options.maxReconnectAttempts ?? Infinity;
    if (this.reconnectAttempts >= maxAttempts) {
      this.logger.error({ attempts: this.reconnectAttempts }, 'Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.options.reconnectInterval ?? 5000;

    this.logger.info(
      { delay, attempt: this.reconnectAttempts, maxAttempts },
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    setTimeout(() => {
      this.connect().catch((err) => {
        this.logger.error({ error: err }, 'Reconnect failed');
      });
    }, delay);
  }
}
