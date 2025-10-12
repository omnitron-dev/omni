/**
 * WebSocket Peer for Browser
 *
 * Browser-compatible WebSocket peer implementation.
 * Provides service discovery and RPC communication over WebSocket.
 */

import { AbstractPeer } from '../../core/abstract-peer.js';
import type { EventSubscriber } from '../../core/types.js';
import { Definition } from '../../core/definition.js';
import { NetronErrors } from '../../errors/index.js';
import { WebSocketConnection, type WebSocketConnectionOptions, ConnectionState } from './connection.js';
import { Packet, TYPE_GET, TYPE_SET, TYPE_CALL, TYPE_TASK } from '../../packet/index.js';

/**
 * Simple logger interface for browser console
 */
interface IBrowserLogger {
  debug(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  info(...args: any[]): void;
}

/**
 * Create a simple console-based logger
 */
function createConsoleLogger(component: string, url: string): IBrowserLogger {
  const prefix = `[${component}] [${url}]`;
  return {
    debug: (...args: any[]) => console.debug(prefix, ...args),
    warn: (...args: any[]) => console.warn(prefix, ...args),
    error: (...args: any[]) => console.error(prefix, ...args),
    info: (...args: any[]) => console.info(prefix, ...args),
  };
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: number;
}

/**
 * WebSocket peer options
 */
export interface WebSocketPeerOptions extends WebSocketConnectionOptions {
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * WebSocket Peer implementation for browser
 *
 * Provides:
 * - Service discovery via WebSocket
 * - RPC method invocation
 * - Event subscriptions
 * - Automatic reconnection with exponential backoff
 * - Message queueing during disconnection
 * - Keep-alive mechanism
 */
export class WebSocketPeer extends AbstractPeer {
  public logger: IBrowserLogger;

  private connection: WebSocketConnection;
  private requestTimeout: number;
  private pendingRequests = new Map<number, PendingRequest>();
  private services = new Map<string, Definition>();
  private serviceNames = new Set<string>();
  private eventSubscriptions = new Map<string, Set<EventSubscriber>>();

  constructor(url: string, options?: WebSocketPeerOptions) {
    const id = `ws-peer-${new URL(url).host}`;
    super(id);

    this.logger = createConsoleLogger('WebSocketPeer', url);
    this.requestTimeout = options?.requestTimeout || 30000;

    // Create WebSocket connection
    this.connection = new WebSocketConnection(url, options);

    // Setup connection event handlers
    this.setupConnectionHandlers();
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    this.connection.on('connect', () => {
      this.logger.info('WebSocket connected');
    });

    this.connection.on('disconnect', ({ code, reason }: { code: number; reason: string }) => {
      this.logger.warn('WebSocket disconnected', { code, reason });

      // Reject all pending requests
      for (const [, pending] of this.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(NetronErrors.connectionClosed('websocket', reason));
      }
      this.pendingRequests.clear();
    });

    this.connection.on('error', (error: Error) => {
      this.logger.error('WebSocket error', error);
    });

    this.connection.on('packet', (packet: Packet) => {
      this.handlePacket(packet);
    });

    this.connection.on('reconnecting', ({ attempt, delay }: { attempt: number; delay: number }) => {
      this.logger.info(`Reconnecting... attempt ${attempt}, delay ${delay}ms`);
    });

    this.connection.on('reconnect', (attempts: number) => {
      this.logger.info(`Reconnected after ${attempts} attempts`);
    });

    this.connection.on('reconnect-failed', (attempts: number) => {
      this.logger.error(`Reconnection failed after ${attempts} attempts`);
    });
  }

  /**
   * Handle incoming packet
   */
  private handlePacket(packet: Packet): void {
    // Check if this is a response to a pending request
    if (packet.getImpulse() === 0) {
      // Response packet
      const pending = this.pendingRequests.get(packet.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(packet.id);

        if (packet.getError()) {
          // Error response
          pending.reject(new Error(packet.data?.message || 'Request failed'));
        } else {
          // Success response
          pending.resolve(packet.data);
        }
      }
    }
  }

  /**
   * Connect to WebSocket server
   */
  async connect(): Promise<void> {
    await this.connection.connect();
  }

