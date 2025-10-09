/**
 * HttpConnection - Native HTTP connection without packet protocol
 *
 * This connection implementation uses native HTTP JSON messages instead of
 * binary packet encoding for improved performance and compatibility.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import {
  type ITransportConnection,
  ConnectionState,
  type TransportOptions
} from '../types.js';
import type { Definition } from '../../definition.js';
import { TitanError, ErrorCode, NetronErrors, Errors } from '../../../errors/index.js';
import {
  HttpRequestMessage,
  HttpResponseMessage,
  HttpDiscoveryResponse,
  createRequestMessage,
  isHttpResponseMessage
} from './types.js';

/**
 * HTTP Direct Connection
 * Implements ITransportConnection with native HTTP messaging
 */
export class HttpConnection extends EventEmitter implements ITransportConnection {
  readonly id: string;
  private _state: ConnectionState = ConnectionState.CONNECTING;
  private baseUrl: string;
  private options: TransportOptions;
  private abortController?: AbortController;

  // Service discovery cache
  private services = new Map<string, Definition>();
  private contracts = new Map<string, any>();
  private discoveryPromise: Promise<void> | null = null;

  // Request tracking
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timeout: NodeJS.Timeout;
  }>();

  get state(): ConnectionState {
    return this._state;
  }

  get remoteAddress(): string {
    return this.baseUrl;
  }

  get localAddress(): string | undefined {
    return undefined; // Not applicable for HTTP client
  }

  constructor(baseUrl: string, options?: TransportOptions) {
    super();
    this.id = this.generateId();
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    this.options = options || {};

    // Initialize connection
    this.initializeConnection();
  }

  /**
   * Initialize the connection
   */
  private async initializeConnection(): Promise<void> {
    // For HTTP, we consider it connected immediately since it's stateless
    this._state = ConnectionState.CONNECTED;

    // Emit connect event asynchronously
    setImmediate(() => {
      this.emit('connect');

      // Pre-load service discovery for better performance (unless disabled)
      const discoveryEnabled = this.options.discovery !== false; // default true
      if (discoveryEnabled) {
        this.discoverServices().catch((err) => {
          console.warn('Failed to pre-load service discovery:', err);
        });
      }
    });
  }

  /**
   * Generate unique connection ID
   */
  private generateId(): string {
    return `http-direct-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Discover services from the HTTP server
   */
  private async discoverServices(): Promise<void> {
    if (this.discoveryPromise) {
      return this.discoveryPromise;
    }

    this.discoveryPromise = this._discoverServices();
    return this.discoveryPromise;
  }

  private async _discoverServices(): Promise<void> {
    try {
      // Add discovery-specific timeout (5 seconds) to prevent hanging
      const discoveryTimeout = 5000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Discovery timeout')), discoveryTimeout);
      });

      const response = await Promise.race([
        this.sendHttpRequest<HttpDiscoveryResponse>(
          'GET',
          '/netron/discovery'
        ),
        timeoutPromise
      ]);

      // Store discovered services
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
        }
      }

      // Store contracts if provided
      if (response.contracts) {
        for (const [name, contract] of Object.entries(response.contracts)) {
          this.contracts.set(name, contract);
        }
      }
    } catch (error) {
      // If discovery fails, continue anyway - services might still work
      // This is intentional - we want the connection to be usable even without discovery
      console.warn('Service discovery failed:', error);
    }
  }

  /**
   * Send data using native HTTP messaging
   */
  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    // For compatibility with existing code, try to parse as JSON
    const buffer = Buffer.isBuffer(data) ? data :
      data instanceof Uint8Array ? Buffer.from(data) :
        Buffer.from(data);

    try {
      const str = buffer.toString();
      const msg = JSON.parse(str);

      // Handle different message types
      if (msg.type === 'request' || msg.service) {
        // Convert to new message format
        const request = createRequestMessage(
          msg.service || '__system',
          msg.method || msg.type,
          msg.input || msg.data
        );

        const response = await this.sendRequestMessage(request);

        // Emit response for compatibility
        this.emit('message', Buffer.from(JSON.stringify(response)), true);
      }
    } catch (error) {
      // Not JSON or unknown format, ignore
      console.warn('Received unknown data format:', error);
    }
  }

  /**
   * Send a packet - converts packet to HTTP message for compatibility
   * This method provides backward compatibility with packet-based code
   */
  async sendPacket(packet: any): Promise<void> {
    // Extract data from packet
    const data = packet.data;

    // Check if it's an invocation packet
    if (data && typeof data === 'object') {
      if (data.service && data.method) {
        // This is a service invocation
        const request = createRequestMessage(
          data.service,
          data.method,
          data.input || data.args || data.params
        );

        const response = await this.sendRequestMessage(request);

        // Emit response as packet data for compatibility
        this.emit('packet', {
          id: packet.id,
          flags: 0,
          data: response
        });
      } else {
        // Try to send as raw JSON data
        await this.send(Buffer.from(JSON.stringify(data)));
      }
    } else {
      // Send raw data
      const buffer = Buffer.isBuffer(data) ? data :
        typeof data === 'string' ? Buffer.from(data) :
          Buffer.from(JSON.stringify(data));
      await this.send(buffer);
    }
  }

  /**
   * Send HTTP request message
   */
  private async sendRequestMessage(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    const response = await this.sendHttpRequest<HttpResponseMessage>(
      'POST',
      '/netron/invoke',
      message
    );

    if (!isHttpResponseMessage(response)) {
      throw new TitanError({
        code: ErrorCode.UNPROCESSABLE_ENTITY,
        message: 'Invalid response format from server'
      });
    }

    return response;
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
      ...this.options?.headers
    };

    const timeout = this.options?.timeout || 30000;
    this.abortController = new AbortController();

    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: this.abortController.signal
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
          message: `Request timeout after ${timeout}ms`
        });
      }

      throw error;
    }
  }

  /**
   * Ping the server to measure round-trip time
   * HTTP implementation uses a lightweight discovery request
   */
  async ping(): Promise<number> {
    if (this._state !== ConnectionState.CONNECTED) {
      throw NetronErrors.connectionClosed('http', 'Connection is not established');
    }

    const startTime = Date.now();

    try {
      // Use discovery endpoint as a lightweight ping
      const response = await fetch(`${this.baseUrl}/discover`, {
        method: 'GET',
        signal: this.abortController?.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw NetronErrors.connectionFailed('http', this.baseUrl, new Error(`Ping failed with status ${response.status}`));
      }

      const rtt = Date.now() - startTime;
      return rtt;
    } catch (error) {
      throw NetronErrors.connectionFailed('http', this.baseUrl, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Close the connection
   */
  async close(code?: number, reason?: string): Promise<void> {
    if (this._state === ConnectionState.DISCONNECTED) {
      return;
    }

    this._state = ConnectionState.DISCONNECTED;

    // Abort any pending requests
    if (this.abortController) {
      this.abortController.abort();
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this.pendingRequests.clear();

    this.emit('disconnect', { code, reason });
  }

  /**
   * Reconnect (for compatibility - HTTP is stateless)
   */
  async reconnect(): Promise<void> {
    this._state = ConnectionState.CONNECTING;

    // HTTP doesn't really need to reconnect, just update state
    await new Promise(resolve => setTimeout(resolve, 100));

    this._state = ConnectionState.CONNECTED;
    this.emit('connect');

    // Re-discover services
    await this.discoverServices();
  }

  /**
   * Check if connection is alive
   */
  isAlive(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): any {
    return {
      id: this.id,
      state: this._state,
      baseUrl: this.baseUrl,
      services: Array.from(this.services.keys()),
      pendingRequests: this.pendingRequests.size
    };
  }

  /**
   * Query interface (for Netron compatibility)
   */
  async queryInterface(serviceName: string): Promise<any> {
    // Try to wait for discovery, but don't hang forever
    // Use a race between discovery and a fast timeout
    try {
      await Promise.race([
        this.discoverServices(),
        new Promise((resolve) => setTimeout(resolve, 1000)) // 1 second max wait
      ]);
    } catch (error) {
      // Ignore discovery errors, continue with minimal definition
    }

    const definition = this.services.get(serviceName);
    if (!definition) {
      // Create a minimal definition if we don't have one
      // This allows services to work even without discovery
      const minimalDef: Definition = {
        id: serviceName,
        meta: {
          name: serviceName,
          version: '1.0.0',
          methods: {},
          properties: {}
        },
        parentId: '',
        peerId: this.id
      };

      return this.createServiceProxy(minimalDef);
    }

    return this.createServiceProxy(definition);
  }

  /**
   * Create service proxy
   */
  private createServiceProxy(definition: Definition): any {
    const self = this;

    return new Proxy({}, {
      get(target: any, prop: string) {
        // Special properties
        if (prop === '$def') {
          return definition;
        }

        // Create method proxy
        return async (...args: any[]) => {
          const request = createRequestMessage(
            definition.meta.name,
            prop,
            args[0] // Netron uses single argument
          );

          const response = await self.sendRequestMessage(request);

          if (!response.success) {
            throw new TitanError({
              code: (typeof response.error?.code === 'number' ? response.error.code : ErrorCode.INTERNAL_ERROR) as ErrorCode,
              message: response.error?.message || 'Method call failed',
              details: response.error?.details
            });
          }

          return response.data;
        };
      }
    });
  }
}