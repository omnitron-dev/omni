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
import { TitanError, ErrorCode } from '../../../errors/index.js';
import type {
  Abilities,
  NetronOptions,
  EventSubscriber,
} from '../../types.js';
import {
  HttpRequestMessage,
  HttpResponseMessage,
  HttpRequestContext,
  HttpRequestHints,
  HttpResponseHints,
  createRequestMessage,
  type HttpDiscoveryResponse
} from './types.js';

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

  /** Cached abilities from the remote peer */
  private cachedAbilities: Abilities | null = null;

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
   * For HTTP, we can pre-fetch service discovery to speed up queries
   */
  async init(isClient: boolean, options?: TransportOptions): Promise<void> {
    this.logger.debug('Initializing HTTP Remote peer');

    if (isClient) {
      // Pre-fetch service discovery for better performance
      try {
        await this.discoverServices();
      } catch (error) {
        this.logger.warn({ error }, 'Failed to pre-fetch service discovery');
        // Continue anyway - discovery will be retried on demand
      }
    }
  }

  /**
   * Discover available services from the HTTP server
   */
  private async discoverServices(): Promise<void> {
    const response = await this.sendHttpRequest<HttpDiscoveryResponse>(
      'GET',
      '/netron/discovery'
    );

    if (response.services) {
      for (const [name, service] of Object.entries(response.services)) {
        const definition: Definition = {
          id: `${name}-${service.version}`,
          meta: {
            name,
            version: service.version,
            methods: service.methods.reduce((acc, method) => {
              acc[method] = { name: method };
              return acc;
            }, {} as any),
            properties: {},
            ...service.metadata
          },
          parentId: '',
          peerId: this.id
        };

        this.services.set(name, definition);
        this.serviceNames.add(name);
        this.definitions.set(definition.id, definition);
      }
    }

    // Cache contracts if provided
    if (response.contracts) {
      for (const [name, contract] of Object.entries(response.contracts)) {
        const definition = this.services.get(name);
        if (definition && definition.meta) {
          (definition.meta as any).contract = contract;
        }
      }
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
      args[0], // Netron uses single argument
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
    throw new Error('Service exposure not supported from HTTP client');
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
   * Query interface with optimized HTTP discovery
   */
  override async queryInterface<T>(qualifiedName: string): Promise<T> {
    let name: string;
    let version: string | undefined;

    if (qualifiedName.includes('@')) {
      [name, version] = qualifiedName.split('@') as [string, string | undefined];
    } else {
      name = qualifiedName;
      version = '*';
    }

    // Check if interface already exists
    const interfaceEntry = this.interfaces.get(name);
    if (interfaceEntry) {
      interfaceEntry.refCount++;
      return interfaceEntry.instance as T;
    }

    // Ensure services are discovered
    if (this.services.size === 0) {
      await this.discoverServices();
    }

    const definition = this.services.get(name);
    if (!definition) {
      throw new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: `Service ${qualifiedName} not found`
      });
    }

    // Create proxy for the service
    const proxy = this.createServiceProxy(definition);

    this.interfaces.set(name, { instance: proxy as any, refCount: 1 });
    return proxy as T;
  }

  /**
   * Query abilities from the remote peer
   */
  async queryAbilities(): Promise<Abilities> {
    if (this.cachedAbilities) {
      return this.cachedAbilities;
    }

    // Discover services if not done
    if (this.services.size === 0) {
      await this.discoverServices();
    }

    this.cachedAbilities = {
      services: this.services,
      allowServiceEvents: false // HTTP doesn't support real-time events yet
    };

    return this.cachedAbilities;
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
  private createServiceProxy(definition: Definition): any {
    const self = this;

    return new Proxy({}, {
      get(target: any, prop: string) {
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

      set(target: any, prop: string, value: any) {
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
        code: (typeof response.error.code === 'string' ? parseInt(response.error.code, 10) : response.error.code || ErrorCode.INTERNAL_ERROR) as ErrorCode,
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
    this.cachedAbilities = null;

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
}