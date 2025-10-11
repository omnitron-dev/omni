/**
 * Re-export layer for @omnitron-dev/netron-browser
 *
 * This file provides a compatibility layer that maps netron-browser exports
 * to the naming conventions expected by Aether applications.
 */

import {
  WebSocketPeer,
  HttpClient,
  WebSocketConnection,
} from '@omnitron-dev/netron-browser';
import type {
  WebSocketPeerOptions,
  WebSocketConnectionOptions,
  HttpClientOptions as NetronHttpClientOptions,
} from '@omnitron-dev/netron-browser';

// Extended HttpClientOptions for backward compatibility
export interface HttpClientOptions extends Partial<NetronHttpClientOptions> {
  /** Base URL (alias for url) */
  baseUrl?: string;
  /** URL for HTTP requests */
  url?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Custom headers */
  headers?: Record<string, string>;
}

// ============================================================================
// Compatibility Wrapper for NetronClient
// ============================================================================

/**
 * Extended client options for backward compatibility
 */
export interface NetronClientOptions extends Partial<WebSocketPeerOptions> {
  /** Server URL (can be provided in constructor or connect()) */
  url?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Transport type - defaults to 'websocket' */
  transport?: 'websocket' | 'http';
  /** WebSocket-specific options */
  websocket?: Partial<WebSocketConnectionOptions>;
  /** HTTP-specific options */
  http?: Partial<HttpClientOptions>;
}

/**
 * NetronClient - Compatibility wrapper for Aether applications
 *
 * Provides backward compatibility with the old BrowserNetronClient API
 * while using the new netron-browser implementation underneath.
 *
 * @example
 * ```typescript
 * const client = new NetronClient({ url: 'ws://localhost:3000' });
 * await client.connect();
 * const service = await client.queryInterface<MyService>('MyService@1.0.0');
 * await service.myMethod();
 * ```
 */
export class NetronClient {
  private wsPeer: WebSocketPeer | null = null;
  private options: NetronClientOptions;
  private _url: string | null = null;

  constructor(options: NetronClientOptions = {}) {
    this.options = options;
    this._url = options.url || null;
  }

  /**
   * Connect to the Netron server
   * @param url Optional URL override (if not provided in constructor)
   */
  async connect(url?: string): Promise<void> {
    const connectUrl = url || this._url;
    if (!connectUrl) {
      throw new Error('URL must be provided either in constructor or connect() method');
    }

    this._url = connectUrl;

    // Create WebSocket peer with proper options
    const peerOptions: WebSocketPeerOptions = {
      requestTimeout: this.options.timeout || this.options.requestTimeout,
      reconnect: this.options.reconnect ?? this.options.websocket?.reconnect,
      reconnectDelay: this.options.reconnectDelay ?? this.options.websocket?.reconnectDelay,
      maxReconnectDelay: this.options.maxReconnectDelay ?? this.options.websocket?.maxReconnectDelay,
      reconnectBackoffMultiplier: this.options.reconnectBackoffMultiplier ?? this.options.websocket?.reconnectBackoffMultiplier,
      maxReconnectAttempts: this.options.maxReconnectAttempts ?? this.options.websocket?.maxReconnectAttempts,
      protocols: this.options.protocols ?? this.options.websocket?.protocols,
      debug: this.options.debug,
    };

    this.wsPeer = new WebSocketPeer(connectUrl, peerOptions);
    await this.wsPeer.connect();
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.wsPeer) {
      await this.wsPeer.close();
      this.wsPeer = null;
    }
  }

  /**
   * Query a service interface
   * @param serviceName Service name (e.g., 'MyService@1.0.0')
   * @returns Service interface proxy
   */
  async queryInterface<T = any>(serviceName: string): Promise<T> {
    if (!this.wsPeer) {
      throw new Error('Not connected. Call connect() first.');
    }

    return await this.wsPeer.queryInterface<T>(serviceName);
  }

  /**
   * Subscribe to an event
   * @param eventName Event name
   * @param handler Event handler
   */
  async subscribe(eventName: string, handler: (data: any) => void): Promise<void> {
    if (!this.wsPeer) {
      throw new Error('Not connected. Call connect() first.');
    }

    await this.wsPeer.subscribe(eventName, handler);
  }

  /**
   * Unsubscribe from an event
   * @param eventName Event name
   * @param handler Event handler
   */
  async unsubscribe(eventName: string, handler: (data: any) => void): Promise<void> {
    if (!this.wsPeer) {
      throw new Error('Not connected. Call connect() first.');
    }

    await this.wsPeer.unsubscribe(eventName, handler);
  }

  /**
   * Get the underlying peer
   */
  getPeer() {
    return this.wsPeer;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.wsPeer?.isConnected ?? false;
  }

  /**
   * Get connection metrics
   */
  getMetrics() {
    return this.wsPeer?.getMetrics() || null;
  }

  /**
   * Ping the server to measure latency
   */
  async ping(): Promise<number> {
    if (!this.wsPeer) {
      throw new Error('Not connected. Call connect() first.');
    }
    return await this.wsPeer.ping();
  }

  /**
   * Reconnect to the server
   */
  async reconnect(): Promise<void> {
    if (!this.wsPeer) {
      throw new Error('Not connected. Call connect() first.');
    }
    await this.wsPeer.reconnect();
  }
}

