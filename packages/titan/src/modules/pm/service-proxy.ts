/**
 * Service Proxy Handler
 *
 * Creates type-safe proxies for inter-process communication via Netron
 * with support for streaming via AsyncIterables.
 *
 * Production-grade implementation with proper timeout handling and cleanup.
 */

import { Errors } from '../../errors/index.js';
import type { NetronClient } from './netron-client.js';
import type { ILogger } from '../logger/logger.types.js';
import type { ServiceProxy, IProcessMetrics, IHealthStatus } from './types.js';

/**
 * Options for the service proxy handler
 */
export interface IServiceProxyOptions {
  /**
   * Default timeout for method calls in milliseconds (default: 30000)
   */
  requestTimeout?: number;
  /**
   * Timeout for streaming methods in milliseconds between yields (default: 60000)
   */
  streamTimeout?: number;
}

const DEFAULT_OPTIONS: Required<IServiceProxyOptions> = {
  requestTimeout: 30000,
  streamTimeout: 60000,
};

/**
 * Handler for creating service proxies
 */
export class ServiceProxyHandler<T> {
  private readonly options: Required<IServiceProxyOptions>;
  private activeStreams = new Set<AsyncGenerator<unknown>>();
  private isDestroyed = false;
  /** Cache for streaming method detection to avoid repeated string operations */
  private readonly streamingMethodCache = new Map<string, boolean>();

  constructor(
    private readonly processId: string,
    private readonly netron: NetronClient | null | undefined,
    private readonly serviceName: string,
    private readonly logger: ILogger,
    options: IServiceProxyOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Create a type-safe proxy for the service
   */
  createProxy(): ServiceProxy<T> {
    const self = this;
    const processId = this.processId;

    // Create proxy handler
    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, property: string | symbol) {
        // Handle control methods
        if (property === '__processId') {
          return processId;
        }

        if (property === '__destroy') {
          return () => self.destroy();
        }

        if (property === '__getMetrics') {
          return () => self.getMetrics();
        }

        if (property === '__getHealth') {
          return () => self.getHealth();
        }

        // Prevent proxy from being treated as a Promise
        if (property === 'then' || property === 'catch' || property === 'finally') {
          return undefined;
        }

        // Handle Symbol properties
        if (typeof property === 'symbol') {
          return undefined;
        }

        // Convert property to string
        const methodName = String(property);

        // Check if this should be a streaming method
        // Methods starting with 'stream' or containing 'Stream' return AsyncIterables
        if (self.isStreamingMethod(methodName)) {
          return async function* (...args: unknown[]) {
            yield* self.callStreamingMethod(methodName, args);
          };
        }

        // Return async function that calls remote method
        return async (...args: unknown[]) => self.callRemoteMethod(methodName, args);
      },

      has(_target, property) {
        // Report that we have the special control methods
        const controlMethods = ['__processId', '__destroy', '__getMetrics', '__getHealth'];
        if (typeof property === 'string' && controlMethods.includes(property)) {
          return true;
        }
        // All other methods are assumed to be available
        return typeof property === 'string';
      },

      ownKeys() {
        // Return all possible keys including control methods
        return ['__processId', '__destroy', '__getMetrics', '__getHealth'];
      },

      getOwnPropertyDescriptor() {
        return {
          enumerable: true,
          configurable: true,
        };
      },
    };

