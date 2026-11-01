/**
 * HTTP Transport Client
 *
 * Provides the client-side implementation for HTTP transport
 * with support for the enhanced interface.
 */

import { HttpConnection } from './connection.js';
import { HttpRemotePeer } from './peer.js';
import type { INetron } from '../../types.js';
import type { TransportOptions } from '../types.js';
import {
  createRequestMessage,
  type HttpRequestMessage,
  type HttpResponseMessage,
  type HttpRequestContext,
  type HttpRequestHints,
} from './types.js';
import { TitanError } from '../../../errors/index.js';
import { parseHttpError } from '../../../errors/transport.js';
import { ErrorCode, getErrorName } from '../../../errors/codes.js';

/**
 * HTTP Transport Client implementation
 */
export class HttpTransportClient {
  private connection?: HttpConnection;
  private peer?: HttpRemotePeer;

  // Path prefix for all endpoints (for reverse proxy support)
  private pathPrefix: string;

  constructor(
    private baseUrl: string,
    private netron?: INetron,
    private options?: TransportOptions
  ) {
    // Ensure base URL doesn't have trailing slash
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

    // Initialize path prefix (normalize to canonical form without leading/trailing slashes)
    this.pathPrefix = this.normalizePathPrefix(options?.pathPrefix);
  }

  /**
   * Normalize path prefix to canonical form (no leading/trailing slashes)
   */
  private normalizePathPrefix(prefix?: string): string {
    if (!prefix) {
      return '';
    }
    return prefix.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\/+/g, '/');
  }

  /**
   * Build full path with prefix for HTTP requests
   */
  private buildPath(endpoint: string): string {
    if (!this.pathPrefix) {
      return endpoint;
    }
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    return `/${this.pathPrefix}${normalizedEndpoint}`;
  }

  /**
   * Initialize the client
   */
  async initialize(): Promise<void> {
    if (!this.connection) {
      this.connection = new HttpConnection(this.baseUrl, this.options);

      if (this.netron) {
        this.peer = new HttpRemotePeer(this.connection, this.netron, this.baseUrl, this.options as any);
        await this.peer.init(true, this.options as any);
      }
    }
  }

  /**
   * Invoke a service method
   */
  async invoke(
    service: string,
    method: string,
    args: any[],
    options?: {
      context?: HttpRequestContext;
      hints?: HttpRequestHints;
    }
  ): Promise<any> {
    const direct = Boolean(options?.context || (options?.hints && Object.keys(options.hints).length));
    if (!direct) await this.initialize();

    // Use peer if available for full Netron compatibility (unless request options require the direct path)
    if (this.peer && !direct) {
      // Get service definition
      const serviceDef = await this.peer.queryInterface(service);
      if (serviceDef && typeof (serviceDef as any)[method] === 'function') {
        return (serviceDef as any)[method](args[0]); // Netron uses single argument
      }
    }

    // Fallback to direct connection (unless request options require the direct path)
    if (this.connection && !direct) {
      const serviceProxy = await this.connection.queryInterface(service);
      if (serviceProxy && typeof serviceProxy[method] === 'function') {
        return serviceProxy[method](args[0]);
      }
    }

    // Direct HTTP request path - supports hints, context, and all HTTP features
    const message = createRequestMessage(service, method, args, {
      context: options?.context,
      hints: options?.hints,
    });

    const response = await this.sendRequest(message);

    if (!response.success) throw parseHttpError(500, response);

    return response.data;
  }

  /**
   * Send HTTP request
   */
  private async sendRequest(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    const invokePath = this.buildPath('/netron/invoke');
    const url = `${this.baseUrl}${invokePath}`;
    const timeout = message.hints?.timeout || this.options?.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...this.options?.headers,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });


      if (!response.ok) {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        let body: unknown;
        try { body = await response.json(); }
        catch (error) {
          if (error instanceof Error && error.name === 'AbortError') throw error;
          body = { message: `HTTP ${response.status}: ${response.statusText}` };
        }
        throw parseHttpError(response.status, body, headers);
      }

      return await response.json();
    } catch (error: unknown) {
      if (error instanceof TitanError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          id: message.id,
          success: false,
          error: {
            code: getErrorName(ErrorCode.REQUEST_TIMEOUT),
            message: `Request timeout after ${timeout}ms`,
          },
        };
      }

      return {
        id: message.id,
        success: false,
        error: {
          code: getErrorName(ErrorCode.INTERNAL_ERROR),
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Close the client connection
   */
  async close(): Promise<void> {
    if (this.peer) {
      await this.peer.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }

  /**
   * Get connection metrics
   */
  getMetrics(): any {
    return {
      baseUrl: this.baseUrl,
      connected: !!this.connection,
      hasPeer: !!this.peer,
      connectionMetrics: this.connection?.getMetrics(),
    };
  }
}
