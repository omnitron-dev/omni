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
import { TitanError, ErrorCode, Errors } from '../errors/index.js';

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
  globalThis.__titanApp = app;

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
  if (globalThis.__titanApp) {
    const app = globalThis.__titanApp as Application;
    // Create a token for this service based on name or use the class itself
    const token = options?.name ? createToken<T>(options.name) : ServiceClass as unknown as Token<T>;
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
  return new Proxy<object>({} as object, {
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
 * HTTP Request object for controller handlers
 */
export interface ControllerRequest {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Request URL */
  url: string;
  /** URL path */
  path: string;
  /** Query parameters */
  query: Record<string, string>;
  /** Route parameters (e.g., /users/:id) */
  params: Record<string, string>;
  /** Request headers */
  headers: Record<string, string>;
  /** Request body (parsed JSON) */
  body?: any;
  /** Raw request */
  raw: Request;
}

/**
 * HTTP Response object for controller handlers
 */
export interface ControllerResponse {
  /** Set response status code */
  status(code: number): ControllerResponse;
  /** Send JSON response */
  json(data: any): void;
  /** Send text response */
  text(data: string): void;
  /** Send HTML response */
  html(data: string): void;
  /** Set response header */
  header(name: string, value: string): ControllerResponse;
  /** Set multiple headers */
  headers(headers: Record<string, string>): ControllerResponse;
  /** Send response with custom status and body */
  send(statusCode: number, body: any, contentType?: string): void;
}

/**
 * Controller handler function type
 */
export type ControllerHandler = (req: ControllerRequest, res: ControllerResponse) => Promise<void> | void;

/**
 * Internal controller registration storage
 */
interface ControllerRegistration {
  basePath: string;
  handlers: Record<string, ControllerHandler>;
}

/**
 * Global controller registry (attached to the application)
 */
const controllerRegistry = new Map<Application, ControllerRegistration[]>();

/**
 * Create a controller with automatic route registration
 *
 * Controllers provide a simple way to create HTTP endpoints that work with
 * Titan's HTTP transport. Routes are automatically registered when the
 * application starts.
 *
 * @example
 * ```typescript
 * const userController = controller('/users', {
 *   async list(req, res) {
 *     const users = await userService.findAll();
 *     res.json(users);
 *   },
 *
 *   async get(req, res) {
 *     const user = await userService.findById(req.params.id);
 *     res.json(user);
 *   },
 *
 *   async create(req, res) {
 *     const user = await userService.create(req.body);
 *     res.status(201).json(user);
 *   }
 * });
 * ```
 */
export function controller(basePath: string, handlers: Record<string, ControllerHandler>): ControllerRegistration {
  // Normalize base path
  const normalizedPath = basePath.startsWith('/') ? basePath : `/${basePath}`;
  const registration: ControllerRegistration = {
    basePath: normalizedPath,
    handlers,
  };

  // Auto-register with the global application if it exists
  const app = globalThis.__titanApp as Application | undefined;
  if (app) {
    if (!controllerRegistry.has(app)) {
      controllerRegistry.set(app, []);
    }
    controllerRegistry.get(app)!.push(registration);
  }

  return registration;
}

/**
 * Get controllers registered for an application
 * @internal
 */
export function getControllers(app: Application): ControllerRegistration[] {
  return controllerRegistry.get(app) || [];
}

/**
 * Create a Netron service from a controller registration
 * This bridges the simple controller API with Netron's HTTP transport
 * @internal
 */
export function createControllerService(registration: ControllerRegistration): any {
  @Injectable({ scope: 'singleton' })
  class ControllerService {
    /**
     * Handle incoming HTTP requests and route to appropriate handler
     */
    async handleRequest(request: {
      method: string;
      path: string;
      query?: Record<string, string>;
      params?: Record<string, string>;
      headers?: Record<string, string>;
      body?: any;
    }): Promise<{
      status: number;
      headers: Record<string, string>;
      body: any;
    }> {
      // Extract handler name from path
      // Pattern: /basePath/handlerName or /basePath
      const relativePath = request.path.startsWith(registration.basePath)
        ? request.path.substring(registration.basePath.length)
        : request.path;

      const pathParts = relativePath.split('/').filter(Boolean);
      const handlerName = pathParts[0] || 'index';

      // Find matching handler
      const handler = registration.handlers[handlerName];
      if (!handler) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: { error: 'Not Found', message: `No handler found for ${handlerName}` },
        };
      }

      // Build controller request object
      const controllerReq: ControllerRequest = {
        method: request.method || 'GET',
        url: request.path,
        path: request.path,
        query: request.query || {},
        params: request.params || {},
        headers: request.headers || {},
        body: request.body,
        raw: null as unknown as Request, // Set by HTTP transport // Will be set by HTTP transport if available
      };

      // Build controller response object with state
      let responseStatus = 200;
      const responseHeaders: Record<string, string> = {};
      let responseBody: any = null;
      let responseSent = false;

      const controllerRes: ControllerResponse = {
        status(code: number) {
          responseStatus = code;
          return this;
        },
        json(data: any) {
          if (responseSent) throw Errors.badRequest('Response already sent');
          responseHeaders['Content-Type'] = 'application/json';
          responseBody = data;
          responseSent = true;
        },
        text(data: string) {
          if (responseSent) throw Errors.badRequest('Response already sent');
          responseHeaders['Content-Type'] = 'text/plain';
          responseBody = data;
          responseSent = true;
        },
        html(data: string) {
          if (responseSent) throw Errors.badRequest('Response already sent');
          responseHeaders['Content-Type'] = 'text/html';
          responseBody = data;
          responseSent = true;
        },
        header(name: string, value: string) {
          responseHeaders[name] = value;
          return this;
        },
        headers(headers: Record<string, string>) {
          Object.assign(responseHeaders, headers);
          return this;
        },
        send(statusCode: number, body: any, contentType = 'application/json') {
          if (responseSent) throw Errors.badRequest('Response already sent');
          responseStatus = statusCode;
          responseHeaders['Content-Type'] = contentType;
          responseBody = body;
          responseSent = true;
        },
      };

      // Execute handler
      try {
        await handler(controllerReq, controllerRes);

        // If handler didn't send a response, send empty 204
        if (!responseSent) {
          return {
            status: 204,
            headers: {},
            body: null,
          };
        }

        return {
          status: responseStatus,
          headers: responseHeaders,
          body: responseBody,
        };
      } catch (error: any) {
        // Handle errors
        return {
          status: error.statusCode || 500,
          headers: { 'Content-Type': 'application/json' },
          body: {
            error: error.name || 'Internal Server Error',
            message: error.message || 'An unexpected error occurred',
          },
        };
      }
    }
  }

  return ControllerService;
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