  /**
   * Initialize the WebSocket peer
   */
  async init(): Promise<void> {
    this.logger.debug('Initializing WebSocket peer');
    await this.connect();
    this.logger.info('WebSocket peer initialized');
  }

  /**
   * Send a request and wait for response
   */
  private async sendRequest(packet: Packet, timeout?: number): Promise<any> {
    if (!this.connection.isConnected) {
      throw NetronErrors.connectionClosed('websocket', 'WebSocket is not connected');
    }

    const requestTimeout = timeout || this.requestTimeout;

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRequests.delete(packet.id);
        reject(NetronErrors.connectionTimeout('websocket', this.connection.url));
      }, requestTimeout);

      this.pendingRequests.set(packet.id, {
        resolve,
        reject,
        timeout: timeoutId,
      });

      this.connection.send(packet).catch((error) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(packet.id);
        reject(error);
      });
    });
  }

  /**
   * Set a property value on the remote peer
   */
  override async set(defId: string, name: string, value: any): Promise<void> {
    const packet = new Packet(Packet.nextId());
    packet.setImpulse(1); // Request
    packet.setType(TYPE_SET);
    packet.data = { defId, name, value };

    await this.sendRequest(packet);
  }

  /**
   * Get a property value from the remote peer
   */
  override async get(defId: string, name: string): Promise<any> {
    const packet = new Packet(Packet.nextId());
    packet.setImpulse(1); // Request
    packet.setType(TYPE_GET);
    packet.data = { defId, name };

    return await this.sendRequest(packet);
  }

  /**
   * Call a method on the remote peer
   */
  override async call(defId: string, method: string, args: any[]): Promise<any> {
    const packet = new Packet(Packet.nextId());
    packet.setImpulse(1); // Request
    packet.setType(TYPE_CALL);
    packet.data = { defId, method, args };

    return await this.sendRequest(packet);
  }

  /**
   * Subscribe to an event
   */
  override async subscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    let handlers = this.eventSubscriptions.get(eventName);
    if (!handlers) {
      handlers = new Set();
      this.eventSubscriptions.set(eventName, handlers);

      // Send subscription request to server
      const packet = new Packet(Packet.nextId());
      packet.setImpulse(1); // Request
      packet.setType(TYPE_TASK);
      packet.data = { task: 'subscribe', eventName };

      await this.sendRequest(packet);
    }

    handlers.add(handler);
  }

  /**
   * Unsubscribe from an event
   */
  override async unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    const handlers = this.eventSubscriptions.get(eventName);
    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    if (handlers.size === 0) {
      this.eventSubscriptions.delete(eventName);

      // Send unsubscription request to server
      const packet = new Packet(Packet.nextId());
      packet.setImpulse(1); // Request
      packet.setType(TYPE_TASK);
      packet.data = { task: 'unsubscribe', eventName };

      await this.sendRequest(packet);
    }
  }

  /**
   * Query interface from remote peer (auth-aware)
   *
   * This method now uses the enhanced query-interface core-task which supports:
   * - Authorization-aware service discovery
   * - Filtered method lists based on permissions
   * - Wildcard version resolution (e.g., 'user' → 'user@1.0.0')
   * - Latest version selection
   *
   * The server will return filtered definitions based on the authenticated user's
   * permissions, hiding methods the user doesn't have access to.
   */
  protected override async queryInterfaceRemote(qualifiedName: string): Promise<Definition> {
    const packet = new Packet(Packet.nextId());
    packet.setImpulse(1); // Request
    packet.setType(TYPE_TASK);
    packet.data = {
      task: 'query_interface',
      serviceName: qualifiedName,
    };

    const result = await this.sendRequest(packet);

    // Handle both old and new response formats for backward compatibility
    const definition = result.definition || result;

    if (!definition) {
      throw NetronErrors.serviceNotFound(qualifiedName);
    }

    // Extract resolved name if provided (useful for wildcard queries)
    const resolvedName = result.resolvedName || qualifiedName;

    // Check if definition was filtered by server
    const isFiltered = result.filtered === true;

    if (isFiltered) {
      this.logger.debug(`Received filtered definition for '${resolvedName}' based on user permissions`);
    }

    // Create Definition from result
    const def = new Definition(
      definition.id,
      definition.peerId || this.id,
      definition.meta || {
        name: definition.name || qualifiedName,
        version: definition.version || '1.0.0',
        methods: definition.methods || {},
        properties: definition.properties || {},
      }
    );

    // Cache the definition using both original and resolved names
    this.services.set(qualifiedName, def);
    this.serviceNames.add(qualifiedName);

    if (resolvedName !== qualifiedName) {
      this.services.set(resolvedName, def);
      this.serviceNames.add(resolvedName);
      this.logger.debug(`Resolved '${qualifiedName}' to '${resolvedName}'`);
    }

    return def;
  }

  /**
   * Get definition by ID
   */
  protected override getDefinitionById(defId: string): Definition {
    for (const def of this.services.values()) {
      if (def.id === defId) {
        return def;
      }
    }
    throw NetronErrors.serviceNotFound(defId);
  }

  /**
   * Get definition by service name
   */
  protected override getDefinitionByServiceName(name: string): Definition {
    const def = this.services.get(name);
    if (!def) {
      throw NetronErrors.serviceNotFound(name);
    }
    return def;
  }

  /**
   * Get service names
   */
  protected override getServiceNames(): string[] {
    return Array.from(this.serviceNames);
  }

  /**
   * Release interface internal
   */
  protected async releaseInterfaceInternal(_iInstance: any): Promise<void> {
    // No-op for WebSocket - interfaces are stateless
  }

  /**
   * Close the peer connection
   */
  async close(): Promise<void> {
    this.logger.debug('Closing WebSocket peer connection');

    // Clear caches
    this.interfaces.clear();
    this.services.clear();
    this.serviceNames.clear();
    this.eventSubscriptions.clear();

    // Close connection
    await this.connection.close();
  }

  /**
   * Check if peer is connected
   */
  get isConnected(): boolean {
    return this.connection.isConnected;
  }

  /**
   * Ping the server
   */
  async ping(): Promise<number> {
    return await this.connection.ping();
  }

  /**
   * Get connection state
   */
  get connectionState(): ConnectionState {
    return this.connection.state;
  }

  /**
   * Get connection metrics
   */
  getMetrics() {
    return this.connection.getMetrics();
  }

  /**
   * Reconnect to the server
   */
  async reconnect(): Promise<void> {
    await this.connection.reconnect();
  }

  /**
   * Invalidate cache entries matching a pattern
   *
   * For WebSocket transport, this invalidates the service definition cache.
   * Can also send a cache invalidation request to the server.
   *
   * @param pattern - Service name pattern (supports * wildcard). If not provided, clears all cache.
   * @param serverSide - If true, also requests server-side cache invalidation
   * @returns Number of cache entries invalidated locally
   *
   * @example
   * // Clear all local cache
   * const count = await peer.invalidateCache();
   *
   * @example
   * // Clear specific service locally
   * const count = await peer.invalidateCache('UserService@1.0.0');
   *
   * @example
   * // Clear all services starting with "User" on both client and server
   * const count = await peer.invalidateCache('User*', true);
   */
  async invalidateCache(pattern?: string, serverSide: boolean = false): Promise<number> {
    let localCount = 0;

    // Invalidate local service definition cache
    localCount = this.invalidateDefinitionCache(pattern);

    this.logger.info(
      `Invalidated ${localCount} service definition cache entries` + (pattern ? ` matching pattern: ${pattern}` : '')
    );

    // Request server-side invalidation if requested
    if (serverSide && this.connection.isConnected) {
      try {
        const packet = new Packet(Packet.nextId());
        packet.setImpulse(1); // Request
        packet.setType(TYPE_TASK);
        packet.data = {
          task: 'invalidate_cache',
          pattern,
        };

        const response = await this.sendRequest(packet);

        if (response && typeof response.count === 'number') {
          this.logger.info(
            `Server invalidated ${response.count} cache entries` + (pattern ? ` matching pattern: ${pattern}` : '')
          );
        }
      } catch (error) {
        this.logger.warn('Failed to invalidate server-side cache:', error);
        // Don't throw - local invalidation succeeded
      }
    }

    return localCount;
  }
}
