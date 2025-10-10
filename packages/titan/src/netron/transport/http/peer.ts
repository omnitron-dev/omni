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
import type { ILogger } from '../../../modules/logger/logger.types.js';
import { Definition } from '../../definition.js';
import { TitanError, ErrorCode, NetronErrors, Errors } from '../../../errors/index.js';
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
import { HttpTransportClient } from './client.js';
import { FluentInterface, HttpCacheManager, RetryManager, type QueryOptions } from './fluent-interface/index.js';

/**
 * Definition cache entry with TTL support for HTTP peer
 */
interface CacheEntry {
  definition: Definition;
  timestamp: number;
  ttl: number;
}

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

  /** Definition cache with TTL and JWT scoping (key: userId:serviceName or serviceName) */
  private definitions = new Map<string, CacheEntry>();

  /** Definition cache by defId for method calls (key: defId) */
  private definitionsById = new Map<string, Definition>();

  /** Event emitter for internal events */
  private events = new EventEmitter();

  /** Service names exposed */
  private serviceNames = new Set<string>();

  /** Default request options */
  private defaultOptions: {
    timeout?: number;
    headers?: Record<string, string>;
    definitionCacheTtl?: number;
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
      headers: options?.headers || {},
      definitionCacheTtl: 300000 // 5 minutes default
    };
  }

  /**
   * Initialize the HTTP peer
   * Phase 7: Removed pre-fetch service discovery in favor of lazy loading via queryInterfaceRemote()
   * Phase 8: Added support for legacyAbilitiesExchange flag
   */
  async init(isClient: boolean, options?: TransportOptions): Promise<void> {
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
  override async subscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    this.logger.warn({ eventName }, 'Event subscription requires WebSocket upgrade, falling back to polling');

    // TODO: Implement WebSocket upgrade or SSE for real-time events
    // For now, we can implement polling as a fallback
  }

  /**
   * Unsubscribe from events
   */
  override async unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    // No-op for now
  }

  /**
   * Expose a service (not supported for HTTP client)
   */
  override async exposeService(instance: any): Promise<Definition> {
    throw Errors.notImplemented('Service exposure not supported from HTTP client');
  }

  /**
   * Unexpose a service (not supported for HTTP client)
   */
  override async unexposeService(ctxId: string, releaseOriginated?: boolean): Promise<void> {
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
      const totalCount = this.services.size + this.definitions.size + this.definitionsById.size;
      this.services.clear();
      this.definitions.clear();
      this.definitionsById.clear();
      return parentCount + totalCount;
    }

    // Pattern matching - remove matching services and definitions
    const servicesToDelete: string[] = [];
    const definitionIdsToDelete: string[] = [];

    // Find matching services
    for (const key of this.services.keys()) {
      if (this.matchServicePattern(key, pattern)) {
        servicesToDelete.push(key);
        const def = this.services.get(key);
        if (def) {
          definitionIdsToDelete.push(def.id);
        }
      }
    }

    // Delete matched services
    for (const key of servicesToDelete) {
      this.services.delete(key);
    }

    // Delete matched definitions from JWT-scoped cache
    // Need to iterate all keys and check if they end with the service pattern
    const definitionKeysToDelete: string[] = [];
    for (const cacheKey of this.definitions.keys()) {
      // Cache keys are either "userId:serviceName" or "serviceName"
      const serviceName = cacheKey.includes(':') ? cacheKey.split(':')[1] : cacheKey;
      if (this.matchServicePattern(serviceName, pattern)) {
        definitionKeysToDelete.push(cacheKey);
      }
    }
    for (const key of definitionKeysToDelete) {
      this.definitions.delete(key);
    }

    // Delete matched definitions from defId cache
    for (const id of definitionIdsToDelete) {
      this.definitionsById.delete(id);
    }

    // Return total count of invalidated items
    return parentCount + servicesToDelete.length + definitionKeysToDelete.length + definitionIdsToDelete.length;
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
    this.logger.debug({ message }, '[HTTP Peer] Sending request message');

    // Apply request interceptors
    let processedMessage = message;
    for (const interceptor of this.requestInterceptors) {
      processedMessage = await interceptor(processedMessage);
    }

    this.logger.debug({ processedMessage }, '[HTTP Peer] After interceptors, sending HTTP request');

    const response = await this.sendHttpRequest<HttpResponseMessage>(
      'POST',
      '/netron/invoke',
      processedMessage
    );

    this.logger.debug({ response }, '[HTTP Peer] Received response');

    // Apply response interceptors
    let processedResponse = response;
    for (const interceptor of this.responseInterceptors) {
      processedResponse = await interceptor(processedResponse);
    }

    this.logger.debug({ processedResponse }, '[HTTP Peer] After response interceptors');
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

    this.logger.debug({ url, method, bodyKeys: body ? Object.keys(body) : [] }, '[HTTP Peer] Sending HTTP request');

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

      this.logger.debug({ status: response.status, ok: response.ok }, '[HTTP Peer] Got HTTP response');

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          if (errorData.error) {
            // Extract context headers from response
            const requestId = response.headers.get('X-Request-ID') || undefined;
            const correlationId = response.headers.get('X-Correlation-ID') || undefined;
            const traceId = response.headers.get('X-Trace-ID') || undefined;
            const spanId = response.headers.get('X-Span-ID') || undefined;

            throw new TitanError({
              code: (typeof errorData.error.code === 'number' ? errorData.error.code : ErrorCode.INTERNAL_ERROR) as ErrorCode,
              message: errorData.error.message,
              details: errorData.error.details,
              requestId,
              correlationId,
              traceId,
              spanId
            });
          }
        } catch (parseError) {
          // If it's already a TitanError, rethrow it
          if (parseError instanceof TitanError) {
            throw parseError;
          }
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
    input: any,
    output: any,
    cacheHints: HttpResponseHints['cache']
  ): void {
    // TODO: Implement cache storage based on hints
    this.logger.debug({ service, method, cacheHints }, 'Received cache hints');
  }

  /**
   * Get service name from definition ID
   */
  private getServiceNameFromDefId(defId: string): string {
    const definition = this.definitionsById.get(defId);
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
        code: (typeof response.error.code === 'string' ? parseInt(response.error.code, 10) : response.error.code || ErrorCode.INTERNAL_ERROR) as ErrorCode,
        message: response.error.message,
        details: response.error.details
      });
    }

    return Errors.internal('Unknown error');
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
    this.definitionsById.clear();

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
  protected async releaseInterfaceInternal(iInstance: any): Promise<void> {
    // No-op for HTTP - interfaces are stateless
  }

  /**
   * Get definition by ID
   */
  protected getDefinitionById(defId: string): Definition {
    const definition = this.definitionsById.get(defId);
    if (!definition) {
      throw Errors.notFound('Definition', defId);
    }
    return definition;
  }

  /**
   * Get definition by service name
   */
  protected getDefinitionByServiceName(name: string): Definition {
    const def = this.services.get(name);
    if (!def) {
      throw NetronErrors.serviceNotFound(name);
    }
    return def;
  }

  /**
   * Queries the remote peer for a service definition via HTTP endpoint.
   * This method will use the POST /netron/query-interface endpoint.
   *
   * Phase 1 Optimization: JWT-scoped caching with TTL-based expiration
   * - Different users get separate cache entries (prevents authorization poisoning)
   * - Cache entries expire after configured TTL (default 5 minutes)
   * - Unauthenticated requests use shared cache
   *
   * @param {string} qualifiedName - Service name with version (name@version)
   * @returns {Promise<Definition>} Resolves with the service definition
   * @throws {TitanError} If the service is not found or access is denied
   * @protected
   */
  protected async queryInterfaceRemote(qualifiedName: string): Promise<Definition> {
    this.logger.debug({ serviceName: qualifiedName }, 'Querying remote interface via HTTP');

    try {
      // OPTIMIZATION 1: JWT-scoped cache key
      const cacheKey = this.createCacheKey(qualifiedName);

      // OPTIMIZATION 2: Check cache with TTL expiration
      const cached = this.definitions.get(cacheKey);
      if (cached && !this.isCacheExpired(cached)) {
        this.logger.debug(
          { serviceName: qualifiedName, cacheKey },
          'Using cached definition (not expired)'
        );
        return cached.definition;
      }

      // Cache miss or expired - fetch from server
      this.logger.debug(
        { serviceName: qualifiedName, cacheKey, expired: cached ? true : false },
        'Cache miss or expired, fetching from server'
      );

      // Make HTTP POST request to /netron/query-interface endpoint
      const response = await this.sendHttpRequest<{ result: Definition }>(
        'POST',
        '/netron/query-interface',
        { serviceName: qualifiedName }
      );

      const definition = response.result;

      if (!definition) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Service '${qualifiedName}' not found on remote peer`
        });
      }

      // OPTIMIZATION 3: Store with TTL metadata
      this.definitions.set(cacheKey, {
        definition,
        timestamp: Date.now(),
        ttl: this.defaultOptions.definitionCacheTtl || 300000
      });

      // Store in defId cache for method calls
      this.definitionsById.set(definition.id, definition);

      // Also store in services map for backward compatibility
      const serviceKey = `${definition.meta.name}@${definition.meta.version}`;
      this.services.set(serviceKey, definition);

      this.logger.info(
        {
          serviceName: qualifiedName,
          definitionId: definition.id,
          methodCount: Object.keys(definition.meta.methods || {}).length,
          cacheKey,
          ttl: this.defaultOptions.definitionCacheTtl
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

    // Check if interface already exists in cache (for reference counting)
    let iInfo = this.interfaces.get(definition.id);
    if (iInfo !== undefined) {
      // Interface exists, increment refCount and return existing instance
      iInfo.refCount++;
      return iInfo.instance as TService;
    }

    // Create standard HttpInterface (simple RPC)
    // Pass peer directly to avoid recursive queryInterface calls
    const httpInterface = new HttpInterface<TService>(
      this,  // Pass peer, not transport client
      definition
    );

    // Set peer reference for compatibility
    httpInterface.$peer = this as any;

    // Store in interfaces cache for reference counting
    iInfo = { instance: httpInterface as any, refCount: 1 };
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

  /**
   * Extract user ID from JWT token in Authorization header
   * @private
   * @returns User ID from token payload or null if unavailable
   */
  private extractUserIdFromToken(): string | null {
    if (!this.defaultOptions.headers?.['Authorization']) {
      return null;
    }

    const authHeader = this.defaultOptions.headers['Authorization'];
    if (!authHeader.startsWith('Bearer ')) {
      return null;
    }

    const token = authHeader.substring(7);
    try {
      // Decode JWT payload (middle part between dots)
      const payload = JSON.parse(atob(token.split('.')[1]));
      // Try common user ID fields
      return payload.sub || payload.userId || payload.id || null;
    } catch {
      // Invalid token format
      return null;
    }
  }

  /**
   * Create cache key with JWT scoping to prevent authorization cache poisoning
   * @private
   * @param qualifiedName - Service qualified name
   * @returns Cache key scoped by user ID if authenticated
   */
  private createCacheKey(qualifiedName: string): string {
    const userId = this.extractUserIdFromToken();
    return userId ? `${userId}:${qualifiedName}` : qualifiedName;
  }

  /**
   * Check if cache entry has expired based on TTL
   * @private
   * @param entry - Cache entry with timestamp and TTL
   * @returns true if cache entry is expired
   */
  private isCacheExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }
}