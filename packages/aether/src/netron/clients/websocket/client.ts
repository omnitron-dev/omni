/**
 * Browser WebSocket Client for Netron
 *
 * Uses native browser WebSocket API with Netron's packet protocol
 * Compatible with Titan WebSocket server
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { encodePacket, decodePacket, Packet } from '../../packet/index.js';

export interface WebSocketClientOptions {
  url: string;
  protocols?: string | string[];
  timeout?: number;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * Browser WebSocket Connection using Netron packet protocol
 */
export class BrowserWebSocketConnection extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private protocols?: string | string[];
  private reconnectEnabled: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimeout?: number;
  private isManualDisconnect = false;

  constructor(options: WebSocketClientOptions) {
    super();
    this.url = options.url;
    this.protocols = options.protocols;
    this.reconnectEnabled = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.isManualDisconnect = false;

        // Create WebSocket connection
        this.ws = new WebSocket(this.url, this.protocols);
        this.ws.binaryType = 'arraybuffer';

        // Handle connection open
        this.ws.addEventListener('open', () => {
          this.reconnectAttempts = 0;
          this.emit('connect');
          resolve();
        });

        // Handle incoming messages
        this.ws.addEventListener('message', (event: MessageEvent) => {
          this.handleMessage(event.data);
        });

        // Handle errors
        this.ws.addEventListener('error', (event: Event) => {
          const error = new Error('WebSocket error');
          this.emit('error', error);
          reject(error);
        });

        // Handle close
        this.ws.addEventListener('close', (event: CloseEvent) => {
          this.emit('disconnect', event.reason);

          // Attempt reconnection if enabled and not manually disconnected
          if (this.reconnectEnabled && !this.isManualDisconnect) {
            this.attemptReconnect();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message (binary data)
   */
  private handleMessage(data: ArrayBuffer): void {
    try {
      // Decode packet from binary data
      const packet = decodePacket(data);
      this.emit('packet', packet);

      // Also emit raw message for compatibility
      this.emit('message', data, true); // true = isBinary
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Send a packet through WebSocket
   */
  async sendPacket(packet: Packet): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    // Encode packet to binary
    const buffer = encodePacket(packet);

    // Send as ArrayBuffer
    this.ws.send(buffer);
  }

  /**
   * Send raw data through WebSocket
   */
  async send(data: ArrayBuffer | Uint8Array): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(data);
  }

  /**
   * Disconnect from WebSocket server
   */
  async disconnect(): Promise<void> {
    this.isManualDisconnect = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Manual disconnect');
      }
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Attempt to reconnect to the server
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect-failed');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);

    this.reconnectTimeout = window.setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnect');
      } catch (error) {
        // Will trigger another reconnect attempt via close event
      }
    }, delay);
  }

  /**
   * Get remote address (not available in browser WebSocket)
   */
  get remoteAddress(): string | undefined {
    return this.url;
  }

  /**
   * Get local address (not available in browser WebSocket)
   */
  get localAddress(): string | undefined {
    return undefined;
  }
}
