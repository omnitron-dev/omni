/**
 * WebSocket Transport Client for Netron Browser
 *
 * Provides WebSocket-based RPC communication with the Netron server
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { ConnectionMetrics, ConnectionState, RequestContext, RequestHints } from '../types/index.js';
import type { AuthenticationClient } from '../auth/client.js';
import { generateRequestId, calculateBackoff, httpToWsUrl } from '../utils/index.js';
import { ConnectionError, TimeoutError } from '../errors/index.js';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  type ClientMiddlewareContext,
  type IMiddlewareManager,
  type MiddlewareFunction,
  type MiddlewareConfig,
} from '../middleware/index.js';

/**
 * WebSocket client options
 */
export interface WebSocketClientOptions {
  /**
   * WebSocket URL
   */
  url: string;

  /**
   * WebSocket protocols
   */
  protocols?: string | string[];

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Enable automatic reconnection
   * @default true
   */
  reconnect?: boolean;

  /**
   * Reconnection interval in milliseconds
   * @default 1000
   */
  reconnectInterval?: number;

  /**
   * Maximum reconnection attempts
   * @default Infinity
   */
  maxReconnectAttempts?: number;

  /**
   * Authentication client for automatic token attachment
   */
  auth?: AuthenticationClient;

  /**
   * Middleware pipeline (optional, will create default if not provided)
   */
  middleware?: IMiddlewareManager;
}

/**
 * Pending request
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: number;
}

/**
 * WebSocket Transport Client implementation
 */
