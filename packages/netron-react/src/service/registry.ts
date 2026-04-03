/**
 * ServiceRegistry - Manages service proxies and type generation
 */

import type { NetronReactClient } from '../core/client.js';
import type { ServiceOptions, TypedServiceProxy, Middleware, MiddlewareContext } from '../core/types.js';

/**
 * Service registration entry
 */
interface ServiceEntry {
  name: string;
  version?: string;
  options: ServiceOptions;
  proxy?: TypedServiceProxy<any>;
}

/**
 * ServiceRegistry
 *
 * Central registry for managing service proxies and their configurations.
 */
export class ServiceRegistry {
  private client: NetronReactClient;
  private services = new Map<string, ServiceEntry>();
  private globalMiddleware: Middleware[] = [];

  constructor(client: NetronReactClient) {
    this.client = client;
  }

  // ============================================================================
  // Registration
  // ============================================================================

  /**
   * Register a service
   */
  register(name: string, options: ServiceOptions = {}): void {
    const [serviceName, version] = this.parseServiceName(name);

    this.services.set(name, {
      name: serviceName,
      version,
      options,
    });
  }

  /**
   * Register multiple services
   */
  registerMany(services: Array<{ name: string; options?: ServiceOptions }>): void {
    for (const { name, options } of services) {
      this.register(name, options);
    }
  }

  /**
   * Check if service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  // ============================================================================
  // Service Access
  // ============================================================================

  /**
   * Get a typed service proxy
   */
  getService<T>(name: string, options?: ServiceOptions): TypedServiceProxy<T> {
    // Get or create registration
    let entry = this.services.get(name);
    if (!entry) {
      const [serviceName, version] = this.parseServiceName(name);
      entry = {
        name: serviceName,
        version,
        options: options ?? {},
      };
      this.services.set(name, entry);
    }

    // Merge options
    const mergedOptions = { ...entry.options, ...options };

    // Create proxy if not exists
    if (!entry.proxy) {
      entry.proxy = this.createServiceProxy<T>(name, mergedOptions);
    }

    return entry.proxy as TypedServiceProxy<T>;
  }

  /**
   * Create a service proxy
   */
  private createServiceProxy<T>(serviceName: string, options: ServiceOptions): TypedServiceProxy<T> {
    const invoke = this.invoke.bind(this);

    return new Proxy({} as TypedServiceProxy<T>, {
      get(_target, methodName: string | symbol) {
        if (typeof methodName === 'symbol') {
          return undefined;
        }

        return {
          // Direct call with middleware
          call: async (...args: unknown[]) => invoke(serviceName, methodName, args, options),

          // Query hook factory - returns function that creates query config
          useQuery: (args: unknown[], queryOptions?: any) =>
            // This returns an object that can be passed to useQuery
            ({
              queryKey: [serviceName, methodName, ...args],
              queryFn: () => self.invoke(serviceName, methodName, args, options),
              ...queryOptions,
            }),
          // Mutation hook factory - returns function that creates mutation config
          useMutation: (mutationOptions?: any) => ({
            mutationFn: (variables: unknown) => {
              const args = Array.isArray(variables) ? variables : [variables];
              return self.invoke(serviceName, methodName, args, options);
            },
            mutationKey: [serviceName, methodName],
            ...mutationOptions,
          }),
        };
      },
    });
  }

  /**
   * Invoke a service method with middleware
   */
  private async invoke(
    serviceName: string,
    method: string,
    args: unknown[],
    options: ServiceOptions
  ): Promise<unknown> {
    // Build middleware chain
    const middleware = [...this.globalMiddleware, ...(options.middleware ?? [])];

    // Create context
    const context: MiddlewareContext = {
      service: serviceName,
      method,
      args,
      metadata: new Map(),
      timing: {
        start: performance.now(),
      },
    };

    // Execute middleware chain
    const executeMiddleware = async (index: number): Promise<unknown> => {
      if (index < middleware.length) {
        return middleware[index]!(context, () => executeMiddleware(index + 1));
      }

      // End of chain - execute actual call
      return this.client.invoke(serviceName, method, args, {
        timeout: options.timeout,
      });
    };

    try {
      const result = await executeMiddleware(0);
      context.timing.end = performance.now();
      return result;
    } catch (error) {
      context.timing.end = performance.now();
      throw error;
    }
  }

  // ============================================================================
  // Middleware
  // ============================================================================

  /**
   * Add global middleware
   */
  use(middleware: Middleware): void {
    this.globalMiddleware.push(middleware);
  }

  /**
   * Remove global middleware
   */
  remove(middleware: Middleware): void {
    const index = this.globalMiddleware.indexOf(middleware);
    if (index !== -1) {
      this.globalMiddleware.splice(index, 1);
    }
  }

  /**
   * Clear all global middleware
   */
  clearMiddleware(): void {
    this.globalMiddleware = [];
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Parse service name with optional version
   */
  private parseServiceName(name: string): [string, string | undefined] {
    const atIndex = name.lastIndexOf('@');
    if (atIndex > 0) {
      return [name.slice(0, atIndex), name.slice(atIndex + 1)];
    }
    return [name, undefined];
  }

  /**
   * Get all registered service names
   */
  getRegisteredServices(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * Get service options
   */
  getServiceOptions(name: string): ServiceOptions | undefined {
    return this.services.get(name)?.options;
  }

  /**
   * Clear all registrations
   */
  clear(): void {
    this.services.clear();
  }
}
