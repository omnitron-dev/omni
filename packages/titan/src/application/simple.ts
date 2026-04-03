/**
 * Titan Simple API
 *
 * Zero-configuration, minimal cognitive load API for Titan Framework
 * This is the recommended way to use Titan for most applications
 */

import { Application } from './application.js';
import { Module, Injectable } from '../decorators/index.js';
import type { IApplicationOptions, IModule, ModuleConstructor } from '../types.js';
import { Token, createToken as nexusCreateToken } from '../nexus/index.js';
import { TitanError, ErrorCode } from '../errors/index.js';
import { fallbackLog } from '../utils/fallback-log.js';

/**
 * Augment global type to include the Titan application instance
 */
declare global {
  var __titanApp: Application | undefined;
}

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
export async function titan(input?: ModuleConstructor | IApplicationOptions): Promise<Application> {
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
  globalThis.__titanApp = app;

  // Auto-start the application
  await app.start();

  return app;
}

/**
 * Normalize simple options to full options
 *
 * @internal This function is only called with object input from titan()
 */
function normalizeOptions(input: Record<string, any>): IApplicationOptions {
  // Object with shortcuts
  const normalized: Record<string, any> = { ...input };

  // Shortcuts for common configurations
  if (input['port']) {
    normalized['http'] = {
      port: input['port'],
      host: input['host'] || '0.0.0.0',
      ...input['http'],
    };
  }

  if (input['redis']) {
    if (typeof input['redis'] === 'string') {
      // Parse connection string
      const [host, portStr] = input['redis'].split(':');
      normalized['redis'] = {
        default: {
          host,
          port: parseInt(portStr || '6379') || 6379,
        },
      };
    }
  }

  if (input['database'] || input['db']) {
    normalized['database'] = input['database'] || input['db'];
  }

  return normalized as IApplicationOptions;
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
  // Create a proper ServiceClass that preserves all methods from implementation
  const ServiceClass = class {
    constructor() {
      // Copy all properties from implementation
      Object.assign(this, implementation);
    }
  };

  // Define all methods on the prototype to preserve them properly
  // This ensures methods work even after Object.assign
  const proto = Object.getPrototypeOf(implementation);
  const descriptors = Object.getOwnPropertyDescriptors(implementation);

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (typeof descriptor.value === 'function') {
      // Define method on prototype to preserve 'this' context
      Object.defineProperty(ServiceClass.prototype, key, {
        value: descriptor.value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
  }

  // Also copy methods from prototype chain (if any)
  if (proto && proto !== Object.prototype) {
    const protoDescriptors = Object.getOwnPropertyDescriptors(proto);
    for (const [key, descriptor] of Object.entries(protoDescriptors)) {
      if (key !== 'constructor' && typeof descriptor.value === 'function') {
        Object.defineProperty(ServiceClass.prototype, key, {
          value: descriptor.value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
  }

  // Apply decorators
  Injectable({
    scope: options?.scope || 'singleton',
  })(ServiceClass);

  // Auto-register if application exists
  if (globalThis.__titanApp) {
    const app = globalThis.__titanApp as Application;
    // Create a token for this service based on name or use the class itself
    const token = options?.name ? createToken<T>(options.name) : (ServiceClass as unknown as Token<T>);

    // Register the service in the DI container
    app.register(token, { useClass: ServiceClass });

    // Resolve and return the instance from the container
    // This ensures we return the DI-managed instance
    try {
      return app.resolve(token);
    } catch (error) {
      // If resolution fails (e.g., app not fully initialized), fall back to direct instantiation
      fallbackLog('warn', 'Failed to resolve service from DI container', {
        error: error instanceof Error ? error.message : String(error),
      });
      return new ServiceClass() as T;
    }
  } else {
    // No app exists - warn and return a standalone instance
    fallbackLog('warn', 'No Titan application found. Service will not be managed by DI container. Call titan() first to enable DI.');
    return new ServiceClass() as T;
  }
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
}): ModuleConstructor {
  @Module({
    imports: definition.imports,
    providers: definition.services,
    exports: definition.exports || definition.services,
  })
  class DynamicModule implements IModule {
    name = definition.name || 'DynamicModule';

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

  return DynamicModule;
}

/**
 * Quick dependency injection helper
 *
 * Resolves dependencies from the global Titan application instance.
 * The application must be created via `titan()` before using this function.
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
  const app = globalThis.__titanApp;

  if (!app) {
    throw new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: `Cannot inject dependency ${String(token)}: Titan application not initialized. Call titan() first.`,
      details: { token: String(token) },
    });
  }

  // Convert string to token if needed
  const resolvedToken = typeof token === 'string' ? nexusCreateToken<T>(token) : token;

  return app.get<T>(resolvedToken);
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
