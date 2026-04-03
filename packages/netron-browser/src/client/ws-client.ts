/**
 * WebSocket Transport Client for Netron Browser
 *
 * Provides WebSocket-based RPC communication with the Netron server
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { ConnectionMetrics, ConnectionState, RequestContext, RequestHints } from '../types/index.js';
import type { AuthenticationClient } from '../auth/client.js';
import { calculateBackoff, httpToWsUrl } from '../utils/index.js';
import { ConnectionError, TimeoutError } from '../errors/index.js';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  type ClientMiddlewareContext,
  type IMiddlewareManager,
  type MiddlewareFunction,
  type MiddlewareConfig,
} from '../middleware/index.js';
import { Packet, encodePacket, decodePacket, TYPE_CALL, TYPE_TASK } from '../packet/index.js';

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

  /**
   * Service definitions map (serviceName -> definitionId)
   * Used to resolve service names to definition IDs for RPC calls
   */
  serviceDefinitions?: Map<string, string>;
}

/**
 * Task handler function for incoming server-initiated calls/tasks.
 * Receives the arguments sent by the server and optionally returns a result.
 */
export type TaskHandler = (...args: any[]) => any | Promise<any>;

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
  private serviceDefinitions?: Map<string, string>;
  private state: ConnectionState = 'disconnected' as ConnectionState;
  private pendingRequests = new Map<string, PendingRequest>();
  private connectedAt?: number;
  private disconnectedAt?: number;
  private taskHandlers = new Map<string, TaskHandler>();
  private handshakeComplete = false;
  /** Server's Netron instance ID, received during handshake */
  public serverId: string | null = null;
  private clientId: string;
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
    this.serviceDefinitions = options.serviceDefinitions;
    this.clientId = crypto.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    // Guard against concurrent connect calls (e.g. visibility + online + auto-reconnect racing)
    if (this.ws && (this.ws.readyState === 0 /* CONNECTING */ || this.ws.readyState === 1) /* OPEN */) {
      return;
    }

    // Cancel any pending reconnect timer — this connect() supersedes it
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    await new Promise<void>((resolve, reject) => {
      try {
        this.isManualDisconnect = false;
        this.handshakeComplete = false;
        this.serverId = null;
        this.state = 'connecting' as ConnectionState;

        // Generate a fresh client ID for each connection attempt.
        // This prevents a race condition where a reconnecting peer reuses the
        // same ID: the server's new peer entry gets overwritten by the old
        // connection's delayed disconnect handler, silently dropping all
        // room subscriptions and breaking event delivery.
        this.clientId = crypto.randomUUID?.() || `browser-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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

        let isResolved = false;

        // Handle connection open
        ws.addEventListener('open', () => {
          this.state = 'connected' as ConnectionState;
          this.connectedAt = Date.now();
          this.reconnectAttempts = 0;
          this.emit('connect');
          isResolved = true;
          resolve();
        });

        // Handle incoming messages
        ws.addEventListener('message', (event: MessageEvent) => {
          this.handleMessage(event.data);
        });

        // Handle errors
        ws.addEventListener('error', (_event) => {
          const error = new ConnectionError('WebSocket error');
          this.state = 'failed' as ConnectionState;
          this.emit('error', error);
          // Only reject if we haven't connected yet
          if (!isResolved) {
            isResolved = true;
            reject(error);
          }
        });

        // Handle close
        ws.addEventListener('close', (event: CloseEvent) => {
          this.disconnectedAt = Date.now();

          // Reject all pending requests
          for (const pending of this.pendingRequests.values()) {
            pending.reject(new ConnectionError('Connection closed'));
            clearTimeout(pending.timeout);
          }
          this.pendingRequests.clear();

          // Attempt reconnection if enabled and not manually disconnected
          if (this.reconnectEnabled && !this.isManualDisconnect) {
            // Set state to reconnecting BEFORE emitting disconnect
            // so listeners know reconnection will follow
            this.state = 'reconnecting' as ConnectionState;
            this.emit('disconnect', event.reason);
            this.attemptReconnect();
          } else {
            this.state = 'disconnected' as ConnectionState;
            this.emit('disconnect', event.reason);
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
      // Handle Netron handshake protocol
      // Server sends { type: 'id', id } as the first frame. It may arrive as
      // a text frame (string) OR a binary frame (ArrayBuffer) depending on
      // how the server serializes it (Buffer.from(JSON.stringify(...)) → binary).
      if (!this.handshakeComplete) {
        let text: string | null = null;
        if (typeof data === 'string') {
          text = data;
        } else if (data instanceof ArrayBuffer && data.byteLength < 512) {
          // Small binary frame during handshake — likely JSON, not MessagePack
          text = new TextDecoder().decode(data);
        }

        if (text) {
          try {
            const msg = JSON.parse(text) as { type: string; id: string };
            if (msg.type === 'id') {
              // Server sent its ID — respond with client ID
              this.serverId = msg.id;
              this.ws?.send(JSON.stringify({ type: 'client-id', id: this.clientId }));
              this.handshakeComplete = true;
              return;
            }
          } catch {
            // Not JSON — fall through to packet decoding
          }
        }
      }

      // Decode MessagePack packet
      const packet = decodePacket(data instanceof ArrayBuffer ? data : new TextEncoder().encode(data));

      this.emit('packet', packet);

      const isRequest = packet.getImpulse() === 1;
      const isResponse = packet.getImpulse() === 0;
      const isError = packet.getError() === 1;

      // Handle response packets (to our outgoing requests)
      if (isResponse || (isError && !isRequest)) {
        const pending = this.pendingRequests.get(String(packet.id));
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(String(packet.id));
          this.metrics.responsesReceived++;

          if (isError) {
            this.metrics.errors++;
            pending.reject(packet.data);
          } else {
            pending.resolve(packet.data);
          }
        }
        return;
      }

      // Handle incoming server-initiated calls/tasks (impulse=1)
      if (isRequest) {
        const packetType = packet.getType();
        if (packetType === TYPE_TASK || packetType === TYPE_CALL) {
          this.handleIncomingTask(packet);
        }
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Handle an incoming task/call from the server.
   * Extracts the task name and arguments, invokes the registered handler,
   * and sends back a response packet.
   */
  private async handleIncomingTask(packet: Packet): Promise<void> {
    const data = Array.isArray(packet.data) ? packet.data : [packet.data];
    const [taskName, ...args] = data;

    const handler = this.taskHandlers.get(taskName);

    if (handler) {
      try {
        const result = await handler(...args);
        this.sendResponse(packet.id, result ?? null, false);
      } catch (error: any) {
        this.sendResponse(packet.id, { message: error?.message ?? 'Task handler error' }, true);
      }
    } else {
      // Emit for generic handling; send empty ack so server doesn't hang
      this.emit('task', taskName, ...args);
      this.sendResponse(packet.id, null, false);
    }
  }

  /**
   * Send a response packet for an incoming request
   */
  private sendResponse(packetId: number, data: any, isError: boolean): void {
    try {
      const response = new Packet(packetId);
      response.setImpulse(0);
      response.setType(TYPE_CALL);
      if (isError) response.setError(1);
      response.data = data;
      this.sendPacket(response);
    } catch {
      // Best-effort: if WS disconnected, silently skip
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

      const packetId = Packet.nextId();
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

      // Resolve service name to definition ID if serviceDefinitions provided
      const defId = this.serviceDefinitions?.get(service) || service;

      // Create request packet
      const packet = new Packet(packetId);
      packet.setType(TYPE_CALL);
      packet.setImpulse(1); // Request
      // Server expects: [defId, method, ...args]
      packet.data = [defId, method, ...args];

      // Send packet
      this.sendPacket(packet);
      this.metrics.requestsSent++;

      // Wait for response
      const data = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.pendingRequests.delete(String(packetId));
          this.metrics.errors++;
          reject(new TimeoutError(`Request timeout after ${timeout}ms`));
        }, timeout) as unknown as number;

        this.pendingRequests.set(String(packetId), {
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
  private sendPacket(packet: Packet): void {
    if (!this.ws || this.ws.readyState !== 1) {
      // OPEN state
      throw new ConnectionError('WebSocket is not connected');
    }

    // Encode packet to MessagePack binary format
    const encoded = encodePacket(packet);
    this.ws.send(encoded);
  }

  /**
   * Register a handler for incoming server-initiated tasks.
   * When the server calls `peer.runTask(name, ...args)`, the handler is invoked
   * with the arguments. The handler's return value (or void) is sent back as the response.
   *
   * @param name - Task name to handle
   * @param handler - Function to execute when the task is received
   */
  onTask(name: string, handler: TaskHandler): this {
    this.taskHandlers.set(name, handler);
    return this;
  }

  /**
   * Remove a registered task handler.
   *
   * @param name - Task name to unregister
   */
  offTask(name: string): this {
    this.taskHandlers.delete(name);
    return this;
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
      this.state = 'failed' as ConnectionState;
      this.emit('reconnect-failed');
      return;
    }

    this.state = 'reconnecting' as ConnectionState;
    this.reconnectAttempts++;
    const delay = calculateBackoff(this.reconnectAttempts, this.reconnectInterval);

    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay, maxAttempts: this.maxReconnectAttempts });

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
        this.emit('reconnect', { attempt: this.reconnectAttempts });
      } catch (_error) {
        // Will trigger another reconnect attempt via close event
      }
    }, delay) as unknown as number;
  }

  /**
   * Get current reconnection attempt count (0 = not reconnecting)
   */
  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Update the WebSocket URL (e.g. for token refresh before reconnection).
   * Takes effect on the next connection attempt.
   */
  setUrl(url: string): void {
    this.wsUrl = url.startsWith('http') ? httpToWsUrl(url) : url;
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
