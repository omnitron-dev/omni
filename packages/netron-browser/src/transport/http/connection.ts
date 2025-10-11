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
import type {
  HttpRequestMessage,
  HttpResponseMessage,
} from './types.js';
import { createRequestMessage, isHttpResponseMessage } from './types.js';

/**
 * Connection state enum
 */
export enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
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
}

/**
 * HTTP Direct Connection
 * Implements connection interface with native HTTP messaging
 */
export class HttpConnection extends EventEmitter {
  readonly id: string;
  private _state: ConnectionState = ConnectionState.CONNECTING;
  private baseUrl: string;
  private options: TransportOptions;
  private abortController?: AbortController;

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
    this.options = options || {};

    // Initialize connection
    this.initializeConnection();
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
    const buffer =
      data instanceof Uint8Array ? data : new Uint8Array(data);

    try {
      const str = new TextDecoder().decode(buffer);
      const msg = JSON.parse(str);

      // Handle different message types
      if (msg.type === 'request' || msg.service) {
        // Convert to new message format
        const request = createRequestMessage(
          msg.service || '__system',
          msg.method || msg.type,
          msg.input || msg.data,
        );

        const response = await this.sendRequestMessage(request);

        // Emit response for compatibility
        const responseStr = JSON.stringify(response);
        const responseBuffer = new TextEncoder().encode(responseStr);
        this.emit('message', responseBuffer, true);
      }
    } catch (error) {
      // Not JSON or unknown format, silently ignore
      // This is normal for HTTP connections receiving non-JSON data
    }
  }

  /**
   * Send HTTP request message
   */
  private async sendRequestMessage(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    const response = await this.sendHttpRequest<HttpResponseMessage>(
      'POST',
      '/netron/invoke',
      message,
    );

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
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Netron-Version': '2.0',
      ...this.options?.headers,
    };

    const timeout = this.options?.timeout || 30000;
    this.abortController = new AbortController();

    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          if (errorData.error) {
            throw new TitanError({
              code:
                (typeof errorData.error.code === 'number'
                  ? errorData.error.code
                  : ErrorCode.INTERNAL_ERROR) as ErrorCode,
              message: errorData.error.message,
              details: errorData.error.details,
            });
          }
        } catch {
          // Fallback to HTTP status error
        }

        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: `HTTP ${response.status}: ${response.statusText}`,
        });
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new TitanError({
          code: ErrorCode.REQUEST_TIMEOUT,
          message: `Request timeout after ${timeout}ms`,
        });
      }

      throw error;
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

    try {
      // Use discovery endpoint as a lightweight ping
      const response = await fetch(`${this.baseUrl}/discover`, {
        method: 'GET',
        signal: this.abortController?.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw NetronErrors.connectionFailed(
          'http',
          this.baseUrl,
          new Error(`Ping failed with status ${response.status}`),
        );
      }

      const rtt = Date.now() - startTime;
      return rtt;
    } catch (error) {
      throw NetronErrors.connectionFailed(
        'http',
        this.baseUrl,
        error instanceof Error ? error : new Error(String(error)),
      );
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

    // Abort any pending requests
    if (this.abortController) {
      this.abortController.abort();
    }

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
      pendingRequests: this.pendingRequests.size,
    };
  }
}
