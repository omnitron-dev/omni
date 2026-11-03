/**
 * WebSocket Server Implementation
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import { WebSocket, WebSocketServer, type VerifyClientCallbackSync } from 'ws';
import { IncomingMessage } from 'node:http';
import { TransportRequestLimiter } from '../request-limiter.js';
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
  private readonly answerClientPing: boolean;
  private readonly requestLimiter: TransportRequestLimiter;
  private readonly admittedClients = new WeakMap<IncomingMessage, string>();

  // Path prefix for WebSocket upgrade path matching (for reverse proxy support)
  private pathPrefix: string;

  constructor(wss: WebSocketServer, options: WebSocketOptions = {}) {
    super(options);
    this.wss = wss;
    this.requestLimiter = options.requestLimiter ?? new TransportRequestLimiter(options.rateLimit);
    this.answerClientPing = wss.options?.autoPong !== false;
    if (this.requestLimiter.enabled) {
      // ws normally sends a pong before any application listener sees the ping.
      wss.options.autoPong = false;
      this.limitUpgrades();
    }

    // Initialize path prefix (normalize to canonical form without leading/trailing slashes)
    this.pathPrefix = this.normalizePathPrefix(options.pathPrefix);

    this.setupEventHandlers();

    // Don't emit listening in constructor - wait for listen() to be called
  }

  private limitUpgrades(): void {
    const original = this.wss.options.verifyClient;
    this.wss.options.verifyClient = (info, done) => {
      let key: string;
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(info.req.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
        }
        const path = info.req.url || '/';
        // Use a fixed origin for the request passed to a custom key generator.
        // Host is controlled by the caller and cannot establish the client IP.
        const request = new Request('http://localhost' + (path.startsWith('/') ? path : '/' + path), { headers });
        key = this.requestLimiter.clientKey(request, info.req.socket.remoteAddress);
      } catch {
        done(false, 400, 'Invalid upgrade request');
        return;
      }
      const result = this.requestLimiter.consume(key);
      if (!result.allowed) {
        done(false, 429, 'Too Many Requests', { 'Retry-After': String(result.retryAfter) });
        return;
      }
      this.admittedClients.set(info.req, key);
      if (!original) done(true);
      else if (original.length === 2) original.call(this.wss.options, info, done);
      else done((original as VerifyClientCallbackSync).call(this.wss.options, info));
    };
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

      const key = this.admittedClients.get(request);
      if (this.requestLimiter.enabled && key === undefined) {
        socket.close(1008, 'Upgrade admission required');
        return;
      }
      const auth = this.authHandler ? await this.authHandler.authenticateConnection(request) : undefined;
      if (auth && !auth.success) {
        socket.close(4001, auth.error || 'Unauthorized');
        return;
      }
      const admit = key === undefined ? undefined : () => this.requestLimiter.consume(key);
      const connection = new WebSocketConnection(socket, this.options as WebSocketOptions, true, undefined, admit, this.answerClientPing);
      if (auth?.context) connection.setAuthContext(auth.context);
      (connection as any).request = request;
      this.handleConnection(connection);
    });

    // Handle server errors
    this.wss.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Handle server close
    this.wss.on('close', () => {
      if (!this.options.requestLimiter) this.requestLimiter.destroy();
      this.handleClose();
    });

    // No `handleListening()` here.
    //
    // What stood here was
    //   // @ts-expect-error - WebSocketServer doesn't have a listening property, but it works
    //   if (this.wss.listening || (this.wss as any).options?.server) this.handleListening();
    // and the comment was wrong: `wss.listening` is undefined (checked against
    // ws 8 — the flag lives on the underlying http server), so only the
    // `options.server` half ever matched. For that case it emitted 'listening'
    // from inside the constructor, before any caller could have attached a
    // listener, and then listen() emitted it again on next tick — the event was
    // not doubled only because the first one had no audience, while
    // serverStartTime, which `uptime` is measured from, was set twice.
    //
    // listen() covers both configurations, so it is the single path now.
  }

  /**
   * Start listening (WebSocketServer might already be listening)
   */
  async listen(): Promise<void> {
    // No-op if WebSocketServer was created with port option - it's automatically listening
    // Otherwise, WebSocketServer must have been provided with a server option
    //
    // `listening` is asked FIRST and `port` is compared against `undefined`,
    // because the same `0`-is-falsy reading that sent «any free port» to 8080
    // in the transport lands here too, one layer down: a server created with
    // `port: 0` IS listening, on a port the OS chose, and this refused it as
    // «not configured to listen». Two halves of one mistake, and fixing only
    // the first turned a silent wrong port into a loud false refusal.
    if (
      (this.wss as any).listening ||
      (this.wss as any).options?.port !== undefined ||
      (this.wss as any).options?.server
    ) {
      // Emit listening event on next tick to ensure listeners are attached
      process.nextTick(() => this.handleListening());
      // Also return a promise that resolves after the event is emitted
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      throw Errors.badRequest('WebSocketServer is not configured to listen. Provide port or server option.');
    }
  }

  /**
   * Close the WebSocket server.
   *
   * ── Why 1012 and not 1001 ─────────────────────────────────────────────
   *
   * RFC 6455 registers 1012 as «Service Restart» and 1001 as «Going Away»,
   * which a browser also sends when the PAGE navigates away. A client cannot
   * tell «this server is coming back in seconds» from «this endpoint is
   * flapping» out of 1001, so it must assume the worse of the two and back
   * off. Measured on the client that reads this
   * (`netron-browser/src/client/ws-client.ts`): the delay is a full-jitter
   * draw from `[1000, min(1000·2^(attempt−1), 30000)]`, so by the sixth
   * attempt — which a restart of minutes reaches — the socket can stay shut
   * for up to thirty seconds AFTER the server is answering again. The user
   * sees a dead chat long past the outage.
   *
   * 1012 says the one thing that makes a short retry safe: the server is
   * coming back. The client treats it as such for ONE attempt and then
   * resumes its ordinary backoff, so an endpoint that lied about restarting
   * is not hammered.
   *
   * THIS ALONE CHANGES NOTHING. The code is only useful because the client
   * was taught to read it in the same change; before that it did not look at
   * `event.code` at all. A close code nobody reads is a comment with a
   * number in it.
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all connections
      for (const client of this.wss.clients) {
        client.close(1012, 'Service restart');
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
