/**
 * HttpRemotePeer - Native HTTP implementation without packet protocol
 *
 * This peer implementation uses native HTTP JSON messages instead of
 * binary packet encoding, providing better performance and compatibility
 * with standard HTTP tools.
 */

import { EventEmitter } from 'events';
import { AbstractPeer } from '../../abstract-peer.js';
import type { INetron } from '../../types.js';
import type { ITransportConnection, TransportOptions } from '../types.js';
import type { ILogger } from '../../logger.js';
import { Definition } from '../../definition.js';
import { TitanError, ErrorCode } from '../../errors.js';
import type {
  EventSubscriber,
} from '../../types.js';
import {
  HttpRequestMessage,
  HttpResponseMessage,
  HttpRequestContext,
  HttpRequestHints,
  HttpResponseHints,
  createRequestMessage
} from './types.js';
import { HttpInterface } from './interface.js';
import { FluentInterface } from './fluent-interface.js';
import { HttpCacheManager } from './cache-manager.js';
import { RetryManager } from './retry-manager.js';
import { HttpTransportClient } from './client.js';
import type { QueryOptions } from './query-builder.js';

/**
 * HttpRemotePeer - Optimized HTTP peer without packet protocol
 *
 * Key improvements:
 * - Direct JSON messaging without binary encoding
 * - Native HTTP error handling
 * - Built-in caching support
 * - Request/response correlation without packets
 * - OpenAPI-compatible message format
 */
export class HttpRemotePeer extends AbstractPeer {
  public logger: ILogger;

  /** Base URL for HTTP requests */
  private baseUrl: string;

  /** HTTP connection */
  private connection: ITransportConnection;

  /** Service definitions cached from discovery */
  public services = new Map<string, Definition>();

  /** Definition cache */
  private definitions = new Map<string, Definition>();

  /** Event emitter for internal events */
  private events = new EventEmitter();

  /** Service names exposed */
  private serviceNames = new Set<string>();

  /** Default request options */
  private defaultOptions: {
    timeout?: number;
    headers?: Record<string, string>;
  } = {};

  /** Request interceptors */
  private requestInterceptors: Array<(req: HttpRequestMessage) => HttpRequestMessage | Promise<HttpRequestMessage>> = [];

  /** Response interceptors */
  private responseInterceptors: Array<(res: HttpResponseMessage) => HttpResponseMessage | Promise<HttpResponseMessage>> = [];

  /** Cache manager for HTTP responses */
  private cacheManager?: HttpCacheManager;

  /** Retry manager for failed requests */
  private retryManager?: RetryManager;

  /** Global query options */
  private globalOptions: QueryOptions = {};

  constructor(connection: ITransportConnection, netron: INetron, baseUrl: string, options?: TransportOptions) {
    // Generate a deterministic ID based on the URL
    const id = `http-direct-${new URL(baseUrl).host}`;
    super(netron, id);

    this.connection = connection;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.logger = netron.logger.child({ component: 'HttpRemotePeer', baseUrl });

    // Set default options
    this.defaultOptions = {
      timeout: options?.requestTimeout || 30000,
      headers: options?.headers || {}
    };
  }

  /**
   * Initialize the HTTP peer
   * Phase 7: Removed pre-fetch service discovery in favor of lazy loading via queryInterfaceRemote()
   * Phase 8: Added support for legacyAbilitiesExchange flag
   */
  async init(isClient: boolean, _options?: TransportOptions): Promise<void> {
    this.logger.debug('Initializing HTTP Remote peer');

    if (isClient) {
      // Modern auth-aware on-demand service discovery
      this.logger.debug('HTTP peer initialized in client mode - using auth-aware on-demand service discovery');
      this.logger.debug(
        'Services will be discovered on-demand via queryInterfaceRemote(). ' +
        'Use POST /netron/authenticate for user authentication and ' +
        'POST /netron/query-interface for auth-aware service discovery.'
      );
    }
  }

