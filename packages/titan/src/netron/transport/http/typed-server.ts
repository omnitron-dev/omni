/**
 * Type-Safe HTTP Server with OpenAPI Generation
 *
 * Provides a fully typed HTTP server that automatically generates
 * OpenAPI specifications from TypeScript contracts.
 */

import type { ContractDefinition } from './typed-contract.js';
import { TypedMiddlewarePipeline, type TypedMiddleware } from './typed-middleware.js';
import { HttpServer } from './server.js';
import type { MethodContract } from '../../../validation/contract.js';
import { z } from 'zod';

/**
 * Service implementation type
 */
export type ServiceImplementation<T extends ContractDefinition> = {
  [K in keyof T]: ImplementationMethod<T[K]>;
};

/**
 * Implementation method type
 */
type ImplementationMethod<M extends MethodContract> = (
  input: z.infer<M['input']>,
  context: ServiceContext
) => M['stream'] extends true
  ? AsyncIterable<z.infer<M['output']>>
  : Promise<z.infer<M['output']>>;

/**
 * Service context for method execution
 */
export interface ServiceContext {
  requestId: string;
  timestamp: number;
  userId?: string;
  tenantId?: string;
  metadata: Record<string, any>;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  port?: number;
  host?: string;
  cors?: {
    origin?: string | string[] | ((origin: string) => boolean);
    credentials?: boolean;
    maxAge?: number;
  };
  compression?: {
    threshold?: number;
    level?: number;
  };
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
  openapi?: {
    title?: string;
    version?: string;
    description?: string;
    servers?: Array<{ url: string; description?: string }>;
  };
  metrics?: any;
  gracefulShutdown?: {
    timeout?: number;
    onShutdown?: () => Promise<void>;
  };
}

/**
 * Service registration options
 */
export interface ServiceRegistration<T extends ContractDefinition> {
  name: string;
  contract: T;
  implementation: ServiceImplementation<T>;
  middleware?: TypedMiddleware<any>[];
  description?: string;
  version?: string;
}

/**
 * Route mapping for REST-style endpoints
 */
export interface RestRouteMapping {
  [method: string]: {
    httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
  };
}

/**
 * Type-Safe HTTP Server
 */
export class TypedHttpServer {
  private server: HttpServer;
  private services = new Map<string, ServiceRegistration<any>>();
  private globalPipeline = new TypedMiddlewarePipeline<any>();
  private config: ServerConfig;
  private routes = new Map<string, any>();

  constructor(config: ServerConfig = {}) {
    this.config = config;
    this.server = new HttpServer({
      port: config.port,
      host: config.host,
      cors: config.cors as any,
      compression: config.compression as any
    });
  }

  /**
   * Register a service with type safety
   */
  service<T extends ContractDefinition>(
    registration: ServiceRegistration<T>
  ): this {
    this.services.set(registration.name, registration);

    // Register service methods in the server
    this.registerServiceMethods(registration);

    return this;
  }

  /**
   * Add global middleware
   */
  globalMiddleware(middlewares: TypedMiddleware<any>[]): this {
    for (const middleware of middlewares) {
      this.globalPipeline.use(middleware);
    }
    return this;
  }

  /**
   * Configure custom routes
   */
  route(path: string, handler: (req: Request) => Promise<Response>): this {
    this.routes.set(path, handler);
    return this;
  }

