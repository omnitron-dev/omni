/**
 * Titan Simple API
 *
 * Zero-configuration, minimal cognitive load API for Titan Framework
 * This is the recommended way to use Titan for most applications
 */

import { Application } from './application.js';
import { Module, Injectable } from '../decorators/index.js';
import type { IApplicationOptions, IModule } from '../types.js';
import { Token, createToken as nexusCreateToken } from '../nexus/index.js';
import { TitanError, ErrorCode } from '../errors/index.js';

/**
 * Create and start a Titan application with zero configuration
 *
 * @example
 * ```typescript
 * // Minimal application
 * const app = await titan();
 *
 * // With a module
 * @Module()
 * class AppModule {}
 *
 * const app = await titan(AppModule);
 *
 * // With options
 * const app = await titan({
 *   port: 3000,
 *   redis: 'localhost:6379'
 * });
 * ```
 */
export async function titan(input?: any | IApplicationOptions): Promise<Application> {
  let options: IApplicationOptions = {};
  let rootModule: any = null;

  // Determine input type
  if (typeof input === 'function') {
    // It's a module class
    rootModule = input;
  } else if (input && typeof input === 'object') {
    // It's options
    options = normalizeOptions(input);
  }

  // Create application with smart defaults
  const app = await Application.create({
    name: options.name || 'titan-app',
    version: options.version || '1.0.0',

    // Automatic core modules
    disableCoreModules: false,

    // Smart module discovery
    autoDiscovery: true,
    scanPaths: options['scanPaths'] || ['./modules', './src/modules'],

    // Include root module if provided
    modules: rootModule ? [rootModule] : [],

    // Smart logging
    logger: options['logger'] ?? (process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty'),

    // Graceful shutdown by default
    gracefulShutdown: options['gracefulShutdown'] ?? true,
    gracefulShutdownTimeout: options['gracefulShutdownTimeout'] ?? 30000,

    ...options,
  });

  // Store app globally for simple API auto-registration
  (global as any).__titanApp = app;

  // Auto-start the application
  await app.start();

  return app;
}

/**
 * Normalize simple options to full options
 */
function normalizeOptions(input: any): IApplicationOptions {
  const options: any = {};

  // Simple port number
  if (typeof input === 'number') {
    options.port = input;
    return options;
  }

  // Simple string (connection string or name)
  if (typeof input === 'string') {
    options.name = input;
    return options;
  }

  // Object with shortcuts
  const normalized = { ...input };

  // Shortcuts for common configurations
  if (input.port) {
    normalized.http = {
      port: input.port,
      host: input.host || '0.0.0.0',
      ...input.http,
    };
  }

  if (input.redis) {
    if (typeof input.redis === 'string') {
      // Parse connection string
      const [host, port] = input.redis.split(':');
      normalized.redis = {
        default: {
          host,
          port: parseInt(port) || 6379,
        },
      };
    }
  }

  if (input.database || input.db) {
    normalized.database = input.database || input.db;
  }

  return normalized;
}

/**
 * Create a simple service with automatic registration
 *
 * @example
 * ```typescript
 * const greetingService = service({
 *   greet(name: string) {
 *     return `Hello, ${name}!`;
 *   }
 * });
 * ```
 */
export function service<T extends object>(
  implementation: T,
  options?: {
    name?: string;
    scope?: 'singleton' | 'transient' | 'scoped';
  }
): T {
  const ServiceClass = class {
    constructor() {
      Object.assign(this, implementation);
    }
  };

  // Apply decorators
  Injectable({
    scope: options?.scope || 'singleton',
  })(ServiceClass);

  // Auto-register if application exists
  if ((global as any).__titanApp) {
    const app = (global as any).__titanApp as Application;
    // Create a token for this service based on name or use the class itself
    const token = options?.name ? createToken<T>(options.name) : (ServiceClass as any);
    app.register(token, { useClass: ServiceClass });
  }

  return new ServiceClass() as T;
}

/**
 * Create a simple module with automatic registration
 *
 * @example
 * ```typescript
 * const AppModule = module({
 *   services: [UserService, ProductService],
 *   config: {
 *     port: 3000
 *   }
 * });
 * ```
 */
export function module(definition: {
  name?: string;
  services?: any[];
  imports?: any[];
  exports?: any[];
  config?: any;
  onStart?: () => Promise<void> | void;
  onStop?: () => Promise<void> | void;
}): any {
  @Module({
    imports: definition.imports,
    providers: definition.services,
    exports: definition.exports || definition.services,
  })
  class DynamicModule {
    async onStart?() {
      if (definition.onStart) {
        await definition.onStart();
      }
    }

    async onStop?() {
      if (definition.onStop) {
        await definition.onStop();
      }
    }
  }

  // Set name for debugging
  Object.defineProperty(DynamicModule, 'name', {
    value: definition.name || 'DynamicModule',
  });

  return DynamicModule;
}

/**
 * Simple configuration helper
 *
 * @example
 * ```typescript
 * const config = configure({
 *   port: env('PORT', 3000),
 *   database: {
 *     url: env('DATABASE_URL', 'postgres://localhost/myapp')
 *   }
 * });
 * ```
 */
export function configure<T extends object>(config: T): T {
  return config;
}

/**
 * Environment variable helper with type conversion
 *
 * @example
 * ```typescript
 * const port = env('PORT', 3000); // number
 * const debug = env('DEBUG', false); // boolean
 * const name = env('APP_NAME', 'myapp'); // string
 * ```
 */
export function env<T>(key: string, defaultValue: T): T {
  const value = process.env[key];

  if (value === undefined) {
    return defaultValue;
  }

  // Type conversion based on default value type
  if (typeof defaultValue === 'number') {
    return (parseFloat(value) || defaultValue) as T;
  }

  if (typeof defaultValue === 'boolean') {
    return (value === 'true' || value === '1') as T;
  }

  return value as T;
}

/**
 * Quick dependency injection helper
 *
 * @example
 * ```typescript
 * class UserService {
 *   db = inject(Database);
 *   logger = inject('Logger');
 * }
 * ```
 */
export function inject<T = any>(token: Token<T> | string): T {
  // This will be replaced by the actual injection at runtime
  // For now, return a proxy that will be resolved later
  return new Proxy({} as any, {
    get(target, prop) {
      throw new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: `Dependency ${String(token)} not injected. Make sure the service is registered and the application is started.`,
        details: { token: String(token) },
      });
    },
  }) as T;
}

