/**
 * Multi-Backend Client - Main Orchestrator
 *
 * Provides a unified interface for accessing multiple backend servers
 * through an API gateway with:
 * - Service routing to appropriate backends
 * - Shared authentication and middleware
 * - Type-safe service proxies
 * - Connection lifecycle management
 *
 * @module client/multi-backend-client
 */

import { BackendPool, type BackendPoolOptions } from './backend-pool.js';
import { ServiceRouter } from '../routing/service-router.js';
import { MiddlewarePipeline } from '../middleware/pipeline.js';
import type {
  BackendSchema,
  MultiBackendClientOptions,
  IMultiBackendClient,
  IBackendClient,
  TypedServiceProxy,
  MultiBackendMetrics,
  InvokeOptions,
} from '../types/multi-backend.js';
import type { IMiddlewareManager, MiddlewareFunction, MiddlewareConfig, MiddlewareStage } from '../middleware/types.js';

/**
 * Multi-Backend Client implementation
 *
 * Main orchestrator for managing multiple backend connections.
 * Supports typed property access via Proxy for clean API:
 *
 * @example
 * ```typescript
 * // Basic usage
 * const client = createMultiBackendClient({
 *   baseUrl: 'https://api.example.com',
 *   backends: {
 *     core: { path: '/core' },
 *     storage: { path: '/storage' },
 *     chat: { path: '/chat', transport: 'websocket' },
 *   },
 *   defaultBackend: 'core',
 * });
 *
 * // Connect to all backends
 * await client.connect();
 *
 * // Access via backend
 * const users = client.backend('core').service<UserService>('users');
 * const user = await users.getById('123');
 *
 * // Access via auto-routing
 * const files = client.service<FileService>('files');
 *
 * // Direct invoke
 * const result = await client.invoke('core', 'users', 'getById', ['123']);
 *
 * // Typed property access (via Proxy)
 * const user = await client.core.users.getById('123');
 * ```
 */
export class MultiBackendClient<T extends BackendSchema = BackendSchema> implements IMultiBackendClient<T> {
  private baseUrl: string;
  private pool: BackendPool;
  private router: ServiceRouter;
  private middleware: IMiddlewareManager;
  private defaultBackend: string;
  private backendNames: string[];

  constructor(options: MultiBackendClientOptions<T>) {
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
    this.backendNames = Object.keys(options.backends);
    this.defaultBackend = (options.defaultBackend as string) || this.backendNames[0] || '';

    // Validate default backend exists
    if (this.defaultBackend && !this.backendNames.includes(this.defaultBackend)) {
      throw new Error(`Default backend '${this.defaultBackend}' not found in backends configuration`);
    }

    // Create shared middleware pipeline
    this.middleware = new MiddlewarePipeline();

    // Register shared middleware from options
    if (options.shared?.middleware) {
      for (const config of options.shared.middleware) {
        // Create a no-op middleware function if not provided
        const middlewareFn: MiddlewareFunction = async (_ctx, next) => {
          await next();
        };
        this.middleware.use(middlewareFn, config);
      }
    }

    // Create backend pool
    const poolOptions: BackendPoolOptions = {
      baseUrl: this.baseUrl,
      backends: options.backends as Record<string, any>,
      auth: options.shared?.auth,
      middleware: this.middleware,
      defaultTimeout: options.shared?.timeout,
      defaultHeaders: options.shared?.headers,
    };
    this.pool = new BackendPool(poolOptions);

    // Create service router
    this.router = new ServiceRouter(options.routing || {}, this.defaultBackend, this.backendNames);
  }

  /**
   * Get a specific backend client
   *
   * @param name - Backend name
   * @returns Backend client instance
   */
  backend<K extends keyof T>(name: K): IBackendClient<T[K]> {
    return this.pool.get(name as string) as IBackendClient<T[K]>;
  }

  /**
   * Get a service with automatic backend routing
   *
   * @param serviceName - Service name (can be qualified as 'backend.service')
   * @returns Typed service proxy
   */
  service<S>(serviceName: string): TypedServiceProxy<S> {
    // Resolve backend for this service
    const backendName = this.router.resolve(serviceName);
    const actualServiceName = this.router.getServiceName(serviceName);

    // Get backend client
    const backendClient = this.pool.get(backendName);

    // Return service proxy
    return backendClient.service<S>(actualServiceName);
  }

  /**
   * Direct invoke with explicit backend
   *
   * @param backend - Backend name
   * @param service - Service name
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Invoke options
   * @returns Promise resolving to method result
   */
  async invoke<R = any>(
    backend: string,
    service: string,
    method: string,
    args: any[] = [],
    options?: InvokeOptions
  ): Promise<R> {
    const backendClient = this.pool.get(backend);
    return await backendClient.invoke<R>(service, method, args, options);
  }

