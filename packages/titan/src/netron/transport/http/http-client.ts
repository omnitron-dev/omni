/**
 * HTTP Client Connection implementation for Netron
 * Makes HTTP requests while maintaining the Netron service interface
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import {
  type ITransportConnection,
  ConnectionState,
  type TransportOptions
} from '../types.js';
import type { Definition } from '../../definition.js';
import type { MethodContract } from '../../../validation/contract.js';
import { TitanError, ErrorCode } from '../../../errors/index.js';
import { HttpInterface } from './http-interface.js';
import { Packet, TYPE_TASK, TYPE_CALL } from '../../packet/index.js';

/**
 * Service route information for client
 */
interface ClientRoute {
  serviceName: string;
  methodName: string;
  pattern: string;
  method: string;
  contract: MethodContract;
}

/**
 * HTTP Client Connection
 * Implements ITransportConnection to make HTTP requests appear as Netron method calls
 */
export class HttpClientConnection extends EventEmitter implements ITransportConnection {
  readonly id: string;
  private _state: ConnectionState = ConnectionState.CONNECTED;
  private serviceRoutes = new Map<string, Map<string, ClientRoute>>();
  private baseUrl: string;
  private options: TransportOptions;
  private abortController?: AbortController;
  private services = new Map<string, Definition>();
  private contracts = new Map<string, any>();
  private interfaces = new Map<string, any>();
  private discoveryPromise: Promise<void> | null = null;

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
    this._state = ConnectionState.CONNECTED;

