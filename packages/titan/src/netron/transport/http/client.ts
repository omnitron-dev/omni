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
import { NetronErrors } from '../../../errors/index.js';
import { parseHttpError } from '../../../errors/transport.js';
import { ErrorCode, getErrorName } from '../../../errors/codes.js';

/**
 * HTTP Transport Client implementation
 */
export class HttpTransportClient {
  private connection?: HttpConnection;
  private peer?: HttpRemotePeer;

  constructor(
    private baseUrl: string,
    private netron?: INetron,
    private options?: TransportOptions
  ) {
    // Ensure base URL doesn't have trailing slash
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
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
    // Ensure initialized
    await this.initialize();

    // Use peer if available for full Netron compatibility
    if (this.peer) {
      // Get service definition
      const serviceDef = await this.peer.queryInterface(service);
      if (serviceDef && typeof (serviceDef as any)[method] === 'function') {
        return (serviceDef as any)[method](args[0]); // Netron uses single argument
      }
    }

    // Fallback to direct connection
    if (this.connection) {
      const serviceProxy = await this.connection.queryInterface(service);
      if (serviceProxy && typeof serviceProxy[method] === 'function') {
        return serviceProxy[method](args[0]);
      }
    }

    // Ultimate fallback - direct HTTP request
    const message = createRequestMessage(service, method, args, {
      context: options?.context,
      hints: options?.hints,
    });

    const response = await this.sendRequest(message);

    if (!response.success) {
      const errorMsg = response.error?.message || 'Method invocation failed';
      throw NetronErrors.invalidResponse(service, method, { error: response.error, message: errorMsg });
    }

    return response.data;
  }

  /**
   * Send HTTP request
   */
  private async sendRequest(message: HttpRequestMessage): Promise<HttpResponseMessage> {
    const url = `${this.baseUrl}/netron/invoke`;
    const timeout = message.hints?.timeout || this.options?.timeout || 30000;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Netron-Version': '2.0',
          ...this.options?.headers,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Parse HTTP error to TitanError
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          headers[key] = value;
        });

        try {
          const errorBody = await response.json();
          const titanError = parseHttpError(response.status, errorBody, headers);

          return {
            id: message.id,
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: {
              code: getErrorName(titanError.code),
              message: titanError.message,
              details: titanError.details,
            },
          };
        } catch {
          // Fallback if body parsing fails
          const titanError = parseHttpError(
            response.status,
            {
              error: { message: response.statusText },
            },
            headers
          );

          return {
            id: message.id,
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: {
              code: getErrorName(titanError.code),
              message: titanError.message,
            },
          };
        }
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        return {
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: false,
          error: {
            code: getErrorName(ErrorCode.REQUEST_TIMEOUT),
            message: `Request timeout after ${timeout}ms`,
          },
        };
      }

      return {
        id: message.id,
        version: '2.0',
        timestamp: Date.now(),
        success: false,
        error: {
          code: getErrorName(ErrorCode.INTERNAL_ERROR),
          message: error.message,
        },
      };
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
