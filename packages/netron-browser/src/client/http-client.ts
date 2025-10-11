/**
 * HTTP Transport Client for Netron Browser
 *
 * Provides HTTP-based RPC communication with the Netron server
 */

import type {
  HttpRequestMessage,
  HttpResponseMessage,
  RequestContext,
  RequestHints,
  ConnectionMetrics,
  ConnectionState,
} from '../types/index.js';
import { createRequestMessage, normalizeUrl } from '../utils/index.js';
// Errors are handled inline in this implementation

/**
 * HTTP client options
 */
export interface HttpClientOptions {
  /**
   * Base URL for the Netron server
   */
  url: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * Enable request retry
   * @default false
   */
  retry?: boolean;

  /**
   * Maximum retry attempts
   * @default 3
   */
  maxRetries?: number;
}

/**
 * HTTP Transport Client implementation
 */
export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private retry: boolean;
  private maxRetries: number;
  private state: ConnectionState = 'disconnected' as ConnectionState;
  private metrics = {
    requestsSent: 0,
    responsesReceived: 0,
    errors: 0,
    latencies: [] as number[],
  };

  constructor(options: HttpClientOptions) {
    this.baseUrl = normalizeUrl(options.url);
    this.timeout = options.timeout ?? 30000;
    this.headers = options.headers ?? {};
    this.retry = options.retry ?? false;
    this.maxRetries = options.maxRetries ?? 3;
  }

  /**
   * Initialize the client
   */
  async connect(): Promise<void> {
    this.state = 'connecting' as ConnectionState;
    // HTTP client doesn't need explicit connection
    this.state = 'connected' as ConnectionState;
  }

  /**
   * Invoke a service method
   */
  async invoke(
    service: string,
    method: string,
    args: any[],
    options?: {
      context?: RequestContext;
      hints?: RequestHints;
    }
  ): Promise<any> {
    const message = createRequestMessage(service, method, args, options);
    const response = await this.sendRequest(message);

    if (!response.success) {
      throw new Error(response.error?.message || 'Method invocation failed');
    }

    return response.data;
  }

  /**
   * Send HTTP request
   */
  private async sendRequest(
    message: HttpRequestMessage,
    retryCount = 0
  ): Promise<HttpResponseMessage> {
    const url = `${this.baseUrl}/netron/invoke`;
    const timeout = message.hints?.timeout || this.timeout;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      this.metrics.requestsSent++;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Netron-Version': '2.0',
          ...this.headers,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;
      this.metrics.latencies.push(latency);
      this.metrics.responsesReceived++;

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          return errorData;
        } catch {
          // Return generic error
          this.metrics.errors++;
          return {
            id: message.id,
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: {
              code: 'HTTP_ERROR',
              message: `HTTP ${response.status}: ${response.statusText}`,
            },
          };
        }
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.metrics.errors++;

      // Retry logic
      if (this.retry && retryCount < this.maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendRequest(message, retryCount + 1);
      }

      if (error.name === 'AbortError') {
        return {
          id: message.id,
          version: '2.0',
          timestamp: Date.now(),
          success: false,
          error: {
            code: 'TIMEOUT',
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
          code: 'NETWORK_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Close the client connection
   */
  async disconnect(): Promise<void> {
    this.state = 'disconnected' as ConnectionState;
  }

  /**
   * Get connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    const avgLatency =
      this.metrics.latencies.length > 0
        ? this.metrics.latencies.reduce((a, b) => a + b, 0) /
          this.metrics.latencies.length
        : undefined;

    return {
      id: 'http-client',
      url: this.baseUrl,
      state: this.state,
      transport: 'http',
      requestsSent: this.metrics.requestsSent,
      responsesReceived: this.metrics.responsesReceived,
      errors: this.metrics.errors,
      avgLatency,
    };
  }
}
