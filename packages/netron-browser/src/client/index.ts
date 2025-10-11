/**
 * Netron Browser Client
 *
 * Main client implementation that supports both HTTP and WebSocket transports
 */

import { HttpClient, type HttpClientOptions } from './http-client.js';
import {
  WebSocketClient,
  type WebSocketClientOptions,
} from './ws-client.js';
import type {
  NetronClientOptions,
  TransportType,
  ConnectionMetrics,
  ConnectionState,
  RequestContext,
  RequestHints,
  ServiceDescriptor,
} from '../types/index.js';
// Errors are thrown from transport implementations
import { normalizeUrl, validateUrl } from '../utils/index.js';

/**
 * Main Netron Client
 *
 * Provides a unified interface for both HTTP and WebSocket transports
 */
export class NetronClient {
  private transport: HttpClient | WebSocketClient;
  private transportType: TransportType;
  private url: string;
  private connected = false;

  constructor(options: NetronClientOptions) {
    // Validate URL
    if (!validateUrl(options.url)) {
      throw new Error(`Invalid URL: ${options.url}`);
    }

    this.url = normalizeUrl(options.url);
    this.transportType = options.transport ?? 'http';

    // Create transport based on type
    if (this.transportType === 'websocket') {
      this.transport = new WebSocketClient({
        url: this.url,
        protocols: options.websocket?.protocols,
        timeout: options.timeout,
        reconnect: options.websocket?.reconnect,
        reconnectInterval: options.websocket?.reconnectInterval,
        maxReconnectAttempts: options.websocket?.maxReconnectAttempts,
      });

      // Set up event listeners
      this.transport.on('connect', () => {
        this.connected = true;
      });

      this.transport.on('disconnect', () => {
        this.connected = false;
      });

      this.transport.on('error', (error: unknown) => {
        console.error('WebSocket error:', error);
      });
    } else {
      this.transport = new HttpClient({
        url: this.url,
        timeout: options.timeout,
        headers: options.headers,
        retry: options.http?.retry,
        maxRetries: options.http?.maxRetries,
      });
    }
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    await this.transport.connect();
    this.connected = true;
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.connected = false;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    if (this.transport instanceof WebSocketClient) {
      return this.transport.isConnected();
    }
    return this.connected;
  }

  /**
   * Get connection state
   */
  getState(): ConnectionState {
    return this.transport.getState();
  }

  /**
   * Invoke a service method
   */
  async invoke<T = any>(
    service: string,
    method: string,
    args: any[] = [],
    options?: {
      context?: RequestContext;
      hints?: RequestHints;
    }
  ): Promise<T> {
    return await this.transport.invoke(service, method, args, options);
  }

  /**
   * Create a service proxy for type-safe method calls
   */
  service<T extends object>(serviceName: string): T {
    return new Proxy({} as T, {
      get: (_target, prop: string) => async (...args: any[]) => await this.invoke(serviceName, prop, args),
    });
  }

  /**
   * Get service descriptor (metadata about available methods)
   */
  async getServiceDescriptor(serviceName: string): Promise<ServiceDescriptor> {
    return await this.invoke('$system', 'describe', [serviceName]);
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return this.transport.getMetrics();
  }

  /**
   * Get transport type
   */
  getTransportType(): TransportType {
    return this.transportType;
  }

  /**
   * Get base URL
   */
  getUrl(): string {
    return this.url;
  }
}

/**
 * Create a Netron client instance
 */
export function createClient(options: NetronClientOptions): NetronClient {
  return new NetronClient(options);
}

// Re-export client classes and options
export { HttpClient, WebSocketClient };
export type { HttpClientOptions, WebSocketClientOptions };