  /**
   * Configure REST-style routing for a service
   */
  rest<T extends ContractDefinition>(
    serviceName: string,
    basePath: string,
    mapping: RestRouteMapping
  ): this {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found`);
    }

    // Create REST routes based on mapping
    for (const [method, config] of Object.entries(mapping)) {
      const fullPath = `${basePath}${config.path}`;
      // Store REST route configuration
      // This would be used by the server to route requests
    }

    return this;
  }

  /**
   * Generate OpenAPI specification
   */
  generateOpenAPI(): any {
    const spec: any = {
      openapi: '3.0.3',
      info: {
        title: this.config.openapi?.title || 'API Documentation',
        version: this.config.openapi?.version || '1.0.0',
        description: this.config.openapi?.description || 'Auto-generated API documentation'
      },
      servers: this.config.openapi?.servers || [
        { url: `http://${this.config.host || 'localhost'}:${this.config.port || 3000}` }
      ],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {}
      }
    };

    // Generate paths from services
    for (const [serviceName, service] of this.services) {
      this.generateServicePaths(spec, serviceName, service);
    }

    return spec;
  }

  /**
   * Generate OpenAPI paths for a service
   */
  private generateServicePaths(spec: any, serviceName: string, service: ServiceRegistration<any>): void {
    for (const [methodName, methodContract] of Object.entries(service.contract)) {
      const contract = methodContract as MethodContract;
      const httpConfig = contract.http;

      // Determine path and HTTP method
      const path = httpConfig?.path || `/rpc/${serviceName}/${methodName}`;
      const httpMethod = (httpConfig?.method || 'POST').toLowerCase();

      if (!spec.paths[path]) {
        spec.paths[path] = {};
      }

      const operation: any = {
        operationId: `${serviceName}_${methodName}`,
        summary: httpConfig?.openapi?.summary || `${serviceName}.${methodName}`,
        description: httpConfig?.openapi?.description,
        tags: httpConfig?.openapi?.tags || [serviceName],
        deprecated: httpConfig?.openapi?.deprecated
      };

      // Add request body for POST/PUT/PATCH
      if (['post', 'put', 'patch'].includes(httpMethod)) {
        if (contract.input) {
          // Simple schema representation (would use zod-to-json-schema in production)
          const inputSchema = {
            type: 'object',
            description: `Input for ${serviceName}.${methodName}`
          };

          operation.requestBody = {
            required: true,
            content: {
              'application/json': {
                schema: inputSchema
              }
            }
          };

          // Store schema in components
          spec.components.schemas[`${serviceName}_${methodName}_Input`] = inputSchema;
        }
      }

      // Add path parameters
      if (httpConfig?.params) {
        operation.parameters = operation.parameters || [];
        for (const [paramName, paramSchema] of Object.entries(httpConfig.params)) {
          operation.parameters.push({
            name: paramName,
            in: 'path',
            required: true,
            schema: { type: 'string' } // Simplified schema
          });
        }
      }

      // Add query parameters
      if (httpConfig?.query) {
        operation.parameters = operation.parameters || [];
        for (const [paramName, paramSchema] of Object.entries(httpConfig.query)) {
          operation.parameters.push({
            name: paramName,
            in: 'query',
            required: false,
            schema: { type: 'string' } // Simplified schema
          });
        }
      }

      // Add responses
      operation.responses = {
        '200': {
          description: 'Successful response'
        }
      };

      if (contract.output) {
        // Simple schema representation (would use zod-to-json-schema in production)
        const outputSchema = {
          type: 'object',
          description: `Output for ${serviceName}.${methodName}`
        };

        operation.responses['200'].content = {
          'application/json': {
            schema: outputSchema
          }
        };

        spec.components.schemas[`${serviceName}_${methodName}_Output`] = outputSchema;
      }

      // Add error responses
      if (contract.errors) {
        for (const [statusCode, errorSchema] of Object.entries(contract.errors)) {
          operation.responses[statusCode] = {
            description: 'Error response',
            content: {
              'application/json': {
                schema: { type: 'object' } // Simplified error schema
              }
            }
          };
        }
      } else {
        // Default error responses
        operation.responses['400'] = { description: 'Bad Request' };
        operation.responses['404'] = { description: 'Not Found' };
        operation.responses['500'] = { description: 'Internal Server Error' };
      }

      spec.paths[path][httpMethod] = operation;
    }
  }

  /**
   * Register service methods in the native server
   */
  private registerServiceMethods<T extends ContractDefinition>(
    registration: ServiceRegistration<T>
  ): void {
    // This would integrate with HttpNativeServer's service registration
    // The server's setPeer method would be called to register the service
    // For now, we store the registration for OpenAPI generation
  }

  /**
   * Start the server
   */
  async start(options?: {
    onListening?: (port: number) => void;
    onError?: (error: Error) => void;
  }): Promise<void> {
    // Set up event handlers
    if (options?.onListening) {
      this.server.on('listening', ({ port }: { port: number }) => options.onListening!(port));
    }

    if (options?.onError) {
      this.server.on('error', options.onError);
    }

    // Start the server
    await this.server.listen();
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.config.gracefulShutdown) {
      // Implement graceful shutdown
      if (this.config.gracefulShutdown.onShutdown) {
        await this.config.gracefulShutdown.onShutdown();
      }
    }

    await this.server.close();
  }

  /**
   * Get server metrics
   */
  getMetrics(): any {
    return {
      server: this.server.getMetrics(),
      middleware: this.globalPipeline.getMetrics(),
      services: Array.from(this.services.keys()),
      routes: Array.from(this.routes.keys())
    };
  }
}