/**
 * HttpNetronClient - Compatibility wrapper for HTTP transport
 *
 * Provides backward compatibility with the old HTTP client API
 * while using the new netron-browser implementation underneath.
 *
 * @example
 * ```typescript
 * const client = new HttpNetronClient({ baseUrl: 'http://localhost:3000' });
 * await client.initialize();
 * const service = await client.queryInterface<MyService>('MyService@1.0.0');
 * await service.myMethod();
 * ```
 */
export class HttpNetronClient {
  private httpClient: HttpClient | null = null;
  private options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
  }

  /**
   * Initialize the HTTP client (connects to server)
   */
  async initialize(): Promise<void> {
    const baseUrl = this.options.baseUrl || this.options.url;
    if (!baseUrl) {
      throw new Error('baseUrl or url must be provided in options');
    }

    this.httpClient = new HttpClient({
      url: baseUrl,
      timeout: this.options.timeout,
      headers: this.options.headers,
    });

    // HttpClient doesn't require init(), it's ready to use immediately
  }

  /**
   * Query a service interface
   * @param serviceName Service name (e.g., 'MyService@1.0.0')
   * @returns Service interface proxy
   */
  async queryInterface<T = any>(serviceName: string): Promise<T> {
    if (!this.httpClient) {
      throw new Error('Not initialized. Call initialize() first.');
    }

    // Create a service proxy that calls httpClient.invoke for each method
    return new Proxy({} as any, {
      get: (_target, prop: string) => async (...args: any[]) => {
        return await this.httpClient!.invoke(serviceName, prop, args);
      }
    }) as T;
  }

  /**
   * Close the HTTP client
   */
  async close(): Promise<void> {
    if (this.httpClient) {
      // HttpClient doesn't have a close method, just clear the reference
      this.httpClient = null;
    }
  }

  /**
   * Get the underlying client
   */
  getPeer() {
    return this.httpClient;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.httpClient !== null;
  }

  /**
   * Get metrics
   */
  getMetrics() {
    if (!this.httpClient) {
      return { baseUrl: this.options.baseUrl || this.options.url };
    }
    return {
      baseUrl: this.options.baseUrl || this.options.url,
      // Add any other available metrics
    };
  }

  /**
   * Add request interceptor (not supported in HttpClient)
   */
  addRequestInterceptor(_interceptor: (req: any) => any | Promise<any>): void {
    console.warn('addRequestInterceptor is not supported in the new HttpClient implementation');
  }

  /**
   * Add response interceptor (not supported in HttpClient)
   */
  addResponseInterceptor(_interceptor: (res: any) => any | Promise<any>): void {
    console.warn('addResponseInterceptor is not supported in the new HttpClient implementation');
  }

  /**
   * Invalidate cache entries matching a pattern (not directly supported)
   */
  async invalidateCache(_pattern?: string, _cacheType?: 'service' | 'http' | 'all'): Promise<number> {
    console.warn('invalidateCache is not directly supported in the new HttpClient implementation');
    return 0;
  }
}

// ============================================================================
// Core Netron Components
// ============================================================================
export {
  AbstractPeer,
  isNetronPeer,
  Definition,
  Reference,
  Interface,
  StreamReference,
  isServiceDefinition,
  isServiceReference,
  isNetronStreamReference,
  isNetronStream,
  isNetronService,
  getServiceEventName,
  getPeerEventName,
  getQualifiedName,
  detectRuntime,
  parseCommonHeaders,
  MAX_UID_VALUE,
  CONTEXTIFY_SYMBOL,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
  NETRON_EVENT_PEER_CONNECT,
  NETRON_EVENT_PEER_DISCONNECT,
  CONNECT_TIMEOUT,
  REQUEST_TIMEOUT,
} from '@omnitron-dev/netron-browser';

