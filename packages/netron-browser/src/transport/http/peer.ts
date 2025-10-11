/**
 * HttpRemotePeer - Native HTTP implementation for browser
 *
 * This peer implementation uses native HTTP JSON messages instead of
 * binary packet encoding, providing better performance and compatibility
 * with standard HTTP tools in browser environments.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { AbstractPeer } from '../../core/abstract-peer.js';
import type { EventSubscriber } from '../../core/types.js';
import { Definition } from '../../core/definition.js';
import { TitanError, ErrorCode, Errors } from '../../errors/index.js';
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
function createConsoleLogger(component: string, baseUrl: string): IBrowserLogger {
  const prefix = `[${component}] [${baseUrl}]`;
  return {
    debug: (...args: any[]) => console.debug(prefix, ...args),
    warn: (...args: any[]) => console.warn(prefix, ...args),
    error: (...args: any[]) => console.error(prefix, ...args),
    info: (...args: any[]) => console.info(prefix, ...args),
  };
}

/**
 * HttpRemotePeer - Optimized HTTP peer for browser
 *
 * Key improvements:
 * - Direct JSON messaging without binary encoding
 * - Native HTTP error handling
 * - Built-in caching support
 * - Request/response correlation without packets
 * - OpenAPI-compatible message format
 */
export class HttpRemotePeer extends AbstractPeer {
  public logger: IBrowserLogger;

  /** Base URL for HTTP requests */
  private baseUrl: string;

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

  constructor(baseUrl: string, options?: { requestTimeout?: number; headers?: Record<string, string> }) {
    // Generate a deterministic ID based on the URL
    const id = `http-direct-${new URL(baseUrl).host}`;
    super(id);

    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.logger = createConsoleLogger('HttpRemotePeer', baseUrl);

    // Set default options
    this.defaultOptions = {
      timeout: options?.requestTimeout || 30000,
      headers: options?.headers || {},
    };
  }

  /**
   * Initialize the HTTP peer
   */
  async init(): Promise<void> {
    this.logger.debug('Initializing HTTP Remote peer');
    this.logger.debug('HTTP peer initialized in client mode - using auth-aware on-demand service discovery');
    this.logger.debug(
      'Services will be discovered on-demand via queryInterface(). ' +
        'Use POST /netron/authenticate for user authentication. ' +
        'Service definitions are resolved internally by the server during POST /netron/invoke calls.'
    );
  }

  /**
   * Set a property value on the remote peer (not supported for HTTP transport)
   */
  override async set(_defId: string, _name: string, _value: any): Promise<void> {
    throw Errors.notImplemented(
      'Property setters are not supported in HTTP transport. ' +
        'HTTP transport is stateless and does not support remote property access. ' +
        'Consider using a dedicated method to update server state instead.'
    );
  }

  /**
   * Get a property value from the remote peer (not supported for HTTP transport)
   */
  override async get(_defId: string, _name: string): Promise<any> {
    throw Errors.notImplemented(
      'Property getters are not supported in HTTP transport. ' +
        'HTTP transport is stateless and does not support remote property access. ' +
        'Consider using a dedicated method to retrieve server state instead.'
    );
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
   * Subscribe to events (not supported for HTTP transport)
   */
  override async subscribe(_eventName: string, _handler: EventSubscriber): Promise<void> {
    throw Errors.notImplemented(
      'Event subscriptions are not supported in HTTP transport. ' +
        'HTTP transport is request-response based and does not support real-time event streaming. ' +
        'Consider using WebSocket transport for event subscriptions, or implement polling via regular method calls.'
    );
  }

  /**
   * Unsubscribe from events (not supported for HTTP transport)
   */
  override async unsubscribe(_eventName: string, _handler: EventSubscriber): Promise<void> {
    throw Errors.notImplemented(
      'Event unsubscription is not supported in HTTP transport. ' +
        'HTTP transport is request-response based and does not support real-time event streaming. ' +
        'Consider using WebSocket transport for event subscriptions.'
    );
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
   * Send HTTP request message
   */
  private async sendRequestMessage(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    this.logger.debug('[HTTP Peer] Sending request message', message);

    // Apply request interceptors
    let processedMessage = message;
    for (const interceptor of this.requestInterceptors) {
      processedMessage = await interceptor(processedMessage);
    }

    this.logger.debug('[HTTP Peer] After interceptors, sending HTTP request', processedMessage);

    const response = await this.sendHttpRequest<HttpResponseMessage>('POST', '/netron/invoke', processedMessage);

    this.logger.debug('[HTTP Peer] Received response', response);

    // Apply response interceptors
    let processedResponse = response;
    for (const interceptor of this.responseInterceptors) {
      processedResponse = await interceptor(processedResponse);
    }

    this.logger.debug('[HTTP Peer] After response interceptors', processedResponse);
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

    this.logger.debug('[HTTP Peer] Sending HTTP request', { url, method, bodyKeys: body ? Object.keys(body) : [] });

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

      this.logger.debug('[HTTP Peer] Got HTTP response', { status: response.status, ok: response.ok });

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
    _input: any,
    _output: any,
    cacheHints: HttpResponseHints['cache']
  ): void {
    // TODO: Implement cache storage based on hints
    this.logger.debug('Received cache hints', { service, method, cacheHints });
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
  protected async queryInterfaceRemote(_qualifiedName: string): Promise<Definition> {
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
  protected getDefinitionById(_defId: string): Definition {
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
  protected getDefinitionByServiceName(_name: string): Definition {
    throw Errors.notImplemented(
      'HTTP transport does not use definitions on the client side. ' +
        'Service methods are invoked directly via HTTP requests without definition metadata.'
    );
  }
}
