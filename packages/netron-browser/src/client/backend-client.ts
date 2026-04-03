/**
 * Backend Client - Single Backend Wrapper
 *
 * Provides a unified interface for accessing a single backend,
 * wrapping either HttpClient or WebSocketClient.
 *
 * @module client/backend-client
 */

import type { HttpClient } from './http-client.js';
import type { WebSocketClient } from './ws-client.js';
import type {
  TransportType,
  IBackendClient,
  InvokeOptions,
  TypedServiceProxy,
  BackendConfig,
} from '../types/multi-backend.js';
import { ConnectionState, type ConnectionMetrics, type RequestContext, type RequestHints } from '../types/index.js';
import type { AuthenticationClient } from '../auth/client.js';
import type { IMiddlewareManager } from '../middleware/types.js';

/**
 * Options for creating a BackendClient
 */
export interface BackendClientOptions {
  /**
   * Backend name
   */
  name: string;

  /**
   * Backend configuration
   */
  config: BackendConfig;

  /**
   * Base URL for the API gateway
   */
  baseUrl: string;

  /**
   * Shared authentication client
   */
  auth?: AuthenticationClient;

  /**
   * Shared middleware manager
   */
  middleware?: IMiddlewareManager;

  /**
   * Default timeout from shared options
   */
  defaultTimeout?: number;

  /**
   * Default headers from shared options
   */
  defaultHeaders?: Record<string, string>;
}

/**
 * Backend Client implementation
 *
 * Wraps a single transport client (HTTP or WebSocket) and provides
 * a unified interface for service access and method invocation.
 *
 * @example
 * ```typescript
 * const backendClient = new BackendClient({
 *   name: 'core',
 *   config: { path: '/core', transport: 'http' },
 *   baseUrl: 'https://api.example.com',
 * });
 *
 * await backendClient.connect();
 *
 * const users = backendClient.service<UserService>('users');
 * const user = await users.getById('123');
 * ```
 */
export class BackendClient implements IBackendClient {
  private name: string;
  private config: BackendConfig;
  private baseUrl: string;
  private fullUrl: string;
  private transportType: TransportType;
  private client: HttpClient | WebSocketClient | null = null;
  private auth?: AuthenticationClient;
  private middleware?: IMiddlewareManager;
  private defaultTimeout: number;
  private defaultHeaders: Record<string, string>;
  private connected = false;

  constructor(options: BackendClientOptions) {
    this.name = options.name;
    this.config = options.config;
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.fullUrl = `${this.baseUrl}${options.config.path}`;
    this.transportType = options.config.transport || 'http';
    this.auth = options.auth;
    this.middleware = options.middleware;
    this.defaultTimeout = options.config.timeout || options.defaultTimeout || 30000;
    this.defaultHeaders = {
      ...options.defaultHeaders,
      ...options.config.headers,
    };
  }

  /**
   * Initialize the transport client
   */
  private async initializeClient(): Promise<HttpClient | WebSocketClient> {
    if (this.client) {
      return this.client;
    }

    // Lazy import to avoid circular dependencies
    const { HttpClient } = await import('./http-client.js');
    const { WebSocketClient } = await import('./ws-client.js');

    if (this.transportType === 'websocket') {
      this.client = new WebSocketClient({
        url: this.fullUrl,
        protocols: this.config.websocket?.protocols,
        timeout: this.defaultTimeout,
        reconnect: this.config.websocket?.reconnect,
        reconnectInterval: this.config.websocket?.reconnectInterval,
        maxReconnectAttempts: this.config.websocket?.maxReconnectAttempts,
        auth: this.auth,
        middleware: this.middleware,
      });
    } else {
      this.client = new HttpClient({
        url: this.fullUrl,
        timeout: this.defaultTimeout,
        headers: this.defaultHeaders,
        retry: this.config.http?.retry,
        maxRetries: this.config.http?.maxRetries,
        auth: this.auth,
        middleware: this.middleware,
      });
    }

    return this.client;
  }

  /**
   * Connect to the backend
   */
  async connect(): Promise<void> {
    const client = await this.initializeClient();
    await client.connect();
    this.connected = true;
  }

  /**
   * Disconnect from the backend
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  /**
   * Get a typed service proxy for this backend
   *
   * @param serviceName - Name of the service
   * @returns Typed service proxy for method invocation
   */
  service<S>(serviceName: string): TypedServiceProxy<S> {
    return new Proxy({} as TypedServiceProxy<S>, {
      get: (_target, prop: string | symbol) => {
        if (typeof prop === 'symbol') {
          return undefined;
        }

        // Return an async function for method calls
        return async (...args: any[]) => await this.invoke(serviceName, prop, args);
      },
    });
  }

  /**
   * Invoke a service method on this backend
   *
   * @param service - Service name
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Invoke options
   * @returns Promise resolving to method result
   */
  async invoke<R = any>(service: string, method: string, args: any[] = [], options?: InvokeOptions): Promise<R> {
    // Ensure client is initialized
    const client = await this.initializeClient();

    // Build request options
    const requestOptions: {
      context?: RequestContext;
      hints?: RequestHints;
      skipAuth?: boolean;
    } = {};

    if (options?.context) {
      requestOptions.context = options.context;
    }

    if (options?.hints || options?.timeout) {
      requestOptions.hints = {
        ...options?.hints,
        timeout: options?.timeout || options?.hints?.timeout,
      };
    }

    if (options?.skipAuth) {
      requestOptions.skipAuth = true;
    }

    return await client.invoke(service, method, args, requestOptions);
  }

  /**
   * Get metrics for this backend
   */
  getMetrics(): ConnectionMetrics {
    if (!this.client) {
      // Return default metrics if not connected
      return {
        id: `${this.name}-not-connected`,
        url: this.fullUrl,
        state: ConnectionState.DISCONNECTED,
        transport: this.transportType,
        requestsSent: 0,
        responsesReceived: 0,
        errors: 0,
      };
    }

    const metrics = this.client.getMetrics();
    return {
      ...metrics,
      id: this.name,
    };
  }

  /**
   * Check if this backend is connected
   */
  isConnected(): boolean {
    if (!this.client) {
      return false;
    }

    if ('isConnected' in this.client && typeof this.client.isConnected === 'function') {
      return this.client.isConnected();
    }

    return this.connected;
  }

  /**
   * Get the path prefix for this backend
   */
  getPath(): string {
    return this.config.path;
  }

  /**
   * Get the transport type for this backend
   */
  getTransportType(): TransportType {
    return this.transportType;
  }

  /**
   * Get the backend name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Get the full URL for this backend
   */
  getFullUrl(): string {
    return this.fullUrl;
  }

  /**
   * Get the underlying transport client
   */
  getClient(): HttpClient | WebSocketClient | null {
    return this.client;
  }

  /**
   * Destroy the backend client and release resources
   */
  async destroy(): Promise<void> {
    if (this.client) {
      await this.disconnect();
      this.client = null;
    }
  }
}