export type {
  IPeer,
  EventSubscriber,
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
  StreamReferenceType,
  RuntimeEnvironment,
  CommonHeaders,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Main Client Exports (with compatibility aliases)
// ============================================================================

// NOTE: NetronClient and HttpNetronClient are defined above as compatibility wrappers
// They are NOT re-exported from netron-browser to avoid naming conflicts

// Low-level client utilities and types
export { createClient } from '@omnitron-dev/netron-browser';

// ============================================================================
// Transport Layer
// ============================================================================
export {
  WebSocketPeer,
  WebSocketConnection,
  WebSocketState,
} from '@omnitron-dev/netron-browser';

export type {
  WebSocketPeerOptions,
  WebSocketConnectionOptions,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Type System
// ============================================================================
// NOTE: NetronClientOptions is defined above for backward compatibility
// Exporting the underlying types separately to avoid conflicts
export type {
  TransportType,
  RequestContext,
  RequestHints,
  HttpRequestMessage,
  HttpResponseMessage,
  Packet,
  PacketType,
  ConnectionState,
  ConnectionMetrics,
  ServiceDescriptor,
  MethodDescriptor,
  ParameterDescriptor,
} from '@omnitron-dev/netron-browser';

// Re-export base client options with different names to avoid conflicts
export type {
  WebSocketClientOptions as NetronWebSocketClientOptions,
  HttpClientOptions as NetronHttpClientOptions,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Error Handling
// ============================================================================
export {
  NetronError,
  ConnectionError,
  TimeoutError,
  NetworkError,
  ProtocolError,
  ServiceError,
  MethodNotFoundError,
  InvalidArgumentsError,
  TransportError,
  SerializationError,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Utilities
// ============================================================================
export {
  generateRequestId,
  createRequestMessage,
  validateUrl,
  normalizeUrl,
  httpToWsUrl,
  isBrowser,
  isWebSocketSupported,
  isFetchSupported,
  sleep,
  calculateBackoff,
  deepClone,
  deepMerge,
  debounce,
  throttle,
  uuid,
  Uid,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Constants
// ============================================================================
export { NETRON_VERSION } from '@omnitron-dev/netron-browser';

// ============================================================================
// Authentication System
// ============================================================================
export {
  AuthenticationClient,
  LocalTokenStorage,
  SessionTokenStorage,
  MemoryTokenStorage,
} from '@omnitron-dev/netron-browser';

export type {
  AuthCredentials,
  AuthContext,
  AuthResult,
  TokenStorage,
  AuthOptions,
  AuthState,
  AuthEventType,
  AuthEventHandler,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Core Tasks
// ============================================================================
export {
  CORE_TASK_AUTHENTICATE,
  createAuthenticateRequest,
  isAuthenticateResponse,
  CORE_TASK_INVALIDATE_CACHE,
  createInvalidateCacheRequest,
  isInvalidateCacheResponse,
  matchesPattern,
  CORE_TASK_QUERY_INTERFACE,
  createQueryInterfaceRequest,
  isQueryInterfaceResponse,
  resolveServiceName,
  isFilteredDefinition,
} from '@omnitron-dev/netron-browser';

export type {
  AuthenticateRequest,
  AuthenticateResponse,
  InvalidateCacheRequest,
  InvalidateCacheResponse,
  QueryInterfaceRequest,
  QueryInterfaceResponse,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Middleware System
// ============================================================================
export {
  MiddlewarePipeline,
  MiddlewareStage,
  createAuthMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  createErrorTransformMiddleware,
  SimpleTokenProvider,
  StorageTokenProvider,
  InMemoryMetricsCollector,
  ConsoleLogger,
  defaultErrorTransformer,
  CommonErrorMessages,
  isRetryableError,
  isClientError,
  isServerError,
} from '@omnitron-dev/netron-browser';

export type {
  MiddlewareFunction,
  ClientMiddlewareContext,
  MiddlewareConfig,
  MiddlewareRegistration,
  MiddlewareMetrics,
  IMiddlewareManager,
  TokenProvider,
  AuthMiddlewareOptions,
  Logger,
  LogLevel,
  LoggingMiddlewareOptions,
  MetricsCollector,
  PerformanceMetrics,
  TimingMiddlewareOptions,
  ErrorTransformMiddlewareOptions,
  NormalizedError,
  ErrorTransformer,
  ErrorHandler,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Decorators (stub exports for compatibility)
// ============================================================================
// Note: Service, Public, and Method decorators are backend-specific and not available in netron-browser.
// These are stub exports for backward compatibility only.

export const Service = (_name?: string) => (target: any) => {
  console.warn('Service decorator is not functional in browser environment');
  return target;
};

export const Public = () => (_target: any, _propertyKey: string) => {
  console.warn('Public decorator is not functional in browser environment');
};

export const Method = () => (_target: any, _propertyKey: string) => {
  console.warn('Method decorator is not functional in browser environment');
};

// BrowserLogger for backward compatibility
export class BrowserLogger {
  constructor(private context?: any) {}

  debug(...args: any[]) {
    console.debug('[BrowserLogger]', ...args);
  }

  info(...args: any[]) {
    console.info('[BrowserLogger]', ...args);
  }

  warn(...args: any[]) {
    console.warn('[BrowserLogger]', ...args);
  }

  error(...args: any[]) {
    console.error('[BrowserLogger]', ...args);
  }

  child(context: any) {
    return new BrowserLogger({ ...this.context, ...context });
  }
}

// Type alias for compatibility
export type ILogger = BrowserLogger;

// Additional aliases for backward compatibility
export const BrowserNetronClient = NetronClient;
export type BrowserNetronClientOptions = NetronClientOptions;

// Re-export WebSocketPeer as BrowserRemotePeer for compatibility
export const BrowserRemotePeer = WebSocketPeer;

// Export BrowserWebSocketConnection alias
export const BrowserWebSocketConnection = WebSocketConnection;
