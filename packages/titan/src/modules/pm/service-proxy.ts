/**
 * Service Proxy Handler
 *
 * Creates type-safe proxies for inter-process communication via Netron
 */

import type { NetronClient } from './netron-client.js';
import type { ILogger } from '../logger/logger.types.js';
import type { ServiceProxy, IServiceProxyControl, IProcessMetrics, IHealthStatus } from './types.js';

/**
 * Handler for creating service proxies
 */
export class ServiceProxyHandler<T> {
  constructor(
    private readonly processId: string,
    private readonly netron: NetronClient,
    private readonly serviceName: string,
    private readonly logger: ILogger
  ) {}

  /**
   * Create a type-safe proxy for the service
   */
  createProxy(): ServiceProxy<T> {
    const self = this;

    // Create proxy handler
    const handler: ProxyHandler<any> = {
      get(target, property: string | symbol) {
        // Handle control methods
        if (property === '__processId') {
          return self.processId;
        }

        if (property === '__destroy') {
          return async () => self.destroy();
        }

        if (property === '__getMetrics') {
          return async () => self.getMetrics();
        }

        if (property === '__getHealth') {
          return async () => self.getHealth();
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

        // Return async function that calls remote method
        return async (...args: any[]) => {
          return self.callRemoteMethod(methodName, args);
        };
      },

      has(target, property) {
        return true; // All properties are available
      },

      ownKeys() {
        // Return all possible keys including control methods
        return ['__processId', '__destroy', '__getMetrics', '__getHealth'];
      },

      getOwnPropertyDescriptor() {
        return {
          enumerable: true,
          configurable: true
        };
      }
    };

    // Create and return proxy
    return new Proxy({} as any, handler) as ServiceProxy<T>;
  }

  /**
   * Call a remote method via Netron
   */
  private async callRemoteMethod(methodName: string, args: any[]): Promise<any> {
    try {
      // Check if we're using a mock (for testing)
      if ((this.netron as any).mockCall) {
        return await (this.netron as any).mockCall(methodName, args);
      }

      // Call the method via NetronClient
      const result = await this.netron.call(this.serviceName, methodName, args);

      return result;
    } catch (error) {
      this.logger.error(
        { error, processId: this.processId, methodName, args },
        'Failed to call remote method'
      );
      throw error;
    }
  }

  /**
   * Destroy the proxy and cleanup resources
   */
  private async destroy(): Promise<void> {
    try {
      // Cleanup any resources
      // This might include unsubscribing from events, closing connections, etc.
      this.logger.debug({ processId: this.processId }, 'Destroying service proxy');
    } catch (error) {
      this.logger.error({ error, processId: this.processId }, 'Failed to destroy service proxy');
      throw error;
    }
  }

  /**
   * Get metrics from the remote process
   */
  private async getMetrics(): Promise<IProcessMetrics> {
    try {
      return await this.callRemoteMethod('__getProcessMetrics', []);
    } catch (error) {
      this.logger.error({ error, processId: this.processId }, 'Failed to get process metrics');

      // Return default metrics on error
      return {
        cpu: 0,
        memory: 0,
        requests: 0,
        errors: 0
      };
    }
  }

  /**
   * Get health status from the remote process
   */
  private async getHealth(): Promise<IHealthStatus> {
    try {
      return await this.callRemoteMethod('__getProcessHealth', []);
    } catch (error) {
      this.logger.error({ error, processId: this.processId }, 'Failed to get process health');

      // Return unhealthy status on error
      return {
        status: 'unhealthy',
        checks: [{
          name: 'connectivity',
          status: 'fail',
          message: 'Failed to connect to process'
        }],
        timestamp: Date.now()
      };
    }
  }
}

/**
 * Create a service proxy for async generators (streaming)
 */
export class StreamingServiceProxyHandler<T> {
  constructor(
    private readonly processId: string,
    private readonly netron: NetronClient,
    private readonly serviceName: string,
    private readonly logger: ILogger
  ) {}

  /**
   * Create a proxy that handles async generators
   */
  createStreamingProxy(): ServiceProxy<T> {
    const self = this;

    const handler: ProxyHandler<any> = {
      get(target, property: string | symbol) {
        const methodName = String(property);

        // Check if this is a streaming method (returns AsyncIterable)
        return async function* (...args: any[]) {
          try {
            // Call the streaming method via NetronClient
            const stream = await self.netron.call(self.serviceName, methodName, args);

            // Yield values from the stream
            for await (const value of stream) {
              yield value;
            }
          } catch (error) {
            self.logger.error(
              { error, processId: self.processId, methodName },
              'Streaming method failed'
            );
            throw error;
          }
        };
      }
    };

    return new Proxy({} as any, handler) as ServiceProxy<T>;
  }
}