  /**
   * Set a property value on the remote peer
   */
  override async set(defId: string, name: string, value: any): Promise<void> {
    const service = this.getServiceNameFromDefId(defId);
    const message = createRequestMessage(service, `__setProperty`, { name, value });

    const response = await this.sendRequestMessage(message);

    if (!response.success) {
      throw this.createErrorFromResponse(response);
    }
  }

  /**
   * Get a property value from the remote peer
   */
  override async get(defId: string, name: string): Promise<any> {
    const service = this.getServiceNameFromDefId(defId);
    const message = createRequestMessage(service, `__getProperty`, { name });

    const response = await this.sendRequestMessage(message);

    if (!response.success) {
      throw this.createErrorFromResponse(response);
    }

    return response.data;
  }

  /**
   * Call a method on the remote peer
   */
  override async call(defId: string, method: string, args: any[]): Promise<any> {
    const service = this.getServiceNameFromDefId(defId);
    const message = createRequestMessage(
      service,
      method,
      args, // Pass all arguments as array
      {
        context: this.buildRequestContext(),
        hints: this.buildRequestHints()
      }
    );

    const response = await this.sendRequestMessage(message);

    if (!response.success) {
      throw this.createErrorFromResponse(response);
    }

    // Handle cache hints from response
    if (response.hints?.cache) {
      this.handleCacheHints(service, method, args[0], response.data, response.hints.cache);
    }

    return response.data;
  }

  /**
   * Subscribe to events (requires WebSocket upgrade)
   */
  override async subscribe(eventName: string, _handler: EventSubscriber): Promise<void> {
    this.logger.warn({ eventName }, 'Event subscription requires WebSocket upgrade, falling back to polling');

    // TODO: Implement WebSocket upgrade or SSE for real-time events
    // For now, we can implement polling as a fallback
  }

  /**
   * Unsubscribe from events
   */
  override async unsubscribe(_eventName: string, _handler: EventSubscriber): Promise<void> {
    // No-op for now
  }

  /**
   * Expose a service (not supported for HTTP client)
   */
  override async exposeService(_instance: any): Promise<Definition> {
    throw new Error('Service exposure not supported from HTTP client');
  }

  /**
   * Unexpose a service (not supported for HTTP client)
   */
  override async unexposeService(_ctxId: string, _releaseOriginated?: boolean): Promise<void> {
    // No-op for HTTP client
  }

  /**
   * Get service names
   */
  override getServiceNames(): string[] {
    return Array.from(this.serviceNames);
  }

  /**
   * Invalidate definition cache for services matching a pattern
   * @override
   */
  override invalidateDefinitionCache(pattern?: string): number {
    // Call parent implementation to invalidate definition cache
    const parentCount = super.invalidateDefinitionCache(pattern);

    if (!pattern) {
      // Clear all services and definitions
      const totalCount = this.services.size + this.definitions.size;
      this.services.clear();
      this.definitions.clear();
      return parentCount + totalCount;
    }

    // Pattern matching - remove matching services and definitions
    const servicesToDelete: string[] = [];
    const definitionsToDelete: string[] = [];

    // Find matching services
    for (const key of this.services.keys()) {
      if (this.matchServicePattern(key, pattern)) {
        servicesToDelete.push(key);
        const def = this.services.get(key);
        if (def) {
          definitionsToDelete.push(def.id);
        }
      }
    }

    // Delete matched services
    for (const key of servicesToDelete) {
      this.services.delete(key);
    }

    // Delete matched definitions
    for (const id of definitionsToDelete) {
      this.definitions.delete(id);
    }

    // Return total count of invalidated items
    return parentCount + servicesToDelete.length + definitionsToDelete.length;
  }

  /**
   * Pattern matching helper for HTTP peer
   * @private
   */
  private matchServicePattern(serviceName: string, pattern: string): boolean {
    if (serviceName === pattern) return true;
    if (!pattern.includes('*')) return false;

    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(serviceName);
  }

  /**
   * Execute a task on the remote peer
   */
  async executeTask<T = any>(task: string, payload: any): Promise<T> {
    const message = createRequestMessage('__system', task, payload);
    const response = await this.sendRequestMessage(message);

    if (!response.success) {
      throw this.createErrorFromResponse(response);
    }

    return response.data as T;
  }

