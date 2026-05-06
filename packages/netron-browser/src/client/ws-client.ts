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
   * Pre-populated `serviceName -> definitionId` map.
   *
   * Use this when the caller already knows the server's defIds for the
   * services it intends to invoke — for example, ahead-of-time deployments
   * with a fixed service catalog or tests that mint defIds via a shared
   * fixture. Entries here always take precedence over discovery, even
   * when `enableServiceDiscovery` is on.
   */
  serviceDefinitions?: Map<string, string>;

  /**
   * Enable transparent service discovery via the server's `query_interface`
   * core-task.
   *
   * Off by default. When off, `invoke('foo@1.0.0', ...)` sends the bare
   * qualified service name as the wire defId; this only works against
   * peers that match by qualified name. With auto-discovery off,
   * applications either provide an explicit `serviceDefinitions` map or
   * call {@link WebSocketClient.discoverService} ahead of time.
   *
   * Why opt-in: probing the catalog of an arbitrary remote endpoint is a
   * deliberate trust decision. Browser clients in particular often want
   * to talk only to a curated set of known services and never query for
   * others — leaving this off makes that the default.
   *
   * @default false
   */
  enableServiceDiscovery?: boolean;
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
  private enableServiceDiscovery: boolean;
  /**
   * Cache of `serviceName -> definitionId` populated from the server's
   * `query_interface` core-task. Cleared on every (re)connect since defIds
   * are rebuilt on the server side.
   */
  private discoveredDefinitions = new Map<string, string>();
  /**
   * Coalesces concurrent `invoke()` calls for the same service so we issue
   * exactly one `query_interface` round-trip per service per connection.
   */
  private pendingDiscoveries = new Map<string, Promise<string>>();
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
    this.enableServiceDiscovery = options.enableServiceDiscovery === true;
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
        // defIds are minted per-server-process. Always start a fresh
        // discovery cache for each (re)connection so a server restart
        // can't leave stale ids in the map.
        this.discoveredDefinitions.clear();
        this.pendingDiscoveries.clear();
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

      // Resolve service name → definition id. Discovery is the default
      // (transparent query_interface round-trip on first use, cached
      // thereafter); explicit serviceDefinitions or
      // disableServiceDiscovery suppress it for advanced callers.
      let defId = await this.resolveDefinitionId(service);

      const sendCallWithDefId = async (currentDefId: string): Promise<unknown> => {
        const packet = new Packet(packetId);
        packet.setType(TYPE_CALL);
        packet.setImpulse(1); // Request
        // Server expects: [defId, method, ...args]
        packet.data = [currentDefId, method, ...args];

        this.sendPacket(packet);
        this.metrics.requestsSent++;

        return new Promise((resolve, reject) => {
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
      };

      let data: unknown;
      try {
        data = await sendCallWithDefId(defId);
      } catch (err: any) {
        // Stale-defId recovery: if the cached id no longer maps to a
        // definition (e.g. the server was restarted, or the service was
        // re-exposed), evict the cache entry and retry once with a fresh
        // discovery. We do not retry when the caller pre-populated the
        // serviceDefinitions map — that is treated as authoritative.
        const looksLikeStaleDef =
          this.enableServiceDiscovery &&
          this.discoveredDefinitions.get(service) === defId &&
          isLikelyDefinitionNotFoundError(err) &&
          !this.serviceDefinitions?.has(service);

        if (!looksLikeStaleDef) {
          throw err;
        }
        this.discoveredDefinitions.delete(service);
        // Re-resolve and re-send under a fresh packet id.
        defId = await this.resolveDefinitionId(service);
        const retryId = Packet.nextId();
        const packet = new Packet(retryId);
        packet.setType(TYPE_CALL);
        packet.setImpulse(1);
        packet.data = [defId, method, ...args];

        data = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            this.pendingRequests.delete(String(retryId));
            this.metrics.errors++;
            reject(new TimeoutError(`Request timeout after ${timeout}ms`));
          }, timeout) as unknown as number;

          this.pendingRequests.set(String(retryId), {
            resolve,
            reject,
            timeout: timeoutId,
          });

          this.sendPacket(packet);
          this.metrics.requestsSent++;
        });
      }

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
   * Invoke a Netron core-task on the connected server.
   *
   * Core-tasks are out-of-band RPCs that operate on the server's Netron
   * instance itself (service catalog, authentication, cache invalidation,
   * pub/sub subscription, etc.) — they don't target any user-defined
   * service. The server dispatches by task name through its
   * {@link import('@omnitron-dev/titan/netron').TaskManager TaskManager}.
   *
   * Used internally for transparent service discovery, but exposed because
   * the same primitive is genuinely useful for client code (`authenticate`,
   * `invalidate_cache`, `subscribe`).
   *
   * @param name - Registered task name on the server.
   * @param args - Positional arguments forwarded to the task handler.
   * @returns The decoded task result.
   */
  async runTask<T = unknown>(name: string, ...args: any[]): Promise<T> {
    if (!this.isConnected()) {
      throw new ConnectionError('WebSocket is not connected');
    }
    const packetId = Packet.nextId();
    const packet = new Packet(packetId);
    packet.setType(TYPE_TASK);
    packet.setImpulse(1); // request
    packet.data = [name, ...args];

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(String(packetId));
        reject(new TimeoutError(`runTask('${name}') timed out after ${this.timeout}ms`));
      }, this.timeout) as unknown as number;

      this.pendingRequests.set(String(packetId), {
        resolve: resolve as (v: any) => void,
        reject,
        timeout: timeoutId,
      });

      try {
        this.sendPacket(packet);
        this.metrics.requestsSent++;
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(String(packetId));
        reject(err as Error);
      }
    });
  }

  /**
   * Look up the wire-level definition id for a service.
   *
   * Resolution order (the first hit wins):
   *   1. Caller-supplied `serviceDefinitions` map — always authoritative.
   *   2. Local discovery cache populated from previous lookups.
   *   3. The server's `query_interface` core-task, *only* when
   *      `enableServiceDiscovery` is on. Concurrent lookups for the same
   *      service share one in-flight promise so the round-trip happens
   *      once per (service, connection) pair.
   *
   * When discovery is off and the service is not in the explicit map, we
   * fall back to passing the bare qualified name as the defId — that is
   * the no-discovery path and matches peers that route by service name.
   */
  private resolveDefinitionId(service: string): Promise<string> {
    const explicit = this.serviceDefinitions?.get(service);
    if (explicit) return Promise.resolve(explicit);

    const cached = this.discoveredDefinitions.get(service);
    if (cached) return Promise.resolve(cached);

    if (!this.enableServiceDiscovery) return Promise.resolve(service);

    const inFlight = this.pendingDiscoveries.get(service);
    if (inFlight) return inFlight;

    const promise = (async () => {
      // The server-side query_interface task returns a Definition (decoded
      // by the registered msgpack handler on the netron-browser serializer).
      const def = (await this.runTask<{ id?: string } | null>('query_interface', service)) ?? null;
      if (!def || typeof def.id !== 'string') {
        throw new ConnectionError(
          `query_interface('${service}') returned an unexpected payload — server did not yield a definition id.`
        );
      }
      this.discoveredDefinitions.set(service, def.id);
      return def.id;
    })().finally(() => {
      this.pendingDiscoveries.delete(service);
    });

    this.pendingDiscoveries.set(service, promise);
    return promise;
  }

  /**
   * Eagerly resolve and cache one or more services via `query_interface`.
   *
   * Useful when discovery is enabled but the caller wants the round-trip
   * to happen up front (e.g. during app boot) rather than lazily on the
   * first `invoke()`. Also usable when `enableServiceDiscovery` is off —
   * in that case this is the explicit way to populate the discovery
   * cache without making auto-probing the default.
   *
   * @returns A map of every service that was resolved.
   */
  async discoverServices(serviceNames: string[]): Promise<Map<string, string>> {
    const resolved = new Map<string, string>();
    await Promise.all(
      serviceNames.map(async (name) => {
        if (this.serviceDefinitions?.has(name)) {
          resolved.set(name, this.serviceDefinitions.get(name)!);
          return;
        }
        const cached = this.discoveredDefinitions.get(name);
        if (cached) {
          resolved.set(name, cached);
          return;
        }
        const def = (await this.runTask<{ id?: string } | null>('query_interface', name)) ?? null;
        if (!def || typeof def.id !== 'string') {
          throw new ConnectionError(
            `query_interface('${name}') returned an unexpected payload — server did not yield a definition id.`
          );
        }
        this.discoveredDefinitions.set(name, def.id);
        resolved.set(name, def.id);
      })
    );
    return resolved;
  }

  /**
   * Drop every cached `serviceName -> defId` entry so the next `invoke()`
   * for each service re-issues a `query_interface` round-trip.
   *
   * Useful when the server has been restarted out-of-band, or when the
   * application knows that exposed services have changed shape (and the
   * old defIds therefore no longer point at the same code).
   */
  clearDiscoveryCache(): void {
    this.discoveredDefinitions.clear();
    this.pendingDiscoveries.clear();
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

/**
 * Heuristic: did this error come from the server failing to find the
 * definition id we sent? Used to decide whether to evict our discovery
 * cache entry and retry once.
 *
 * The server reports such failures through several shapes depending on the
 * codepath (Errors.notFound builds a TitanError, the bare RPC layer can
 * also send a plain string). We look for the canonical payload first,
 * then fall back to substring matching as a last resort — better to retry
 * than to fail on a false negative when discovery is the recovery path.
 */
function isLikelyDefinitionNotFoundError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as any).code;
  const message = ((err as any).message ?? String(err)) as string;
  if (typeof code === 'string') {
    if (code === 'NOT_FOUND' || code === 'DEFINITION_NOT_FOUND') return true;
  }
  if (typeof message === 'string' && message.length > 0) {
    return /Definition.*not\s*found/i.test(message) || /Service.*not\s*found/i.test(message);
  }
  return false;
}
