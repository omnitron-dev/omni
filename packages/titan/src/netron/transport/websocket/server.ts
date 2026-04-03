/**
 * WebSocket Server Implementation
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'node:http';
import { BaseServer } from '../base-transport.js';
import { Errors } from '../../../errors/index.js';
import { WebSocketAuthHandler, type WebSocketAuthOptions } from './auth.js';
import { WebSocketConnection } from './connection.js';
import type { WebSocketOptions } from './types.js';

/**
 * WebSocket server implementation
 */
export class WebSocketServerAdapter extends BaseServer {
  private wss: WebSocketServer;
  private httpServer?: any;
  private authHandler?: WebSocketAuthHandler;

  // Path prefix for WebSocket upgrade path matching (for reverse proxy support)
  private pathPrefix: string;

  constructor(wss: WebSocketServer, options: WebSocketOptions = {}) {
    super(options);
    this.wss = wss;

    // Initialize path prefix (normalize to canonical form without leading/trailing slashes)
    this.pathPrefix = this.normalizePathPrefix(options.pathPrefix);

    this.setupEventHandlers();

    // Don't emit listening in constructor - wait for listen() to be called
  }

  /**
   * Normalize path prefix to canonical form (no leading/trailing slashes)
   */
  private normalizePathPrefix(prefix?: string): string {
    if (!prefix) {
      return '';
    }
    return prefix.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/+/g, '/');
  }

  /**
   * Check if the request URL matches the configured path prefix.
   * Used to filter WebSocket upgrade requests when running behind a reverse proxy.
   *
   * @param requestUrl - The URL from the HTTP upgrade request
   * @returns true if the path matches (or no prefix is configured)
   */
  private matchesPathPrefix(requestUrl: string | undefined): boolean {
    // No prefix configured - accept all paths (backward compatible)
    if (!this.pathPrefix) {
      return true;
    }

    if (!requestUrl) {
      return false;
    }

    // Parse the URL to get pathname (strip query string and hash)
    try {
      // requestUrl may be just a path (e.g., "/ws") or a path with query string ("/ws?token=...")
      const pathname = new URL(requestUrl, 'http://localhost').pathname;

      // Build expected prefix pattern
      const prefixPattern = `/${this.pathPrefix}`;

      // Check if pathname starts with the prefix
      return pathname === prefixPattern || pathname.startsWith(`${prefixPattern}/`);
    } catch {
      return false;
    }
  }

  /**
   * Configure authentication for WebSocket connections
   */
  configureAuth(options: WebSocketAuthOptions): void {
    this.authHandler = new WebSocketAuthHandler(options);
  }

  get address(): string | undefined {
    const addr = this.wss.address();
    if (typeof addr === 'string') return addr;
    return addr?.address;
  }

  get port(): number | undefined {
    const addr = this.wss.address();
    if (typeof addr === 'object' && addr !== null) {
      return addr.port;
    }
    // Fallback to options if address() doesn't work yet
    return (this.wss as any).options?.port;
  }

  /**
   * Setup WebSocket server event handlers
   */
  private setupEventHandlers(): void {
    // Handle new connections
    this.wss.on('connection', async (socket: WebSocket, request: IncomingMessage) => {
      // Check if request URL matches path prefix (for reverse proxy support)
      if (!this.matchesPathPrefix(request.url)) {
        // Path doesn't match - close connection with 4000 (Generic error)
        socket.close(4000, 'Path not found');
        return;
      }

      // Authenticate connection if auth handler is configured
      if (this.authHandler) {
        const authResult = await this.authHandler.authenticateConnection(request);

        if (!authResult.success) {
          // Close with 4001 (Unauthorized) or 4003 (Forbidden)
          socket.close(4001, authResult.error || 'Unauthorized');
          return;
        }

        const connection = new WebSocketConnection(socket, this.options as WebSocketOptions, true);

        // Store auth context on connection if available
        if (authResult.context) {
          connection.setAuthContext(authResult.context);
        }

        // Add request info to connection
        (connection as any).request = request;

        this.handleConnection(connection);
      } else {
        // No auth configured - allow all connections (existing behavior)
        const connection = new WebSocketConnection(socket, this.options as WebSocketOptions, true);

        // Add request info to connection
        (connection as any).request = request;

        this.handleConnection(connection);
      }
    });

    // Handle server errors
    this.wss.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Handle server close
    this.wss.on('close', () => {
      this.handleClose();
    });

    // If server is already listening
    // @ts-expect-error - WebSocketServer doesn't have a listening property, but it works
    if (this.wss.listening || (this.wss as any).options?.server) {
      this.handleListening();
    }
  }

  /**
   * Start listening (WebSocketServer might already be listening)
   */
  async listen(): Promise<void> {
    // No-op if WebSocketServer was created with port option - it's automatically listening
    // Otherwise, WebSocketServer must have been provided with a server option
    if ((this.wss as any).options?.port || (this.wss as any).options?.server || (this.wss as any).listening) {
      // Emit listening event on next tick to ensure listeners are attached
      process.nextTick(() => this.handleListening());
      // Also return a promise that resolves after the event is emitted
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      throw Errors.badRequest('WebSocketServer is not configured to listen. Provide port or server option.');
    }
  }

  /**
   * Close the WebSocket server
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all connections
      for (const client of this.wss.clients) {
        client.close(1001, 'Server closing');
      }

      this.wss.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}
