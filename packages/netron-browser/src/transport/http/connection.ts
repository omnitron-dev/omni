/**
 * HttpConnection - Native HTTP connection without packet protocol
 *
 * This connection implementation uses native HTTP JSON messages instead of
 * binary packet encoding for improved performance and compatibility.
 *
 * BROWSER ADAPTED: Removed Node.js-specific APIs (setImmediate, NodeJS.Timeout)
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { TitanError, ErrorCode, NetronErrors } from '../../errors/index.js';
import type { HttpRequestMessage, HttpResponseMessage } from './types.js';
import { createRequestMessage, isHttpResponseMessage } from './types.js';

/**
 * Connection state enum
 */
export const ConnectionState = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
} as const;
export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

/**
 * Normalize a path prefix by removing trailing slashes.
 * Returns empty string for undefined/null/empty input.
 *
 * @param prefix - The path prefix to normalize
 * @returns Normalized path prefix without trailing slash
 */
function normalizePathPrefix(prefix?: string): string {
  if (!prefix) return '';
  return prefix.replace(/\/+$/, '');
}

/**
 * Transport options
 */
export interface TransportOptions {
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request timeout */
  requestTimeout?: number;
  /** Path prefix for all endpoints (e.g., '/api/v1', '/core') */
  pathPrefix?: string;
  /**
   * Fetch credentials policy applied to every request issued through
   * this connection. Cookie-mode deployments set 'include' so the
   * browser ships its cookie jar on cross-origin gateway calls. Left
   * undefined → browser default ('same-origin').
   */
  credentials?: RequestCredentials;
}

/**
 * HTTP Direct Connection
 * Implements connection interface with native HTTP messaging
 */
export class HttpConnection extends EventEmitter {
  readonly id: string;
  private _state: ConnectionState = ConnectionState.CONNECTING;
  private baseUrl: string;
  private pathPrefix: string;
  private options: TransportOptions;
  // NB-11: one AbortController PER in-flight request. A single shared controller
  // was overwritten by every request, so a request's timeout aborted whichever
  // request happened to write the field last (not itself), and close() could
  // only cancel the most recent one. The set lets close() abort them all.
  private readonly inFlight = new Set<AbortController>();