  /**
   * Get aggregated metrics across all backends
   */
  getMetrics(): MultiBackendMetrics {
    return this.pool.getAggregatedMetrics();
  }

  /**
   * Check if specific backend is connected
   *
   * @param backend - Backend name (optional, checks all if not provided)
   */
  isConnected(backend?: string): boolean {
    if (backend) {
      return this.pool.isConnected(backend);
    }
    return this.pool.allConnected();
  }

  /**
   * Connect to specific or all backends
   *
   * @param backend - Backend name (optional, connects all if not provided)
   */
  async connect(backend?: string): Promise<void> {
    if (backend) {
      await this.pool.connect(backend);
    } else {
      await this.pool.connectAll();
    }
  }

  /**
   * Disconnect from specific or all backends
   *
   * @param backend - Backend name (optional, disconnects all if not provided)
   */
  async disconnect(backend?: string): Promise<void> {
    if (backend) {
      await this.pool.disconnect(backend);
    } else {
      await this.pool.disconnectAll();
    }
  }

  /**
   * Get shared middleware manager
   */
  getMiddleware(): IMiddlewareManager {
    return this.middleware;
  }

  /**
   * Destroy client and release all resources
   */
  async destroy(): Promise<void> {
    await this.pool.destroy();
    this.middleware.clear();
  }

  /**
   * Get the service router
   */
  getRouter(): ServiceRouter {
    return this.router;
  }

  /**
   * Get the backend pool
   */
  getPool(): BackendPool {
    return this.pool;
  }

  /**
   * Get all backend names
   */
  getBackendNames(): string[] {
    return [...this.backendNames];
  }

  /**
   * Get the default backend name
   */
  getDefaultBackend(): string {
    return this.defaultBackend;
  }

  /**
   * Get the base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Use middleware globally
   *
   * @param middleware - Middleware function
   * @param config - Middleware configuration
   * @param stage - Middleware stage
   */
  use(middleware: MiddlewareFunction, config?: Partial<MiddlewareConfig>, stage?: MiddlewareStage): this {
    this.middleware.use(middleware, config, stage);
    return this;
  }

  /**
   * Get health status of all backends
   */
  async getHealth(): Promise<Map<string, boolean>> {
    return await this.pool.checkAllHealth();
  }

  /**
   * Get list of healthy backends
   */
  getHealthyBackends(): string[] {
    return this.pool.getHealthyBackends();
  }

  /**
   * Get list of unhealthy backends
   */
  getUnhealthyBackends(): string[] {
    return this.pool.getUnhealthyBackends();
  }
}

/**
 * Create a MultiBackendClient instance with optional typed property access
 *
 * @param options - Multi-backend client options
 * @returns Multi-backend client instance (with Proxy for typed access)
 *
 * @example
 * ```typescript
 * // Define backend schema for type safety
 * interface MyBackendSchema {
 *   core: {
 *     users: UserService;
 *     auth: AuthService;
 *   };
 *   storage: {
 *     files: FileService;
 *   };
 * }
 *
 * const client = createMultiBackendClient<MyBackendSchema>({
 *   baseUrl: 'https://api.example.com',
 *   backends: {
 *     core: { path: '/core' },
 *     storage: { path: '/storage' },
 *   },
 * });
 *
 * // Explicit access (always works)
 * const users = client.backend('core').service<UserService>('users');
 *
 * // Typed property access via Proxy
 * const user = await client.core.users.getById('123');
 * ```
 */
export function createMultiBackendClient<T extends BackendSchema = BackendSchema>(
  options: MultiBackendClientOptions<T>
): IMultiBackendClient<T> & {
  [K in keyof T]: {
    [S in keyof T[K]]: TypedServiceProxy<T[K][S]>;
  };
} {
  const client = new MultiBackendClient<T>(options);

  // Create Proxy for typed property access (e.g., client.core.users)
  return new Proxy(client as any, {
    get(target: MultiBackendClient<T>, prop: string | symbol) {
      // Return actual methods/properties first
      if (prop in target || typeof prop === 'symbol') {
        const value = (target as any)[prop];
        if (typeof value === 'function') {
          return value.bind(target);
        }
        return value;
      }

      // Check if prop is a backend name
      const backendNames = target.getBackendNames();
      if (backendNames.includes(prop as string)) {
        // Return a Proxy for service access
        return new Proxy(
          {},
          {
            get(_serviceTarget, serviceProp: string | symbol) {
              if (typeof serviceProp === 'symbol') {
                return undefined;
              }

              // Return service proxy
              const backendClient = target.backend(prop as keyof T);
              return backendClient.service(serviceProp);
            },
          }
        );
      }

      return undefined;
    },
  });
}