    // For HTTP, emit connect immediately since it's stateless
    setImmediate(async () => {
      this.emit('connect');

      // Pre-load services discovery immediately to speed up queries
      this.discoverServices().catch((err) => {
        console.warn('Failed to pre-load service discovery:', err);
      });
    });
  }

  /**
   * Generate unique connection ID
   */
  private generateId(): string {
    return `http-client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
      // Call the discovery endpoint
      const response = await fetch(`${this.baseUrl}/netron/discovery`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...this.options?.headers
        },
        signal: this.abortController?.signal
      });

      if (!response.ok) {
        throw new Error(`Service discovery failed: ${response.statusText}`);
      }

      const discovery = await response.json();

      // Store discovered services
      if (discovery.services) {
        for (const [name, definition] of Object.entries(discovery.services)) {
          this.services.set(name, definition as Definition);

          // Store contract if provided
          if (discovery.contracts && discovery.contracts[name]) {
            this.contracts.set(name, discovery.contracts[name]);
          }
        }
      }
    } catch (error) {
      // If discovery fails, continue anyway - services might still work
      console.warn('Service discovery failed:', error);
    }
  }

  /**
   * Query interface - HTTP version
   * This is called by Netron when the user calls queryInterface
   */
  async queryInterface(serviceName: string): Promise<any> {
    // Ensure services are discovered
    await this.discoverServices();

    // Check if we already have an interface for this service
    if (this.interfaces.has(serviceName)) {
      return this.interfaces.get(serviceName);
    }

    // Get service definition and contract
    const definition = this.services.get(serviceName);
    const contract = this.contracts.get(serviceName);

    if (!definition) {
      // Try to create a minimal definition if we don't have one
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

      // Create HTTP interface
      const httpInterface = new HttpInterface(
        this.baseUrl,
        minimalDef,
        contract,
        this.options
      );

      const proxy = httpInterface.createProxy();
      this.interfaces.set(serviceName, proxy);
      return proxy;
    }

    // Create HTTP interface
    const httpInterface = new HttpInterface(
      this.baseUrl,
      definition,
      contract,
      this.options
    );

    const proxy = httpInterface.createProxy();
    this.interfaces.set(serviceName, proxy);
    return proxy;
  }

  /**
   * Register a service with its contract
   */
  registerService(serviceName: string, definition: Definition | any, contract?: any): void {
    const routes = new Map<string, ClientRoute>();

    // Handle both Definition instances and plain objects for backwards compatibility
    let serviceContract = contract;

    // Check if definition is a plain object with contract property (legacy format)
    if (!serviceContract && definition && typeof definition === 'object' && 'contract' in definition) {
      serviceContract = definition.contract;
    }

    // Otherwise use contract from definition.meta if available
    if (!serviceContract && definition?.meta) {
      serviceContract = (definition.meta as any)?.contract;
    }

    if (!serviceContract) {
      // No contract, create RPC endpoints for all methods from definition
      // Support both definition.meta.methods and plain object.methods
      const methods = definition.meta?.methods || definition.methods;
      if (methods) {
        const methodList = Array.isArray(methods) ? methods : Object.keys(methods);
        for (const methodName of methodList) {
          routes.set(methodName, {
            serviceName,
            methodName,
            pattern: `/rpc/${methodName}`,
            method: 'POST',
            contract: {}
          });
        }
      }
    } else {
      // Create routes from contract
      const contractMethods = serviceContract.definition || serviceContract;
      for (const [methodName, methodContract] of Object.entries(contractMethods)) {
        const http = (methodContract as MethodContract).http;

        routes.set(methodName, {
          serviceName,
          methodName,
          pattern: http?.path || `/rpc/${methodName}`,
          method: http?.method || 'POST',
          contract: methodContract as MethodContract
        });
      }
    }

    this.serviceRoutes.set(serviceName, routes);
  }

  /**
   * Call a service method via HTTP
   */
  async callServiceMethod(serviceName: string, methodName: string, args: any[]): Promise<any> {
    const serviceRoutes = this.serviceRoutes.get(serviceName);
    if (!serviceRoutes) {
      throw new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: `Service ${serviceName} not found`
      });
    }

    const route = serviceRoutes.get(methodName);
    if (!route) {
      throw new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: `Method ${methodName} not found in service ${serviceName}`
      });
    }

    const input = args[0]; // Netron passes single input object
    const http = route.contract?.http;

    // Build request URL and options
    const { url, requestOptions } = this.buildRequest(route, input);

    // Add timeout if specified - check method-specific timeout first, then global
    const methodTimeout = (route.contract as any)?.options?.timeout;
    const timeout = methodTimeout || this.options.timeout || 30000;
    this.abortController = new AbortController();

    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, timeout);

    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: this.abortController.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await this.parseErrorResponse(response);
        throw error;
      }

      const contentType = response.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        return await response.json();
      } else if (contentType.includes('text/')) {
        return await response.text();
      } else {
        return await response.blob();
      }
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new TitanError({
          code: ErrorCode.REQUEST_TIMEOUT,
          message: `Request to ${methodName} timed out after ${timeout}ms`
        });
      }

      throw error;
    }
  }

  /**
   * Build HTTP request from route and input
   */
  private buildRequest(route: ClientRoute, input: any): {
    url: string;
    requestOptions: RequestInit;
  } {
    let url = this.baseUrl + route.pattern;
    let body: string | undefined;
    const headers: Record<string, string> = {
      ...this.options.headers
    };

    const http = route.contract?.http;

    // Handle path parameters
    if ((http?.params || route.pattern.includes('{') || route.pattern.includes(':')) && input) {
      for (const [key, value] of Object.entries(input)) {
        // Replace both {param} and :param styles
        url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    // Handle query parameters for GET requests
    if (route.method === 'GET' && input && typeof input === 'object') {
      const urlObj = new URL(url);
      // Get the fields to use as query parameters
      // If http.query is defined, use those fields, otherwise use all input fields
      const queryFields = http?.query
        ? Object.keys(input).filter(key => key in input)
        : Object.keys(input);

      for (const key of queryFields) {
        // Skip fields that are used as path parameters
        if (key in input && !route.pattern.includes(`{${key}}`) && !route.pattern.includes(`:${key}`)) {
          urlObj.searchParams.set(key, String(input[key]));
        }
      }
      url = urlObj.toString();
    }

    // Handle body for non-GET requests
    if (route.method !== 'GET' && route.method !== 'HEAD') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';

      if (headers['Content-Type'] === 'application/json') {
        body = JSON.stringify(input);
      } else if (headers['Content-Type'] === 'application/x-www-form-urlencoded') {
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(input || {})) {
          formData.append(key, String(value));
        }
        body = formData.toString();
      }
    }

    return {
      url,
      requestOptions: {
        method: route.method,
        headers,
        body
      }
    };
  }

  /**
   * Parse error response from HTTP
   */
  private async parseErrorResponse(response: Response): Promise<Error> {
    try {
      const errorData = await response.json();

      if (errorData.code) {
        return new TitanError({
          code: errorData.code as ErrorCode,
          message: errorData.message || response.statusText
        });
      }

      return new Error(errorData.message || errorData.error || response.statusText);
    } catch {
      return new Error(`HTTP ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Send raw data (handle Netron packets over HTTP)
   */
  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    // Convert to Buffer for easier handling
    const buffer = Buffer.isBuffer(data) ? data :
                  data instanceof Uint8Array ? Buffer.from(data) :
                  Buffer.from(data);

    try {
      // Try to parse as JSON first (handshake messages)
      const str = buffer.toString();
      const msg = JSON.parse(str);

      if (msg.type === 'client-id') {
        // This is the handshake response, ignore for HTTP
        return;
      }

      // Handle other JSON messages
      if (msg.type === 'task' && msg.task === 'abilities') {
        // Respond with server abilities
        this.handleAbilitiesRequest(msg);
        return;
      }
    } catch {
      // Not JSON, probably a binary packet
      try {
        // Decode as Netron packet
        const { decodePacket } = await import('../../packet/index.js');
        const packet = decodePacket(buffer);

        // Check if this is a task packet for abilities
        const packetData: any = packet;
        if (packetData.type === TYPE_TASK && packetData.data && packetData.data[0] === 'abilities') {
          // Handle abilities task packet
          await this.discoverServices();

          // Create abilities response packet
          const abilities = {
            services: this.services,
            allowServiceEvents: false,
            allowEmit: false
          };

          // Emit response packet - use impulse=0 for response
          const { encodePacket, createPacket } = await import('../../packet/index.js');
          const responsePacket = createPacket(packetData.id, 0, packetData.type, abilities);

          const encodedResponse = encodePacket(responsePacket);
          // Emit as message event for remote peer to handle
          this.emit('message', encodedResponse.buffer.slice(encodedResponse.byteOffset, encodedResponse.byteOffset + encodedResponse.byteLength), true);
          return;
        }

        // Handle other packets
        await this.handlePacket(packet);
      } catch (error) {
        // Not a valid packet, ignore
        console.warn('Invalid packet received:', error);
      }
    }
  }

  /**
   * Handle abilities request
   */
  private async handleAbilitiesRequest(msg: any): Promise<void> {
    // Discover services first
    await this.discoverServices();

    // Create abilities response
    const abilities = {
      services: this.services,
      allowServiceEvents: false, // HTTP doesn't support real-time events
      allowEmit: false
    };

    // Emit response as Netron expects
    const response = {
      type: 'task_response',
      id: msg.id,
      result: abilities
    };

    // Emit as message event
    this.emit('message', Buffer.from(JSON.stringify(response)), true);
  }

  /**
   * Handle Netron packet
   */
  private async handlePacket(packet: Packet): Promise<void> {
    // Check packet type using getType() method
    const packetType = packet.getType();
    if (packetType === TYPE_TASK) {
      // Handle task packets
      const taskData = packet.data;
      if (taskData && taskData[0] === 'abilities') {
        await this.handleAbilitiesRequest(packet);
      } else if (taskData && taskData[0] === 'query_interface') {
        await this.handleQueryInterface(packet);
      }
    } else if (packetType === TYPE_CALL) {
      // Handle method call - packet.data contains service, method, args
      await this.handleMethodCall(packet.data);
    }
  }

  /**
   * Handle queryInterface request
   */
  private async handleQueryInterface(packet: any): Promise<void> {
    const serviceName = packet.args?.[0];
    const iface = await this.queryInterface(serviceName);

    // Create response packet
    const response = new Packet(packet.id);
    response.data = {
      type: 'response',
      result: iface
    };

    // Emit response
    this.emit('packet', response);
  }

  /**
   * Handle method call
   */
  private async handleMethodCall(packet: any): Promise<void> {
    try {
      const result = await this.callServiceMethod(
        packet.service || '',
        packet.method || '',
        packet.args || []
      );

      // Create response packet
      const response = new Packet(packet.id);
      response.data = {
        type: 'response',
        result
      };

      // Emit response
      this.emit('packet', response);
    } catch (error: any) {
      // Create error response
      const response = new Packet(packet.id);
      response.data = {
        type: 'error',
        error: error.message || 'Method call failed'
      };

      // Emit error response
      this.emit('packet', response);
    }
  }

  /**
   * Send a packet (handle outgoing packets)
   */
  async sendPacket(packet: Packet): Promise<void> {
    // Handle the packet based on type
    await this.handlePacket(packet);
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
      services: Array.from(this.serviceRoutes.keys())
    };
  }
}