/**
 * HTTP Transport implementation for Netron
 * Provides transparent HTTP transport while maintaining the Netron service paradigm
 */

import type {
  ITransport,
  ITransportConnection,
  ITransportServer,
  TransportCapabilities,
  TransportOptions,
  TransportAddress
} from '../types.js';
import { HttpServer } from './server.js';
import { HttpConnection } from './connection.js';
import { NetronErrors, Errors } from '../../../errors/index.js';

/**
 * HTTP Transport implementation
 * Enables services to be exposed via HTTP REST endpoints while maintaining
 * the same queryInterface/exposeService API as WebSocket transport
 */
export class HttpTransport implements ITransport {
  /**
   * Transport name identifier
   */
  readonly name = 'http';

  /**
   * Transport capabilities
   */
  readonly capabilities: TransportCapabilities = {
    streaming: true,      // Via Server-Sent Events (SSE) or chunked encoding
    bidirectional: false, // HTTP is request-response
    binary: false,        // HTTP is a text protocol (headers + status line), even though it can carry binary payloads
    reconnection: false,  // HTTP is stateless
    multiplexing: true,   // Multiple requests over same connection (HTTP/1.1 keep-alive, HTTP/2)
    server: true          // Can create HTTP servers
  };

  /**
   * Detect current runtime environment
   */
  private detectRuntime(): 'node' | 'bun' | 'deno' | 'browser' {
    if (typeof window !== 'undefined') {
      return 'browser';
    }
    // @ts-expect-error - Bun global may not be available
    if (typeof globalThis.Bun !== 'undefined') {
      return 'bun';
    }
    if (typeof (global as any).Deno !== 'undefined') {
      return 'deno';
    }
    return 'node';
  }

  /**
   * Connect to a remote HTTP endpoint
   * Creates an HTTP client that speaks Netron protocol over HTTP
   */
  async connect(address: string, options?: TransportOptions): Promise<ITransportConnection> {
    if (!this.isValidAddress(address)) {
      throw Errors.badRequest(`Invalid HTTP address: ${address}`, { address });
    }

    // Feature flag for using new direct HTTP connection without packet protocol
    const useDirectHttp = (options as any)?.useDirectHttp ||
      process.env['NETRON_HTTP_DIRECT'] === 'true' ||
      false;

    // Always use direct HTTP connection (v2.0) as packet-based is removed
    const connection = new HttpConnection(address, options);

    // Try to verify the server is reachable by doing a discovery request
    try {
      const response = await fetch(`${address}/netron/discovery`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Netron-Version': useDirectHttp ? '2.0' : '1.0',
          ...options?.headers
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      // If server doesn't exist or returns an error (except 404), throw
      if (!response.ok && response.status !== 404) {
        throw NetronErrors.connectionFailed('http', address, new Error(`Server returned ${response.status} ${response.statusText}`));
      }
    } catch (error: any) {
      // Network error - server is not reachable
      if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
        throw NetronErrors.connectionFailed('http', address, error);
      }
      // Re-throw other errors
      throw error;
    }

    return connection;
  }

  /**
   * Create an HTTP server
   * Creates an HTTP server that understands Netron services
   */
  async createServer(options?: TransportOptions): Promise<ITransportServer> {
    if (!this.capabilities.server) {
      throw Errors.notImplemented('HTTP transport server capability is disabled');
    }

    const server = new HttpServer(options);
    // Don't call listen() here - Netron will call it
    // This matches the behavior of WebSocketTransport
    return server;
  }

  /**
   * Check if an address is valid for HTTP transport
   */
  isValidAddress(address: string): boolean {
    try {
      const url = new URL(address);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * Parse an HTTP address into components
   */
  parseAddress(address: string): TransportAddress {
    if (!this.isValidAddress(address)) {
      throw Errors.badRequest(`Invalid HTTP address: ${address}`, { address });
    }

    const url = new URL(address);

    // Determine default port based on protocol
    const defaultPort = url.protocol === 'https:' ? 443 : 80;
    const port = url.port ? parseInt(url.port, 10) : defaultPort;

    // Extract search params as a plain object
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    return {
      protocol: url.protocol.slice(0, -1), // Remove trailing colon
      host: url.hostname,
      port,
      path: url.pathname,
      params: Object.keys(params).length > 0 ? params : undefined
    };
  }

  /**
   * Format an address from components
   */
  formatAddress(address: TransportAddress): string {
    const protocol = address.protocol || 'http';
    const host = address.host || 'localhost';
    const port = address.port;
    const path = address.path || '/';

    // Build base URL
    let url = `${protocol}://${host}`;

    // Add port if it's not the default for the protocol
    const defaultPort = protocol === 'https' ? 443 : 80;
    if (port && port !== defaultPort) {
      url += `:${port}`;
    }

    // Add path
    url += path;

    // Add query parameters
    if (address.params && Object.keys(address.params).length > 0) {
      const params = new URLSearchParams(address.params);
      url += `?${params.toString()}`;
    }

    return url;
  }

  /**
   * Get transport-specific metrics
   */
  getMetrics(): any {
    return {
      transport: 'http',
      runtime: this.detectRuntime(),
      capabilities: this.capabilities
    };
  }
}