    // Create and return proxy
    return new Proxy({} as Record<string, unknown>, handler) as ServiceProxy<T>;
  }

  /**
   * Check if a method name indicates a streaming method.
   * Results are cached to avoid repeated string operations on frequently called methods.
   */
  private isStreamingMethod(methodName: string): boolean {
    let isStreaming = this.streamingMethodCache.get(methodName);
    if (isStreaming === undefined) {
      isStreaming = methodName.startsWith('stream') || methodName.toLowerCase().includes('stream');
      this.streamingMethodCache.set(methodName, isStreaming);
    }
    return isStreaming;
  }

  /**
   * Call a remote method via Netron with timeout
   */
  private async callRemoteMethod(methodName: string, args: unknown[]): Promise<unknown> {
    if (this.isDestroyed) {
      throw Errors.conflict('Service proxy has been destroyed');
    }

    if (!this.netron) {
      throw Errors.internal('NetronClient not available for service proxy');
    }

    try {
      // Check if we're using a mock (for testing)
      const netronAny = this.netron as unknown as { mockCall?: (method: string, args: unknown[]) => Promise<unknown> };
      if (netronAny.mockCall) {
        return await netronAny.mockCall(methodName, args);
      }

      // Call the method via NetronClient with timeout
      const result = await this.withTimeout(
        this.netron.call(this.serviceName, methodName, args),
        this.options.requestTimeout,
        `${this.serviceName}.${methodName}`
      );

      return result;
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          processId: this.processId,
          methodName,
        },
        'Failed to call remote method'
      );
      throw error;
    }
  }

  /**
   * Call a streaming method via Netron with timeout between yields
   */
  private async *callStreamingMethod(methodName: string, args: unknown[]): AsyncGenerator<unknown> {
    if (this.isDestroyed) {
      throw Errors.conflict('Service proxy has been destroyed');
    }

    if (!this.netron) {
      throw Errors.internal('NetronClient not available for service proxy');
    }

    let stream: AsyncIterable<unknown> | null = null;

    try {
      // Check if we're using a mock (for testing)
      const netronAny = this.netron as unknown as { mockStream?: (method: string, args: unknown[]) => AsyncIterable<unknown> };
      if (netronAny.mockStream) {
        yield* netronAny.mockStream(methodName, args);
        return;
      }

      // Call the streaming method via NetronClient
      const result = await this.withTimeout(
        this.netron.call(this.serviceName, methodName, args),
        this.options.requestTimeout,
        `${this.serviceName}.${methodName}`
      );

      // Check if result is an async iterable
      const resultAny = result as unknown;
      if (resultAny && typeof resultAny === 'object' && Symbol.asyncIterator in resultAny) {
        stream = resultAny as AsyncIterable<unknown>;

        // Track this stream for cleanup
        const generator = this.streamWithTimeout(stream, methodName);
        this.activeStreams.add(generator);

        try {
          yield* generator;
        } finally {
          this.activeStreams.delete(generator);
        }
      } else {
        // If not a stream, yield the single result
        yield result;
      }
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          processId: this.processId,
          methodName,
        },
        'Failed to call streaming method'
      );
      throw error;
    }
  }

  /**
   * Wrap a stream with timeout between yields
   */
  private async *streamWithTimeout(
    stream: AsyncIterable<unknown>,
    methodName: string
  ): AsyncGenerator<unknown> {
    const iterator = stream[Symbol.asyncIterator]();

    try {
      while (true) {
        const result = await this.withTimeout(
          iterator.next(),
          this.options.streamTimeout,
          `${this.serviceName}.${methodName} (stream)`
        );

        if (result.done) {
          return result.value;
        }

        yield result.value;
      }
    } finally {
      // Ensure iterator is properly closed
      if (iterator.return) {
        try {
          await iterator.return(undefined);
        } catch (error) {
          this.logger.debug(
            { error, processId: this.processId, methodName },
            'Error closing stream iterator'
          );
        }
      }
    }
  }

  /**
   * Wrap a promise with timeout
   */
  private async withTimeout<R>(promise: Promise<R>, ms: number, operation: string): Promise<R> {
    let timeoutHandle: NodeJS.Timeout | null = null;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(Errors.timeout(operation, ms));
      }, ms);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Destroy the proxy and cleanup resources
   */
  private async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.logger.debug({ processId: this.processId }, 'Destroying service proxy');

    // Cancel all active streams
    for (const stream of this.activeStreams) {
      try {
        await stream.return(undefined);
      } catch (error) {
        this.logger.debug(
          { error, processId: this.processId },
          'Error closing active stream during destroy'
        );
      }
    }
    this.activeStreams.clear();

    // Call remote destroy method if available
    try {
      await this.callRemoteMethodUnchecked('__destroy', []);
    } catch (error) {
      // Ignore errors during destroy - process may already be gone
      this.logger.debug(
        { error: error instanceof Error ? error.message : String(error), processId: this.processId },
        'Error calling remote destroy'
      );
    }
  }

  /**
   * Call remote method without destroy check (for internal use during destroy)
   */
  private async callRemoteMethodUnchecked(methodName: string, args: unknown[]): Promise<unknown> {
    if (!this.netron) {
      throw Errors.internal('NetronClient not available for service proxy');
    }

    const netronAny = this.netron as unknown as { mockCall?: (method: string, args: unknown[]) => Promise<unknown> };
    if (netronAny.mockCall) {
      return await netronAny.mockCall(methodName, args);
    }
    return await this.netron.call(this.serviceName, methodName, args);
  }

  /**
   * Get metrics from the remote process
   */
  private async getMetrics(): Promise<IProcessMetrics> {
    try {
      const result = await this.callRemoteMethod('__getProcessMetrics', []);
      return result as IProcessMetrics;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error), processId: this.processId },
        'Failed to get process metrics'
      );

      // Return error-indicating metrics (negative values indicate collection failure)
      return {
        cpu: -1,
        memory: -1,
        requests: -1,
        errors: -1,
      };
    }
  }

  /**
   * Get health status from the remote process
   */
  private async getHealth(): Promise<IHealthStatus> {
    try {
      const result = await this.callRemoteMethod('__getProcessHealth', []);
      return result as IHealthStatus;
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : String(error), processId: this.processId },
        'Failed to get process health'
      );

      // Return unhealthy status on error with error details
      return {
        status: 'unhealthy',
        checks: [
          {
            name: 'connectivity',
            status: 'fail',
            message: error instanceof Error ? error.message : 'Failed to connect to process',
          },
        ],
        timestamp: Date.now(),
      };
    }
  }
}

