/**
 * HTTP Netron Client for Browser
 * High-level HTTP client without WebSocket (REST API mode)
 */

import { HttpTransportClient } from './clients/http/client.js';
import { BrowserLogger, type ILogger } from './logger.js';
import type { INetron } from './types.js';

/**
 * Options for HttpNetronClient
 */
export interface HttpClientOptions {
  /** Base URL of HTTP server (e.g. 'http://localhost:3000') */
  baseUrl: string;

  /** Request timeout in milliseconds (default: 30000ms) */
  timeout?: number;

  /** Custom HTTP headers */
  headers?: Record<string, string>;

  /** Custom logger instance */
  logger?: ILogger;
}

/**
 * HTTP-based Netron Client (без WebSocket)
 * Uses REST API for service invocation
 *
 * @example
 * ```typescript
 * const client = new HttpNetronClient({
 *   baseUrl: 'http://localhost:3000'
 * });
 *
 * await client.initialize();
 * const service = await client.queryInterface<MyService>('MyService@1.0.0');
 * const result = await service.myMethod();
 * ```
 */
export class HttpNetronClient {
  private client: HttpTransportClient;
  private logger: ILogger;
  private netronStub: INetron;

  constructor(private options: HttpClientOptions) {
    this.logger = options.logger ?? new BrowserLogger({ client: 'HttpNetronClient' });

    // Create minimal INetron stub
    this.netronStub = {
      uuid: crypto.randomUUID(),
      logger: this.logger,
      options: undefined,
      services: new Map(),
      peer: null as any,
      peers: new Map(),
      transportServers: new Map(),
      transportServer: undefined,
      getLocalPeer: () => {
        throw new Error('getLocalPeer() not available in HTTP client');
      },
      findPeer: () => undefined,
      trackTask: async () => {
        throw new Error('trackTask() not available in HTTP client');
      },
      runTask: undefined,
      emitSpecial: () => {
        // No-op in HTTP client
      },
      getServiceNames: () => [],
      emit: () => false,
      on (this: INetron) {
        return this;
      },
      off (this: INetron) {
        return this;
      },
      removeListener (this: INetron) {
        return this;
      },
      getPeerEventName: undefined,
    };

    // Create HTTP transport client
    this.client = new HttpTransportClient(options.baseUrl, this.netronStub, {
      timeout: options.timeout,
      headers: options.headers,
    });
  }

  /**
   * Initialize the HTTP client
   * Must be called before using queryInterface or invoke
   *
   * @returns Promise that resolves when initialized
   */
  async initialize(): Promise<void> {
    this.logger.info({ baseUrl: this.options.baseUrl }, 'Initializing HTTP Netron client');
    await this.client.initialize();
    this.logger.info('HTTP Netron client initialized');
  }

  /**
   * Query service interface by name
   * Returns a proxy object that allows calling remote methods via HTTP
   *
   * @param serviceName - Service name with optional version (e.g. 'Calculator@1.0.0')
   * @returns Promise resolving to service proxy
   * @throws Error if not initialized
   *
   * @example
   * ```typescript
   * await client.initialize();
   * const calc = await client.queryInterface<Calculator>('Calculator@1.0.0');
   * const result = await calc.add(2, 3);
   * ```
   */
  async queryInterface<T extends object = any>(serviceName: string): Promise<T> {
    this.logger.debug({ serviceName }, 'Querying service interface');

    // The client.invoke will handle initialization if needed
    // But we create a proxy that intercepts method calls
    return new Proxy({} as T, {
      get: (_target, method: string) => async (...args: any[]) => {
          this.logger.debug({ serviceName, method, args }, 'Invoking method');
          return this.client.invoke(serviceName, method, args);
        },
    }) as T;
  }

  /**
   * Invoke a service method directly
   * Lower-level API for direct method invocation
   *
   * @param serviceName - Service name
   * @param methodName - Method name
   * @param args - Method arguments
   * @returns Promise resolving to method result
   */
  async invoke(serviceName: string, methodName: string, ...args: any[]): Promise<any> {
    this.logger.debug({ serviceName, methodName, args }, 'Direct method invocation');
    return this.client.invoke(serviceName, methodName, args);
  }

  /**
   * Close the HTTP client
   * Cleans up resources
   */
  async close(): Promise<void> {
    this.logger.info('Closing HTTP Netron client');
    await this.client.close();
  }

  /**
   * Get client metrics
   * Returns information about the client state
   *
   * @returns Metrics object
   */
  getMetrics(): any {
    return this.client.getMetrics();
  }
}
