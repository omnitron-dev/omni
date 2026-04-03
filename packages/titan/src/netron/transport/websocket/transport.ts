/**
 * WebSocket Transport Implementation
 *
 * Default transport for Netron, providing WebSocket connectivity for both browser and Node.js.
 * Fully compatible with the existing Netron WebSocket implementation.
 *
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import { WebSocket, WebSocketServer } from 'ws';
import { BaseTransport } from '../base-transport.js';
import type { TransportCapabilities, ITransportConnection, ITransportServer } from '../types.js';
import { NetronErrors, Errors } from '../../../errors/index.js';
import { WebSocketConnection } from './connection.js';
import { WebSocketServerAdapter } from './server.js';
import type { WebSocketOptions } from './types.js';

/**
 * WebSocket Transport
 */
export class WebSocketTransport extends BaseTransport {
  readonly name = 'websocket';
  readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: false, // WebSockets don't support native reconnection
    multiplexing: false,
    server: true,
  };

  /**
   * Connect to a WebSocket server
   */
  async connect(address: string, options: WebSocketOptions = {}): Promise<ITransportConnection> {
    const parsed = this.parseAddress(address);

    // Build WebSocket URL
    let url: string;
    if (address.startsWith('ws://') || address.startsWith('wss://')) {
      url = address;
    } else if (parsed.host && parsed.port) {
      const protocol = options.headers?.['X-Forwarded-Proto'] === 'https' ? 'wss' : 'ws';
      url = `${protocol}://${parsed.host}:${parsed.port}${parsed.path || ''}`;
    } else {
      throw Errors.badRequest(`Invalid WebSocket address: ${address}`, { address, parsed });
    }

    // Detect environment
    const isNode = typeof window === 'undefined';

    if (isNode) {
      // Node.js environment
      const socket = new WebSocket(url, options.protocols, {
        perMessageDeflate: options.perMessageDeflate,
        maxPayload: options.maxPayload,
        handshakeTimeout: options.handshakeTimeout ?? options.connectTimeout,
        headers: options.headers,
      });

      // Create connection with URL for reconnection support
      const connection = new WebSocketConnection(socket, options, false, url);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.terminate();
          reject(NetronErrors.connectionTimeout('websocket', address));
        }, options.connectTimeout ?? 10000);

        socket.once('open', () => {
          clearTimeout(timeout);
          resolve(connection);
        });

        socket.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } else {
      // Browser environment
      const BrowserWebSocket = (window as any).WebSocket || (window as any).MozWebSocket;
      if (!BrowserWebSocket) {
        throw Errors.notImplemented('WebSocket is not supported in this browser');
      }

      const socket = new BrowserWebSocket(url, options.protocols) as unknown as WebSocket;
      const connection = new WebSocketConnection(socket, options, false, url);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(NetronErrors.connectionTimeout('websocket', url));
        }, options.connectTimeout ?? 10000);

        connection.once('connect', () => {
          clearTimeout(timeout);
          resolve(connection);
        });

        connection.once('error', (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }
  }

  /**
   * Create a WebSocket server
   */
  override async createServer(options: WebSocketOptions = {}): Promise<ITransportServer> {
    // Check if we're in Node.js
    if (typeof window !== 'undefined') {
      throw Errors.notImplemented('Cannot create WebSocket server in browser environment');
    }

    // Parse host and port from options
    const host = options.host || '0.0.0.0'; // Use 0.0.0.0 to bind to all interfaces
    const port = options.port || 8080;

    const wss = new WebSocketServer({
      host,
      port,
      perMessageDeflate: options.perMessageDeflate,
      maxPayload: options.maxPayload,
      ...((options as any).serverOptions || {}),
    });

    const server = new WebSocketServerAdapter(wss, options);

    // The WebSocketServer automatically starts listening when created with a port
    // Wait a bit to ensure it's ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    return server;
  }

  /**
   * Parse WebSocket address with default port handling
   */
  override parseAddress(address: string): any {
    const parsed = super.parseAddress(address);

    // Add default ports for ws and wss protocols
    if (!parsed.port) {
      if (parsed.protocol === 'ws') {
        parsed.port = 80;
      } else if (parsed.protocol === 'wss') {
        parsed.port = 443;
      }
    }

    // Set default path if not specified
    if (!parsed.path) {
      parsed.path = '/';
    }

    return parsed;
  }

  /**
   * Check if address is valid WebSocket URL
   */
  override isValidAddress(address: string): boolean {
    try {
      // Check for WebSocket protocols explicitly in the address
      if (address.startsWith('ws://') || address.startsWith('wss://')) {
        new URL(address); // Validate URL format
        return true;
      }

      // WebSocket requires explicit ws:// or wss:// prefix
      // Don't accept plain addresses without protocol
      return false;
    } catch {
      return false;
    }
  }
}