/**
 * Create a service proxy for async generators (streaming)
 *
 * @deprecated Use ServiceProxyHandler which handles both regular and streaming methods
 */
export class StreamingServiceProxyHandler<T> {
  private readonly options: Required<IServiceProxyOptions>;

  constructor(
    private readonly processId: string,
    private readonly netron: NetronClient,
    private readonly serviceName: string,
    private readonly logger: ILogger,
    options: IServiceProxyOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Create a proxy that handles async generators
   */
  createStreamingProxy(): ServiceProxy<T> {
    const netron = this.netron;
    const serviceName = this.serviceName;
    const logger = this.logger;
    const processId = this.processId;
    const streamTimeout = this.options.streamTimeout;

    const handler: ProxyHandler<Record<string, unknown>> = {
      get(_target, property: string | symbol) {
        if (typeof property === 'symbol') {
          return undefined;
        }

        const methodName = String(property);

        // Check if this is a streaming method (returns AsyncIterable)
        return async function* (...args: unknown[]) {
          try {
            // Call the streaming method via NetronClient
            const stream = await netron.call(serviceName, methodName, args);

            // Handle the stream
            const streamAny = stream as unknown;
            if (streamAny && typeof streamAny === 'object' && Symbol.asyncIterator in streamAny) {
              const iterator = (streamAny as AsyncIterable<unknown>)[Symbol.asyncIterator]();

              try {
                while (true) {
                  // Add timeout between yields
                  const result = await Promise.race([
                    iterator.next(),
                    new Promise<never>((_, reject) => {
                      setTimeout(() => {
                        reject(Errors.timeout(`${serviceName}.${methodName} (stream)`, streamTimeout));
                      }, streamTimeout);
                    }),
                  ]);

                  if (result.done) {
                    return result.value;
                  }

                  yield result.value;
                }
              } finally {
                if (iterator.return) {
                  try {
                    await iterator.return(undefined);
                  } catch {
                    // Ignore cleanup errors
                  }
                }
              }
            } else {
              yield stream;
            }
          } catch (error) {
            logger.error(
              { error: error instanceof Error ? error.message : String(error), processId, methodName },
              'Streaming method failed'
            );
            throw error;
          }
        };
      },
    };

    return new Proxy({} as Record<string, unknown>, handler) as ServiceProxy<T>;
  }
}