  /**
   * Send HTTP request message
   */
  private async sendRequestMessage(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    // Apply request interceptors
    let processedMessage = message;
    for (const interceptor of this.requestInterceptors) {
      processedMessage = await interceptor(processedMessage);
    }

    const response = await this.sendHttpRequest<HttpResponseMessage>(
      'POST',
      '/netron/invoke',
      processedMessage
    );

    // Apply response interceptors
    let processedResponse = response;
    for (const interceptor of this.responseInterceptors) {
      processedResponse = await interceptor(processedResponse);
    }

    return processedResponse;
  }

  /**
   * Send HTTP request
   */
  private async sendHttpRequest<T>(
    method: string,
    path: string,
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Netron-Version': '2.0',
      ...this.defaultOptions.headers
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.defaultOptions.timeout!
    );

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          if (errorData.error) {
            throw new TitanError({
              code: (typeof errorData.error.code === 'number' ? errorData.error.code : ErrorCode.INTERNAL_ERROR) as ErrorCode,
              message: errorData.error.message,
              details: errorData.error.details
            });
          }
        } catch {
          // Fallback to HTTP status error
        }

        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: `HTTP ${response.status}: ${response.statusText}`
        });
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new TitanError({
          code: ErrorCode.REQUEST_TIMEOUT,
          message: `Request timeout after ${this.defaultOptions.timeout}ms`
        });
      }

      throw error;
    }
  }

  /**
   * Create service proxy
   */
  // @ts-expect-error - Unused in browser client
  private _createServiceProxy(definition: Definition): any {
    const self = this;

    return new Proxy({}, {
      get(_target: any, prop: string) {
        // Check if it's a method
        if (definition.meta.methods[prop]) {
          return async (...args: any[]) => self.call(definition.id, prop, args);
        }

        // Check if it's a property
        if (definition.meta.properties && definition.meta.properties[prop]) {
          return self.get(definition.id, prop);
        }

        // Special properties
        if (prop === '$def') {
          return definition;
        }

        if (prop === '$peer') {
          return self;
        }

        // Unknown property
        return undefined;
      },

      set(_target: any, prop: string, value: any) {
        if (definition.meta.properties && definition.meta.properties[prop]) {
          self.set(definition.id, prop, value);
          return true;
        }

        return false;
      }
    });
  }

  /**
   * Build request context
   */
  private buildRequestContext(): HttpRequestContext {
    return {
      // TODO: Add tracing, user context, etc.
    };
  }

  /**
   * Build request hints
   */
  private buildRequestHints(): HttpRequestHints {
    return {
      // TODO: Add caching, retry hints based on configuration
    };
  }

  /**
   * Handle cache hints from response
   */
  private handleCacheHints(
    service: string,
    method: string,
    _input: any,
    _output: any,
    cacheHints: HttpResponseHints['cache']
  ): void {
    // TODO: Implement cache storage based on hints
    this.logger.debug({ service, method, cacheHints }, 'Received cache hints');
  }

  /**
   * Get service name from definition ID
   */
  private getServiceNameFromDefId(defId: string): string {
    const definition = this.definitions.get(defId);
    if (!definition) {
      // Try to extract from defId
      const parts = defId.split('-');
      return parts[0] || 'unknown';
    }
    return definition.meta.name;
  }

  /**
   * Create error from response
   */
  private createErrorFromResponse(response: HttpResponseMessage): Error {
    if (response.error) {
      return new TitanError({
        code: (typeof response.error.code === 'string' ? parseInt(response.error.code, 10) : response.error.code || ErrorCode.INTERNAL_ERROR) as unknown as ErrorCode,
        message: response.error.message,
        details: response.error.details
      });
    }

    return new Error('Unknown error');
  }

  /**
   * Add request interceptor
   */
  addRequestInterceptor(
    interceptor: (req: HttpRequestMessage) => HttpRequestMessage | Promise<HttpRequestMessage>
  ): void {
    this.requestInterceptors.push(interceptor);
  }

  /**
   * Add response interceptor
   */
  addResponseInterceptor(
    interceptor: (res: HttpResponseMessage) => HttpResponseMessage | Promise<HttpResponseMessage>
  ): void {
    this.responseInterceptors.push(interceptor);
  }

  /**
   * Emit event to the peer's event emitter
   */
  emit(event: string | symbol, ...args: any[]): boolean {
    return this.events.emit(event, ...args);
  }

  /**
   * Close the peer connection
   */
  async close(): Promise<void> {
    this.logger.debug('Closing HTTP Remote peer connection');

    // Clear caches
    this.interfaces.clear();
    this.services.clear();
    this.definitions.clear();

    // Close the underlying connection
    if (this.connection && typeof this.connection.close === 'function') {
      await this.connection.close();
    }

    this.emit('disconnect');
  }

  /**
   * Check if peer is connected
   */
  get isConnected(): boolean {
    // HTTP connections are considered "connected" as long as the peer exists
    return true;
  }

  /**
   * Release interface internal
   */
  protected async releaseInterfaceInternal(_iInstance: any): Promise<void> {
    // No-op for HTTP - interfaces are stateless
  }

  /**
   * Get definition by ID
   */
  protected getDefinitionById(defId: string): Definition {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Definition ${defId} not found`);
    }
    return def;
  }

  /**
   * Get definition by service name
   */
  protected getDefinitionByServiceName(name: string): Definition {
    const def = this.services.get(name);
    if (!def) {
      throw new Error(`Service ${name} not found`);
    }
    return def;
  }

  /**
   * Queries the remote peer for a service definition via HTTP endpoint.
   * This method will use the POST /netron/query-interface endpoint.
   *
   * @param {string} qualifiedName - Service name with version (name@version)
   * @returns {Promise<Definition>} Resolves with the service definition
   * @throws {TitanError} If the service is not found or access is denied
   * @protected
   */
  protected async queryInterfaceRemote(qualifiedName: string): Promise<Definition> {
    this.logger.debug({ serviceName: qualifiedName }, 'Querying remote interface via HTTP');

    try {
      // Make HTTP POST request to /netron/query-interface endpoint
      const response = await this.sendHttpRequest<HttpResponseMessage>(
        'POST',
        '/netron/query-interface',
        { serviceName: qualifiedName }
      );

      // Server returns HTTP Response Message format (v2.0) with data field containing ServiceMetadata
      const definitionMeta = response.data;

      if (!definitionMeta) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Service '${qualifiedName}' not found on remote peer`
        });
      }

      // Create a Definition object from the metadata
      const definition = new Definition(
        Definition.nextId(),
        this.id,
        definitionMeta
      );

      // Store the definition in local maps for future reference
      this.definitions.set(definition.id, definition);
      const serviceKey = `${definition.meta.name}@${definition.meta.version}`;
      this.services.set(serviceKey, definition);

      this.logger.info(
        {
          serviceName: qualifiedName,
          definitionId: definition.id,
          methodCount: Object.keys(definition.meta.methods || {}).length,
        },
        'Remote interface queried successfully via HTTP',
      );

      return definition;
    } catch (error: any) {
      this.logger.error(
        { error, serviceName: qualifiedName },
        'Failed to query remote interface via HTTP'
      );
      throw error;
    }
  }

  /**
   * Query interface for HTTP service (unified RPC API)
   *
   * Overrides AbstractPeer.queryInterface() to return standard HttpInterface
   * for simple RPC functionality compatible with other transports.
   *
   * For advanced HTTP features (caching, retry, etc.), use queryFluentInterface().
   *
   * @template TService - Service interface type
   * @param qualifiedName - Fully qualified service name (e.g., "UserService@1.0.0")
   * @returns HttpInterface with standard RPC API
   *
   * @example
   * ```typescript
   * // Unified API - same as other transports (WebSocket, TCP, Unix)
   * const userService = await peer.queryInterface<IUserService>('UserService@1.0.0');
   *
   * // Simple RPC method calls
   * const user = await userService.getUser('user-123');
   * const users = await userService.listUsers({ page: 1, limit: 10 });
   * ```
   *
   * @override
   */
  override async queryInterface<TService = any>(qualifiedName: string): Promise<TService> {
    // Get or fetch service definition
    const definition = await this.queryInterfaceRemote(qualifiedName);

    // Get or create HTTP transport client
    const transport = this.getOrCreateHttpClient();

    // Create HttpInterface (simple RPC)
    const httpInterface = new HttpInterface<TService>(transport, definition);

    // Set peer reference for compatibility
    httpInterface.$peer = this as any;

    // Store in interfaces cache for reference counting
    const iInfo = { instance: httpInterface as any, refCount: 1 };
    this.interfaces.set(definition.id, iInfo);

    return httpInterface as any as TService;
  }

  /**
   * Query fluent interface for HTTP service (advanced HTTP API)
   *
   * Returns FluentInterface with advanced HTTP-specific features like caching,
   * retry logic, optimistic updates, request deduplication, etc.
   *
   * This is HTTP-transport-specific and not available in other transports.
   *
   * @template TService - Service interface type
   * @param qualifiedName - Fully qualified service name (e.g., "UserService@1.0.0")
   * @returns FluentInterface with advanced HTTP features
   *
   * @example
   * ```typescript
   * const userService = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');
   *
   * // Advanced HTTP features
   * const user = await userService.cache(60000).retry(3).getUser('user-123');
   * const users = await userService.priority('high').timeout(5000).listUsers();
   * ```
   */
  async queryFluentInterface<TService = any>(qualifiedName: string): Promise<FluentInterface<TService>> {
    // Get or fetch service definition
    const definition = await this.queryInterfaceRemote(qualifiedName);

    // Get or create HTTP transport client
    const transport = this.getOrCreateHttpClient();

    // Create FluentInterface with peer's managers and global options
    const fluentInterface = new FluentInterface<TService>(
      transport,
      definition,
      this.cacheManager,
      this.retryManager,
      this.globalOptions
    );

    // Set peer reference for compatibility
    fluentInterface.$peer = this;

    // Store in interfaces cache for reference counting
    const iInfo = { instance: fluentInterface as any, refCount: 1 };
    this.interfaces.set(definition.id, iInfo);

    return fluentInterface;
  }

  /**
   * Get or create HTTP transport client for this peer
   */
  private getOrCreateHttpClient(): HttpTransportClient {
    // Create a new HttpTransportClient with the base URL
    return new HttpTransportClient(this.baseUrl);
  }

  /**
   * Set cache manager for all interfaces created by this peer
   *
   * @param manager - HttpCacheManager instance
   * @returns this for method chaining
   *
   * @example
   * ```typescript
   * peer.setCacheManager(new HttpCacheManager({ maxEntries: 1000 }));
   * const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');
   * // service will use the configured cache manager
   * ```
   */
  setCacheManager(manager: HttpCacheManager): this {
    this.cacheManager = manager;
    return this;
  }

  /**
   * Set retry manager for all interfaces created by this peer
   *
   * @param manager - RetryManager instance
   * @returns this for method chaining
   *
   * @example
   * ```typescript
   * peer.setRetryManager(new RetryManager({ maxAttempts: 5 }));
   * const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');
   * // service will use the configured retry manager
   * ```
   */
  setRetryManager(manager: RetryManager): this {
    this.retryManager = manager;
    return this;
  }

  /**
   * Set global query options for all interfaces created by this peer
   *
   * @param options - Global query options
   * @returns this for method chaining
   *
   * @example
   * ```typescript
   * peer.setGlobalOptions({
   *   cache: { maxAge: 60000 },
   *   retry: { attempts: 3 }
   * });
   * const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');
   * // service will use the global options by default
   * ```
   */
  setGlobalOptions(options: QueryOptions): this {
    this.globalOptions = options;
    return this;
  }

  /**
   * Get cache manager instance
   */
  getCacheManager(): HttpCacheManager | undefined {
    return this.cacheManager;
  }

  /**
   * Get retry manager instance
   */
  getRetryManager(): RetryManager | undefined {
    return this.retryManager;
  }

  /**
   * Get global query options
   */
  getGlobalOptions(): QueryOptions {
    return this.globalOptions;
  }
}