/**
 * Create a controller with automatic route registration
 *
 * @example
 * ```typescript
 * const userController = controller('/users', {
 *   async list(req, res) {
 *     res.json(await userService.findAll());
 *   },
 *
 *   async get(req, res) {
 *     res.json(await userService.findById(req.params.id));
 *   }
 * });
 * ```
 */
export function controller(basePath: string, handlers: Record<string, (req: any, res: any) => any>): never {
  throw new Error(
    'HTTP controllers are not yet implemented in Titan Simple API. ' +
    'For HTTP functionality, use Netron\'s HTTP transport layer or Express/Fastify integration. ' +
    'See documentation at: https://github.com/omnitron/titan'
  );
}

/**
 * Create an application instance (alias for Application.create)
 */
export const createApp = Application.create.bind(Application);

/**
 * Create a unique injection token
 */
export const createToken = nexusCreateToken;

/**
 * Create a module programmatically
 */
export function createModule(config: {
  name?: string;
  providers?: any[];
  imports?: any[];
  exports?: any[];
  onStart?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
}): IModule {
  // Convert to the format expected by module()
  const moduleConfig = {
    ...config,
    services: config.providers,
  };
  return module(moduleConfig);
}

/**
 * Define a module with type-safe service methods
 */
export function defineModule<TService = {}>(definition: IModule & TService): IModule & TService {
  return definition;
}

/**
 * Export commonly used decorators for convenience
 */
export { Module, Injectable, Inject } from '../decorators/index.js';

/**
 * Lifecycle hook interfaces
 */
export interface OnStart {
  onStart(): Promise<void> | void;
}

export interface OnStop {
  onStop(): Promise<void> | void;
}

export interface OnInit {
  onInit(): Promise<void> | void;
}

export interface OnDestroy {
  onDestroy(): Promise<void> | void;
}

/**
 * Default export for even simpler usage
 *
 * @example
 * ```typescript
 * import titan from '@devgrid/titan';
 *
 * const app = await titan();
 * ```
 */
export default titan;