export class WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private protocols?: string | string[];
  private timeout: number;
  private reconnectEnabled: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;
  private reconnectTimeout?: number;
  private isManualDisconnect = false;
  private auth?: AuthenticationClient;
  private middleware: IMiddlewareManager;
  private state: ConnectionState = 'disconnected' as ConnectionState;
  private pendingRequests = new Map<string, PendingRequest>();
  private connectedAt?: number;
  private disconnectedAt?: number;
  private metrics = {
    requestsSent: 0,
    responsesReceived: 0,
    errors: 0,
    latencies: [] as number[],
  };

  constructor(options: WebSocketClientOptions) {
    super();

    // Convert HTTP URL to WebSocket URL if needed
    this.wsUrl = options.url.startsWith('http') ? httpToWsUrl(options.url) : options.url;

    this.protocols = options.protocols;
    this.timeout = options.timeout ?? 30000;
    this.reconnectEnabled = options.reconnect ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? Infinity;
    this.auth = options.auth;
    this.middleware = options.middleware || new MiddlewarePipeline();
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.isManualDisconnect = false;
        this.state = 'connecting' as ConnectionState;

        // Create WebSocket connection (detect environment)
        const WebSocketImpl =
          typeof WebSocket !== 'undefined'
            ? WebSocket
            : typeof globalThis !== 'undefined' && (globalThis as any).WebSocket
              ? (globalThis as any).WebSocket
              : null;

        if (!WebSocketImpl) {
          throw new Error('WebSocket is not available in this environment');
        }

        this.ws = new WebSocketImpl(this.wsUrl, this.protocols);
        this.ws!.binaryType = 'arraybuffer';

        const ws = this.ws!; // Capture ws in local variable to avoid null checks

        // Handle connection open
        ws.addEventListener('open', () => {
          this.state = 'connected' as ConnectionState;
          this.connectedAt = Date.now();
          this.reconnectAttempts = 0;
          this.emit('connect');
          resolve();
        });

        // Handle incoming messages
        ws.addEventListener('message', (event: MessageEvent) => {
          this.handleMessage(event.data);
        });

        // Handle errors
        ws.addEventListener('error', () => {
          const error = new ConnectionError('WebSocket error');
          this.state = 'failed' as ConnectionState;
          this.emit('error', error);
          reject(error);
        });

        // Handle close
        ws.addEventListener('close', (event: CloseEvent) => {
          this.state = 'disconnected' as ConnectionState;
          this.disconnectedAt = Date.now();
          this.emit('disconnect', event.reason);

          // Reject all pending requests
          for (const pending of this.pendingRequests.values()) {
            pending.reject(new ConnectionError('Connection closed'));
            clearTimeout(pending.timeout);
          }
          this.pendingRequests.clear();

          // Attempt reconnection if enabled and not manually disconnected
          if (this.reconnectEnabled && !this.isManualDisconnect) {
            this.attemptReconnect();
          }
        });
      } catch (error) {
        this.state = 'failed' as ConnectionState;
        reject(error);
      }
    });
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: ArrayBuffer | string): void {
    try {
      // Parse JSON message (simplified - in real implementation, use MessagePack)
      const packet = typeof data === 'string' ? JSON.parse(data) : data;

      this.emit('packet', packet);

      // Handle response packets
      if (packet.type === 2 /* RESPONSE */ || packet.type === 3 /* ERROR */) {
        const pending = this.pendingRequests.get(packet.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(packet.id);
          this.metrics.responsesReceived++;

          if (packet.type === 2 /* RESPONSE */) {
            pending.resolve(packet.payload);
          } else {
            this.metrics.errors++;
            pending.reject(new Error(packet.payload?.message || 'Request failed'));
          }
        }
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Invoke a service method
   */
  async invoke(
    service: string,
    method: string,
    args: any[],
    options?: {
      context?: RequestContext;
      hints?: RequestHints;
    }
  ): Promise<any> {
    if (!this.isConnected()) {
      throw new ConnectionError('WebSocket is not connected');
    }

    // Create middleware context
    const ctx: ClientMiddlewareContext = {
      service,
      method,
      args,
      request: {
        headers: {},
        timeout: options?.hints?.timeout || this.timeout,
        metadata: options?.context as any,
      },
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'websocket' as const,
    };

    try {
      // Execute pre-request middleware
      await this.middleware.execute(ctx, MiddlewareStage.PRE_REQUEST);

      // Check if middleware wants to skip remaining
      if (ctx.skipRemaining) {
        return ctx.response?.data;
      }

      const id = generateRequestId();
      const timeout = ctx.request?.timeout || this.timeout;

      // Build context with auth headers if available
      const context: RequestContext = {
        ...ctx.request?.metadata,
      };

      // Add middleware headers
      if (ctx.request?.headers) {
        context.headers = {
          ...context.headers,
          ...ctx.request.headers,
        };
      }

      // Add auth headers if client is authenticated (unless overridden by middleware)
      if (this.auth && this.auth.isAuthenticated() && !ctx.request?.headers?.['Authorization']) {
        context.headers = {
          ...context.headers,
          ...this.auth.getAuthHeaders(),
        };
      }

      // Create request packet
      const packet = {
        type: 1, // REQUEST
        id,
        payload: {
          service,
          method,
          args,
          context,
        },
      };

      // Send packet
      this.sendPacket(packet);
      this.metrics.requestsSent++;

      // Wait for response
      const data = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          this.metrics.errors++;
          reject(new TimeoutError(`Request timeout after ${timeout}ms`));
        }, timeout) as unknown as number;

        this.pendingRequests.set(id, {
          resolve,
          reject,
          timeout: timeoutId,
        });
      });

      // Store response in context
      ctx.response = {
        data,
        headers: {},
        metadata: {},
      };

      // Execute post-response middleware
      await this.middleware.execute(ctx, MiddlewareStage.POST_RESPONSE);

      return ctx.response.data;
    } catch (error: any) {
      // Store error in context
      ctx.error = error;

      // Execute error middleware
      try {
        await this.middleware.execute(ctx, MiddlewareStage.ERROR);
      } catch {
        // Ignore middleware errors during error handling
      }

      throw error;
    }
  }

  /**
   * Send a packet through WebSocket
   */
  private sendPacket(packet: any): void {
    if (!this.ws || this.ws.readyState !== 1) {
      // OPEN state
      throw new ConnectionError('WebSocket is not connected');
    }

    // Send as JSON (simplified - in real implementation, use MessagePack)
    this.ws.send(JSON.stringify(packet));
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
      if (
        this.ws.readyState === 1 || // OPEN
        this.ws.readyState === 0 // CONNECTING
      ) {
        this.ws.close(1000, 'Manual disconnect');
      }
      this.ws = null;
    }

    this.state = 'disconnected' as ConnectionState;
    this.disconnectedAt = Date.now();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === 1; // OPEN state
  }

  /**
   * Get connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Attempt to reconnect to the server
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect-failed');
      return;
    }

    this.state = 'reconnecting' as ConnectionState;
    this.reconnectAttempts++;
    const delay = calculateBackoff(this.reconnectAttempts, this.reconnectInterval);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnect');
      } catch (error) {
        // Will trigger another reconnect attempt via close event
      }
    }, delay) as unknown as number;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    const avgLatency =
      this.metrics.latencies.length > 0
        ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
        : undefined;

    return {
      id: 'ws-client',
      url: this.wsUrl,
      state: this.state,
      transport: 'websocket',
      connectedAt: this.connectedAt,
      disconnectedAt: this.disconnectedAt,
      requestsSent: this.metrics.requestsSent,
      responsesReceived: this.metrics.responsesReceived,
      errors: this.metrics.errors,
      avgLatency,
    };
  }

  /**
   * Get middleware manager
   */
  getMiddleware(): IMiddlewareManager {
    return this.middleware;
  }

  /**
   * Use middleware
   */
  use(middleware: MiddlewareFunction, config?: Partial<MiddlewareConfig>, stage?: MiddlewareStage): this {
    this.middleware.use(middleware, config, stage);
    return this;
  }
}
