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
import type { EventSubscriber } from '../../types.js';
import {
  HttpRequestMessage,
  HttpResponseMessage,
  HttpRequestContext,
  HttpRequestHints,
  HttpResponseHints,
  createRequestMessage,
} from './types.js';
import { HttpInterface } from './interface.js';
import { HttpTransportClient } from './client.js';
import { FluentInterface, HttpCacheManager, RetryManager, type QueryOptions } from './fluent-interface/index.js';

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

  /** Service definitions cached from discovery (deprecated - kept for compatibility) */
  public services = new Map<string, Definition>();

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
  private requestInterceptors: Array<(req: HttpRequestMessage) => HttpRequestMessage | Promise<HttpRequestMessage>> =
    [];

  /** Response interceptors */
  private responseInterceptors: Array<
    (res: HttpResponseMessage) => HttpResponseMessage | Promise<HttpResponseMessage>
  > = [];

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
        'Services will be discovered on-demand via queryInterface(). ' +
          'Use POST /netron/authenticate for user authentication. ' +
          'Service definitions are resolved internally by the server during POST /netron/invoke calls.'
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
   *
   * IMPORTANT: For HTTP transport, defId is actually the serviceName since we don't use definitions
   */
  override async call(defId: string, method: string, args: any[]): Promise<any> {
    // For HTTP transport, defId is the serviceName (no definitions on client side)
    const serviceName = defId;

    const message = createRequestMessage(
      serviceName,
      method,
      args, // Pass all arguments as array
      {
        context: this.buildRequestContext(),
        hints: this.buildRequestHints(),
      }
    );

    const response = await this.sendRequestMessage(message);

    if (!response.success) {
      throw this.createErrorFromResponse(response);
    }

    // Handle cache hints from response
    if (response.hints?.cache) {
      this.handleCacheHints(serviceName, method, args[0], response.data, response.hints.cache);
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
   * NOTE: For HTTP transport, we don't cache definitions, so this is mostly a no-op
   */
  override invalidateDefinitionCache(pattern?: string): number {
    // Call parent implementation to invalidate definition cache
    const parentCount = super.invalidateDefinitionCache(pattern);

    // For HTTP transport, we also need to clear the interface cache
    // since interfaces are cached by service name
    if (!pattern) {
      // Clear all services and interfaces
      const totalCount = this.services.size + this.interfaces.size;
      this.services.clear();
      this.interfaces.clear();
      return parentCount + totalCount;
    }

    // Pattern matching - remove matching services and interfaces
    const servicesToDelete: string[] = [];
    const interfacesToDelete: string[] = [];

    // Find matching services
    for (const key of this.services.keys()) {
      if (this.matchServicePattern(key, pattern)) {
        servicesToDelete.push(key);
      }
    }

    // Find matching interfaces
    for (const key of this.interfaces.keys()) {
      if (this.matchServicePattern(key, pattern)) {
        interfacesToDelete.push(key);
      }
    }

    // Delete matched services
    for (const key of servicesToDelete) {
      this.services.delete(key);
    }

    // Delete matched interfaces
    for (const key of interfacesToDelete) {
      this.interfaces.delete(key);
    }

    // Return total count of invalidated items
    return parentCount + servicesToDelete.length + interfacesToDelete.length;
  }

  /**
   * Pattern matching helper for HTTP peer
   * @private
   */
  private matchServicePattern(serviceName: string, pattern: string): boolean {
    if (serviceName === pattern) return true;
    if (!pattern.includes('*')) return false;

    const regexPattern = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
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

    const response = await this.sendHttpRequest<HttpResponseMessage>('POST', '/netron/invoke', processedMessage);

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
  private async sendHttpRequest<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Netron-Version': '2.0',
      ...this.defaultOptions.headers,
    };

    this.logger.debug({ url, method, bodyKeys: body ? Object.keys(body) : [] }, '[HTTP Peer] Sending HTTP request');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.defaultOptions.timeout!);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      this.logger.debug({ status: response.status, ok: response.ok }, '[HTTP Peer] Got HTTP response');

      if (!response.ok) {
        // CRITICAL FIX: Extract headers BEFORE consuming response body
        // Race condition: response.json() can make headers undefined
        const requestId = response.headers.get('X-Request-ID') || undefined;
        const correlationId = response.headers.get('X-Correlation-ID') || undefined;
        const traceId = response.headers.get('X-Trace-ID') || undefined;
        const spanId = response.headers.get('X-Span-ID') || undefined;

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
              requestId,
              correlationId,
              traceId,
              spanId,
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
          message: `HTTP ${response.status}: ${response.statusText}`,
        });
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new TitanError({
          code: ErrorCode.REQUEST_TIMEOUT,
          message: `Request timeout after ${this.defaultOptions.timeout}ms`,
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
   * Create error from response
   */
  private createErrorFromResponse(response: HttpResponseMessage): Error {
    if (response.error) {
      return new TitanError({
        code: (typeof response.error.code === 'string'
          ? parseInt(response.error.code, 10)
          : response.error.code || ErrorCode.INTERNAL_ERROR) as ErrorCode,
        message: response.error.message,
        details: response.error.details,
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
   * Query interface for HTTP service (unified RPC API)
   *
   * CRITICAL CHANGE: HTTP transport is stateless - we don't fetch definitions!
   * Just create a Proxy with the serviceName that will send requests to the server.
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
   * // Simple RPC method calls - no definitions needed!
   * const user = await userService.getUser('user-123');
   * const users = await userService.listUsers({ page: 1, limit: 10 });
   * ```
   *
   * @override
   */
  override async queryInterface<TService = any>(qualifiedName: string): Promise<TService> {
    // Check if interface already exists in cache (for reference counting)
    let iInfo = this.interfaces.get(qualifiedName);
    if (iInfo !== undefined) {
      // Interface exists, increment refCount and return existing instance
      iInfo.refCount++;
      return iInfo.instance as TService;
    }

    // Create standard HttpInterface with just the service name
    // NO definition fetch - this is the key difference!
    const httpInterface = new HttpInterface<TService>(this, qualifiedName);

    // Set peer reference for compatibility
    httpInterface.$peer = this as any;

    // Store in interfaces cache for reference counting
    // Use qualifiedName as the key since we don't have definition IDs
    iInfo = { instance: httpInterface as any, refCount: 1 };
    this.interfaces.set(qualifiedName, iInfo);

    return httpInterface as any as TService;
  }

  /**
   * Query fluent interface for HTTP service (advanced HTTP API)
   *
   * CRITICAL CHANGE: HTTP transport is stateless - we don't fetch definitions!
   * Just create a FluentInterface with the serviceName.
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
   * // Advanced HTTP features - no definitions needed!
   * const user = await userService.cache(60000).retry(3).getUser('user-123');
   * const users = await userService.priority('high').timeout(5000).listUsers();
   * ```
   */
  async queryFluentInterface<TService = any>(qualifiedName: string): Promise<FluentInterface<TService>> {
    // Check if interface already exists in cache (for reference counting)
    let iInfo = this.interfaces.get(qualifiedName);
    if (iInfo !== undefined) {
      // Interface exists, increment refCount and return existing instance
      iInfo.refCount++;
      // Cast through unknown since we're storing multiple interface types in the same map
      return iInfo.instance as unknown as FluentInterface<TService>;
    }

    // Get or create HTTP transport client
    const transport = this.getOrCreateHttpClient();

    // Create FluentInterface with just the service name
    // NO definition fetch - this is the key difference!
    const fluentInterface = new FluentInterface<TService>(
      transport,
      qualifiedName,
      this.cacheManager,
      this.retryManager,
      this.globalOptions
    );

    // Set peer reference for compatibility
    fluentInterface.$peer = this;

    // Store in interfaces cache for reference counting
    // Use qualifiedName as the key since we don't have definition IDs
    iInfo = { instance: fluentInterface as any, refCount: 1 };
    this.interfaces.set(qualifiedName, iInfo);

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
   * Query interface remote - not used for HTTP transport
   * HTTP transport doesn't fetch definitions from the server
   * @protected
   * @override
   */
  protected async queryInterfaceRemote(qualifiedName: string): Promise<Definition> {
    throw Errors.notImplemented(
      'HTTP transport does not fetch service definitions. ' +
        'Services are resolved on-demand during method invocation. ' +
        'Use queryInterface() to create a service proxy.'
    );
  }

  /**
   * Get definition by ID - not used for HTTP transport
   * HTTP transport doesn't use definitions on the client side
   * @protected
   * @override
   */
  protected getDefinitionById(defId: string): Definition {
    throw Errors.notImplemented(
      'HTTP transport does not use definitions on the client side. ' +
        'Service methods are invoked directly via HTTP requests without definition metadata.'
    );
  }

  /**
   * Get definition by service name - not used for HTTP transport
   * HTTP transport doesn't use definitions on the client side
   * @protected
   * @override
   */
  protected getDefinitionByServiceName(name: string): Definition {
    throw Errors.notImplemented(
      'HTTP transport does not use definitions on the client side. ' +
        'Service methods are invoked directly via HTTP requests without definition metadata.'
    );
  }

  /**
   * Helper method to extract service name from defId
   * For HTTP transport, defId IS the service name (no definitions used)
   * @private
   */
  private getServiceNameFromDefId(defId: string): string {
    // For HTTP transport, defId is already the service name
    return defId;
  }
}