/**
 * Create a service implementation with type checking
 */
export function createService<T extends ContractDefinition>(
  contract: T,
  implementation: ServiceImplementation<T>
): ServiceImplementation<T> {
  // Validate that all contract methods are implemented
  for (const method in contract) {
    if (!(method in implementation)) {
      throw new Error(`Method ${method} not implemented`);
    }
  }

  // Validate that no extra methods are implemented
  for (const method in implementation) {
    if (!(method in contract)) {
      throw new Error(`Method ${method} not in contract`);
    }
  }

  return implementation;
}

/**
 * Server builder with fluent API
 */
export class ServerBuilder {
  private config: ServerConfig = {};
  private services: ServiceRegistration<any>[] = [];
  private globalMiddlewares: TypedMiddleware<any>[] = [];
  private routes = new Map<string, any>();

  /**
   * Set server port
   */
  port(port: number): this {
    this.config.port = port;
    return this;
  }

  /**
   * Set server host
   */
  host(host: string): this {
    this.config.host = host;
    return this;
  }

  /**
   * Configure CORS
   */
  cors(options: ServerConfig['cors']): this {
    this.config.cors = options;
    return this;
  }

  /**
   * Configure compression
   */
  compression(options: ServerConfig['compression']): this {
    this.config.compression = options;
    return this;
  }

  /**
   * Add a service
   */
  service<T extends ContractDefinition>(registration: ServiceRegistration<T>): this {
    this.services.push(registration);
    return this;
  }

  /**
   * Add global middleware
   */
  middleware(...middlewares: TypedMiddleware<any>[]): this {
    this.globalMiddlewares.push(...middlewares);
    return this;
  }

  /**
   * Configure OpenAPI
   */
  openapi(options: ServerConfig['openapi']): this {
    this.config.openapi = options;
    return this;
  }

  /**
   * Add a custom route
   */
  route(path: string, handler: (req: Request) => Promise<Response>): this {
    this.routes.set(path, handler);
    return this;
  }

  /**
   * Configure graceful shutdown
   */
  gracefulShutdown(options: ServerConfig['gracefulShutdown']): this {
    this.config.gracefulShutdown = options;
    return this;
  }

  /**
   * Build the server
   */
  build(): TypedHttpServer {
    const server = new TypedHttpServer(this.config);

    // Add services
    for (const service of this.services) {
      server.service(service);
    }

    // Add global middleware
    if (this.globalMiddlewares.length > 0) {
      server.globalMiddleware(this.globalMiddlewares);
    }

    // Add routes
    for (const [path, handler] of this.routes) {
      server.route(path, handler);
    }

    return server;
  }
}

/**
 * Create a new server builder
 */
export function createServer(): ServerBuilder {
  return new ServerBuilder();
}