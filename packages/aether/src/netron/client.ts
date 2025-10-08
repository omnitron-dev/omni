/**
 * Browser Netron Client - Client-Only Implementation
 *
 * Simplified Netron client for browser that connects to Titan WebSocket server
 * using the correct packet protocol.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { BrowserWebSocketConnection } from './clients/websocket/client.js';
import { WebSocketRemotePeer } from './clients/websocket/peer.js';
import { getQualifiedName } from './utils.js';

/**
 * Simple logger interface
 */
interface SimpleLogger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

/**
 * Client options
 */
export interface BrowserNetronClientOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable reconnection */
  reconnect?: boolean;
  /** Reconnection interval */
  reconnectInterval?: number;
  /** Maximum reconnection attempts */
  maxReconnectAttempts?: number;
  /** Custom logger */
  logger?: SimpleLogger;
}

/**
 * Browser Netron Client
 * Connects to Titan server and provides service interface access
 */
export class BrowserNetronClient extends EventEmitter {
  private connection: BrowserWebSocketConnection | null = null;
  private peer: WebSocketRemotePeer | null = null;
  private options: BrowserNetronClientOptions;
  private logger: SimpleLogger;
  public id: string;

  constructor(options: BrowserNetronClientOptions = {}) {
    super();
    this.options = options;
    this.logger = options.logger || console;

    // Generate unique client ID
    this.id = this.generateId();
  }

  /**
   * Connect to Titan WebSocket server
   */
  async connect(url: string): Promise<void> {
    this.logger.info(`Connecting to ${url}`);

    // Create WebSocket connection
    this.connection = new BrowserWebSocketConnection({
      url,
      timeout: this.options.timeout,
      reconnect: this.options.reconnect,
      reconnectInterval: this.options.reconnectInterval,
      maxReconnectAttempts: this.options.maxReconnectAttempts,
    });

    // Connect to server
    await this.connection.connect();

    // Wait for handshake
    await this.performHandshake();

    this.logger.info('Connected successfully');
  }

  /**
   * Perform handshake with server
   */
  private async performHandshake(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Wait for server ID message
      const messageHandler = (data: ArrayBuffer, isBinary: boolean) => {
        try {
          // Try to decode as JSON text (handshake message)
          // Server sends handshake as Buffer, which arrives as ArrayBuffer
          const text = new TextDecoder().decode(data);
          const message = JSON.parse(text);

          if (message.type === 'id') {
            // Server sent us their ID
            const serverId = message.id;
            this.logger.info(`Received server ID: ${serverId}`);

            // Create peer with server ID
            this.peer = new WebSocketRemotePeer(
              this.connection!,
              serverId,
              this.logger,
              this.options.timeout
            );

            // Initialize peer
            this.peer.init().then(() => {
              // Send our client ID to server
              const clientIdMessage = JSON.stringify({
                type: 'client-id',
                id: this.id,
              });
              this.connection!.send(new TextEncoder().encode(clientIdMessage));

              this.connection!.off('message', messageHandler);
              resolve();
            }).catch(reject);
          }
        } catch (error) {
          // Not JSON or not handshake message, ignore
          this.logger.debug?.('Non-handshake message during handshake:', error);
        }
      };

      this.connection!.on('message', messageHandler);

      // Timeout for handshake
      setTimeout(() => {
        this.connection!.off('message', messageHandler);
        reject(new Error('Handshake timeout'));
      }, this.options.timeout || 10000);
    });
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting');

    if (this.peer) {
      await this.peer.disconnect();
      this.peer = null;
    }

    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
    }
  }

  /**
   * Query service interface from server
   */
  queryInterface<T = any>(serviceName: string): T {
    if (!this.peer) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Split service name into name and version
    let name: string;
    let version: string | undefined;

    if (serviceName.includes('@')) {
      [name, version] = serviceName.split('@');
    } else {
      name = serviceName;
    }

    // Create service proxy
    return this.createServiceProxy(name, version);
  }

  /**
   * Create a proxy for service method calls
   */
  private createServiceProxy<T>(serviceName: string, version?: string): T {
    const qualifiedName = version ? getQualifiedName(serviceName, version) : serviceName;

    // Special properties that should not trigger proxy
    const SPECIAL_PROPERTIES = [
      'then',
      'catch',
      'finally',
      'constructor',
      'prototype',
      Symbol.toStringTag,
      Symbol.iterator,
      Symbol.asyncIterator,
    ];

    return new Proxy({} as T, {
      get: (_target, prop: string | symbol) => {
        // Filter out special properties
        if (SPECIAL_PROPERTIES.includes(prop as any)) {
          return undefined;
        }

        // Return undefined for internal properties
        if (typeof prop === 'symbol' || prop.startsWith('_')) {
          return undefined;
        }

        // Return a function that calls the remote method
        return async (...args: any[]) => {
          if (!this.peer) {
            throw new Error('Not connected');
          }

          // Query service definition if not already cached
          let def = Array.from(this.peer.definitions.values()).find(
            (d) => d.meta.name === qualifiedName
          );

          if (!def) {
            // Request service definition from server
            def = await this.peer.runTask('query_interface', qualifiedName);
            if (def) {
              this.peer.refService(def);
            }
          }

          if (!def) {
            throw new Error(`Service not found: ${qualifiedName}`);
          }

          // Call the method
          return await this.peer.call(def.id, prop as string, args);
        };
      },
    });
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connection !== null && this.connection.isConnected();
  }

  /**
   * Get client metrics
   */
  getMetrics() {
    return {
      id: this.id,
      connected: this.isConnected(),
      serverId: this.peer?.id,
    };
  }

  /**
   * Generate unique client ID
   */
  private generateId(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    // Fallback for older browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