  // Request tracking
  private pendingRequests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: any) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  get state(): ConnectionState {
    return this._state;
  }

  get remoteAddress(): string {
    return this.baseUrl;
  }

  get localAddress(): string | undefined {
    return undefined; // Not applicable for HTTP client
  }

  constructor(baseUrl: string, options?: TransportOptions) {
    super();
    this.id = this.generateId();
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.pathPrefix = normalizePathPrefix(options?.pathPrefix);
    this.options = options || {};

    // Initialize connection
    this.initializeConnection();
  }

  /**
   * Build a full URL by combining baseUrl, pathPrefix, and endpoint.
   *
   * @param endpoint - The endpoint path (e.g., '/netron/invoke')
   * @returns Full URL string
   */
  private buildUrl(endpoint: string): string {
    return `${this.baseUrl}${this.pathPrefix}${endpoint}`;
  }

  /**
   * Initialize the connection
   */
  private async initializeConnection(): Promise<void> {
    // For HTTP, we consider it connected immediately since it's stateless
    this._state = ConnectionState.CONNECTED;

    // Emit connect event asynchronously (browser uses setTimeout instead of setImmediate)
    setTimeout(() => {
      this.emit('connect');
    }, 0);
  }

  /**
   * Generate unique connection ID
   */
  private generateId(): string {
    return `http-direct-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Send data using native HTTP messaging
   */
  async send(data: ArrayBuffer | Uint8Array): Promise<void> {
    // For compatibility with existing code, try to parse as JSON
    const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

    try {
      const str = new TextDecoder().decode(buffer);
      const msg = JSON.parse(str);

      // Handle different message types
      if (msg.type === 'request' || msg.service) {
        // Convert to new message format
        const request = createRequestMessage(msg.service || '__system', msg.method || msg.type, msg.input || msg.data);

        const response = await this.sendRequestMessage(request);

        // Emit response for compatibility
        const responseStr = JSON.stringify(response);
        const responseBuffer = new TextEncoder().encode(responseStr);
        this.emit('message', responseBuffer, true);
      }
    } catch (_error) {
      // Not JSON or unknown format, silently ignore
      // This is normal for HTTP connections receiving non-JSON data
    }
  }

  /**
   * Send HTTP request message
   */
  private async sendRequestMessage(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    const response = await this.sendHttpRequest<HttpResponseMessage>('POST', '/netron/invoke', message);

    if (!isHttpResponseMessage(response)) {
      throw new TitanError({
        code: ErrorCode.UNPROCESSABLE_ENTITY,
        message: 'Invalid response format from server',
      });
    }

    return response;
  }

  /**
   * Send HTTP request
   */
  private async sendHttpRequest<T>(method: string, path: string, body?: any): Promise<T> {
    const url = this.buildUrl(path);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.options?.headers,
    };

    const timeout = this.options?.timeout || 30000;
    // NB-11: per-request controller, tracked so close() can abort it without
    // cross-cancelling sibling requests.
    const controller = new AbortController();
    this.inFlight.add(controller);

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        // T#176 — propagate the transport-level credentials policy.
        ...(this.options?.credentials !== undefined ? { credentials: this.options.credentials } : {}),
      });

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          if (errorData.error) {
            throw new TitanError({
              code: (typeof errorData.error.code === 'number'
                ? errorData.error.code
                : ErrorCode.INTERNAL_ERROR) as ErrorCode,
              message: errorData.error.message,
              details: errorData.error.details,
            });
          }
        } catch {
          // Fallback to HTTP status error
        }

        // Preserve the upstream HTTP status as the error code so the
        // consuming app's locale dictionary can translate it. The
        // previous default (`INTERNAL_ERROR=500`) collapsed every
        // 5xx into "internal error", which left auth screens
        // mistranslating gateway 502s as "wrong credentials".
        throw new TitanError({
          code: response.status as ErrorCode,
          message: `HTTP ${response.status}: ${response.statusText}`,
        });
      }

      return await response.json();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new TitanError({
          code: ErrorCode.REQUEST_TIMEOUT,
          message: `Request timeout after ${timeout}ms`,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      this.inFlight.delete(controller);
    }
  }

  /**
   * Ping the server to measure round-trip time
   * HTTP implementation uses a lightweight discovery request
   */
  async ping(): Promise<number> {
    if (this._state !== ConnectionState.CONNECTED) {
      throw NetronErrors.connectionClosed('http', 'Connection is not established');
    }

    const startTime = Date.now();
    // NB-11: own controller, tracked so close() can abort an in-flight ping.
    const controller = new AbortController();
    this.inFlight.add(controller);

    try {
      // Use discovery endpoint as a lightweight ping
      const response = await fetch(this.buildUrl('/discover'), {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        ...(this.options?.credentials !== undefined ? { credentials: this.options.credentials } : {}),
      });

      if (!response.ok) {
        throw NetronErrors.connectionFailed(
          'http',
          this.baseUrl,
          new Error(`Ping failed with status ${response.status}`)
        );
      }

      const rtt = Date.now() - startTime;
      return rtt;
    } catch (error) {
      throw NetronErrors.connectionFailed(
        'http',
        this.baseUrl,
        error instanceof Error ? error : new Error(String(error))
      );
    } finally {
      this.inFlight.delete(controller);
    }
  }

  /**
   * Close the connection
   */
  async close(code?: number, reason?: string): Promise<void> {
    if (this._state === ConnectionState.DISCONNECTED) {
      return;
    }

    this._state = ConnectionState.DISCONNECTED;

    // Abort any in-flight requests (NB-11: each request has its own controller).
    for (const controller of this.inFlight) {
      controller.abort();
    }
    this.inFlight.clear();

    // Reject all pending requests
    for (const [_id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(NetronErrors.connectionClosed('http', reason));
    }
    this.pendingRequests.clear();

    this.emit('disconnect', { code, reason });
  }

  /**
   * Reconnect (for compatibility - HTTP is stateless)
   */
  async reconnect(): Promise<void> {
    this._state = ConnectionState.CONNECTING;

    // HTTP doesn't really need to reconnect, just update state
    await new Promise((resolve) => setTimeout(resolve, 100));

    this._state = ConnectionState.CONNECTED;
    this.emit('connect');
  }

  /**
   * Check if connection is alive
   */
  isAlive(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): any {
    return {
      id: this.id,
      state: this._state,
      baseUrl: this.baseUrl,
      pathPrefix: this.pathPrefix,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /**
   * Get the configured path prefix
   */
  getPathPrefix(): string {
    return this.pathPrefix;
  }
}
