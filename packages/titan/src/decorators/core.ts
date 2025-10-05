/**
 * Core Dependency Injection Decorators
 *
 * @module decorators/core
 */

import 'reflect-metadata';
import semver from 'semver';
import type { Constructor } from '../nexus/index.js';
import type { ServiceMetadata } from '../netron/types.js';
import type { ITransport } from '../netron/transport/types.js';
import type { MethodOptions } from '../netron/auth/types.js';

/**
 * Options for the Service decorator
 */
export interface ServiceOptions {
  /**
   * The fully qualified name of the service (name[@version])
   */
  name: string;

  /**
   * Optional service contract for validation and documentation
   */
  contract?: any;

  /**
   * Optional array of transports the service should be exposed on
   */
  transports?: ITransport[];

  /**
   * Optional transport configuration
   */
  transportConfig?: {
    /**
     * Default timeout for RPC calls (ms)
     */
    timeout?: number;

    /**
     * Enable compression for messages
     */
    compression?: boolean;

    /**
     * Maximum message size in bytes
     */
    maxMessageSize?: number;
  };
}

/**
 * Extended service metadata that includes transport configuration
 */
export interface ExtendedServiceMetadata extends ServiceMetadata {
  /**
   * Service contract for validation and documentation
   */
  contract?: any;

  /**
   * Transport instances configured for the service (internal use)
   * This shadows the parent transports field which is string[]
   * @internal
   */
  _transports?: ITransport[];

  /**
   * Transport configuration options
   */
  transportConfig?: ServiceOptions['transportConfig'];
}

/**
 * Scope type for dependency injection
 */
export type Scope = 'singleton' | 'transient' | 'scoped' | 'request';

/**
 * Metadata keys for decorators
 */
export const METADATA_KEYS = {
  // DI Metadata
  INJECTABLE: 'nexus:injectable',
  CONSTRUCTOR_PARAMS: 'nexus:constructor-params',
  PROPERTY_PARAMS: 'nexus:property-params',
  METHOD_PARAMS: 'nexus:method-params',
  SCOPE: 'nexus:scope',
  TOKEN: 'nexus:token',
  OPTIONAL: 'nexus:optional',
  INJECT_ALL: 'nexus:inject-all',
  MODULE: 'nexus:module',
  GLOBAL: 'nexus:global',
  SERVICE_NAME: 'nexus:service:name',

  // Lifecycle
  POST_CONSTRUCT: 'nexus:post-construct',
  PRE_DESTROY: 'nexus:pre-destroy',

  // Custom metadata
  CONTROLLER_PATH: 'controller:path',
  REPOSITORY_ENTITY: 'repository:entity',
  FACTORY_NAME: 'factory:name',

  // Netron/Service metadata
  SERVICE_ANNOTATION: 'netron:service',
  METHOD_ANNOTATION: 'netron:method',

  // Method configuration metadata
  METHOD_AUTH: 'method:auth',
  METHOD_RATE_LIMIT: 'method:rateLimit',
  METHOD_CACHE: 'method:cache',
  METHOD_PREFETCH: 'method:prefetch',
  METHOD_AUDIT: 'method:audit',
  METHOD_OPTIONS: 'method:options',
} as const;

/**
 * Annotation used to mark classes and methods as Netron services.
 * This annotation is used in conjunction with decorators to identify
 * and register services within the Netron framework.
 *
 * Re-exported from core decorators for backward compatibility.
 * @constant {string} SERVICE_ANNOTATION
 */
export const SERVICE_ANNOTATION = METADATA_KEYS.SERVICE_ANNOTATION;

/**
 * Annotation used to mark public methods and properties of Netron services.
 * This annotation indicates that the marked element should be exposed
 * and accessible to remote peers in the network.
 *
 * Re-exported from core decorators for backward compatibility.
 * @constant {string} PUBLIC_ANNOTATION
 */
export const PUBLIC_ANNOTATION = METADATA_KEYS.METHOD_ANNOTATION;

/**
 * Injectable decorator options
 */
export interface InjectableOptions {
  scope?: Scope;
  token?: any;
  providedIn?: 'root' | 'any' | string;
}

/**
 * Module decorator options
 */
export interface ModuleDecoratorOptions {
  name?: string;
  version?: string;
  imports?: any[];
  providers?: any[];
  exports?: any[];
  global?: boolean;
}

/**
 * Mark a class as injectable and available for dependency injection
 */
export function Injectable(options: InjectableOptions = {}) {
  return function injectableDecorator<T extends Constructor<any>>(target: T): T {
    // Mark as injectable
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, true, target);

    // Set scope if provided
    if (options.scope) {
      Reflect.defineMetadata(METADATA_KEYS.SCOPE, options.scope, target);
    }

    // Set token if provided
    if (options.token) {
      Reflect.defineMetadata(METADATA_KEYS.TOKEN, options.token, target);
    }

    // Store options for advanced features
    Reflect.defineMetadata('injectable:options', options, target);

    // Also set simple key for compatibility
    Reflect.defineMetadata('injectable', true, target);
    if (options.scope) {
      Reflect.defineMetadata('scope', options.scope, target);
    }

    return target;
  };
}

/**
 * Module decorator - defines a module with providers, imports, and exports
 */
export function Module(options: ModuleDecoratorOptions = {}) {
  return function moduleDecorator<T extends Constructor<any>>(target: T): T {
    // Set Nexus module metadata
    Reflect.defineMetadata(METADATA_KEYS.MODULE, true, target);
    Reflect.defineMetadata('nexus:module', options, target);

    // Set simple metadata for compatibility
    Reflect.defineMetadata('module', options, target);

    // Mark as global if specified
    if (options.global) {
      Reflect.defineMetadata(METADATA_KEYS.GLOBAL, true, target);
    }

    // Mark class for auto-discovery
    (target as any).__titanModule = true;
    (target as any).__titanModuleMetadata = options;

    // Apply Injectable decorator
    Injectable({ scope: 'singleton' })(target);

    return target;
  };
}

/**
 * Mark a class as singleton scoped (one instance for the entire application)
 */
export function Singleton() {
  return function singletonDecorator<T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'singleton' })(target);
    Reflect.defineMetadata('singleton', true, target);
    return target;
  };
}

/**
 * Mark a class as transient scoped (new instance for every injection)
 */
export function Transient() {
  return function transientDecorator<T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'transient' })(target);
    return target;
  };
}

/**
 * Mark a class as scoped (one instance per scope/context)
 */
export function Scoped() {
  return function scopedDecorator<T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'scoped' })(target);
    return target;
  };
}

/**
 * Mark a class as request scoped (one instance per request)
 */
export function Request() {
  return function requestDecorator<T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'request' })(target);
    return target;
  };
}

/**
 * Service decorator factory that creates a class decorator for defining Titan/Netron services.
 * This decorator processes the service class to extract metadata about its public methods
 * and properties, validates the service name and version, and stores the metadata using
 * reflection.
 *
 * @param {string | ServiceOptions} options - Either a qualified name string 'name[@version]'
 *                                           or an options object with name and optional transports
 * @returns {ClassDecorator} A decorator function that processes the target class
 *
 * @throws {Error} If the service name is invalid or doesn't match the required pattern
 * @throws {Error} If the version string is provided but doesn't follow semantic versioning
 *
 * @example
 * // Simple string usage
 * @Service('auth@1.0.0')
 * class AuthService {
 *   @Method()
 *   async login(username: string, password: string): Promise<string> {
 *     // Implementation
 *   }
 * }
 *
 * @example
 * // With contract and transports configuration
 * import { WebSocketTransport, TcpTransport } from '@omnitron-dev/titan/netron';
 *
 * @Service({
 *   name: 'UserService@1.0.0',
 *   contract: userContract,
 *   transports: [
 *     new WebSocketTransport({ port: 8080 }),
 *     new TcpTransport({ port: 3000 })
 *   ]
 * })
 * class UserService {
 *   // ...
 * }
 */
export const Service = (options?: string | ServiceOptions) => (target: any) => {
  // Normalize options to ensure we always have an object
  const serviceOptions: ServiceOptions = typeof options === 'string'
    ? { name: options }
    : options || { name: target.name };

  const qualifiedName = serviceOptions.name || target.name;
  // Parse the qualified name into name and version components
  const [name, versionFromName] = qualifiedName.split('@');

  // Use explicit version from options if provided, otherwise from qualified name
  const version = (typeof options === 'object' && 'version' in options) ? options.version : versionFromName;

  // Regular expression to validate service names
  // Allows alphanumeric characters and dots for namespacing
  const nameRegex = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;

  // Validate service name format
  if (!name || !nameRegex.test(name)) {
    throw new Error(`Invalid service name "${name}". Only latin letters and dots are allowed.`);
  }

  // Validate version string if provided
  if (version && !semver.valid(version)) {
    throw new Error(`Invalid version "${version}". Version must follow semver.`);
  }

  // Initialize metadata structure with extended properties
  const metadata: ExtendedServiceMetadata = {
    name,
    version: version || '',
    properties: {},
    methods: {},
    contract: serviceOptions.contract,
    transports: serviceOptions.transports?.map(t => t.name),
    _transports: serviceOptions.transports,
    transportConfig: serviceOptions.transportConfig,
  };

  // Process class methods to extract metadata
  for (const key of Object.getOwnPropertyNames(target.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, key);
    if (!descriptor) continue;

    // Skip non-public methods (check for Method decorator metadata)
    const isPublic = Reflect.getMetadata('public', target.prototype, key) ||
      Reflect.getMetadata(METADATA_KEYS.METHOD_ANNOTATION, target.prototype, key);
    if (!isPublic) continue;

    // Process method metadata
    if (typeof descriptor.value === 'function') {
      // Extract parameter types and return type using reflection
      const paramTypes = Reflect.getMetadata('design:paramtypes', target.prototype, key) || [];
      const returnType = Reflect.getMetadata('design:returntype', target.prototype, key)?.name || 'void';

      // Extract transport metadata if specified via @Method({ transports: [...] })
      const methodTransports = Reflect.getMetadata('method:transports', target.prototype, key);

      // Store method metadata
      metadata.methods[key] = {
        type: returnType,
        arguments: paramTypes.map((type: any) => type?.name || 'unknown'),
        // Include transports if specified, otherwise undefined (available on all transports)
        ...(methodTransports && { transports: methodTransports })
      };
    }
  }

  // Process class properties to extract metadata
  // This requires creating an instance to get properties
  try {
    const instance = new target();
    for (const key of Object.keys(instance)) {
      // Skip non-public properties
      const isPublic = Reflect.getMetadata('public', target.prototype, key) ||
        Reflect.getMetadata(METADATA_KEYS.METHOD_ANNOTATION, target.prototype, key);
      if (!isPublic) continue;

      // Extract property type and readonly status
      const type = Reflect.getMetadata('design:type', target.prototype, key)?.name || 'unknown';
      const isReadonly = Reflect.getMetadata('readonly', target.prototype, key);

      // Store property metadata
      metadata.properties[key] = {
        type,
        readonly: !!isReadonly,
      };
    }
  } catch {
    // If constructor requires params, we can't extract property metadata
    // This is acceptable - properties will be empty
  }

  // Store the complete metadata on the class using reflection
  Reflect.defineMetadata(METADATA_KEYS.SERVICE_ANNOTATION, metadata, target);

  // Also set compatibility metadata
  Reflect.defineMetadata('service', { name, version: version || undefined }, target);
  if (name) {
    Reflect.defineMetadata(METADATA_KEYS.SERVICE_NAME, name, target);
  }

  // Apply Injectable decorator for DI
  Injectable({ scope: 'singleton' })(target);
};

/**
 * Mark a module or provider as global (available to all modules)
 */
export function Global() {
  return function globalDecorator<T extends Constructor<any>>(target: T): T {
    Reflect.defineMetadata(METADATA_KEYS.GLOBAL, true, target);
    Reflect.defineMetadata('global', true, target);
    return target;
  };
}

/**
 * Controller decorator - marks a class as a controller
 */
export function Controller(path: string = '') {
  return function controllerDecorator<T extends Constructor<any>>(target: T): T {
    Reflect.defineMetadata(METADATA_KEYS.CONTROLLER_PATH, path, target);
    Reflect.defineMetadata('controller:path', path, target);
    Reflect.defineMetadata('controller', { path }, target);
    Injectable({ scope: 'singleton' })(target);
    return target;
  };
}

/**
 * Repository decorator - marks a class as a repository
 */
export function Repository(entity?: Constructor<any>) {
  return function repositoryDecorator<T extends Constructor<any>>(target: T): T {
    if (entity) {
      Reflect.defineMetadata(METADATA_KEYS.REPOSITORY_ENTITY, entity, target);
    }
    Reflect.defineMetadata('repository', true, target);
    Injectable({ scope: 'singleton' })(target);
    return target;
  };
}

/**
 * Factory decorator - marks a method as a factory for creating instances
 */
export function Factory(name: string) {
  return function factoryDecorator(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata(METADATA_KEYS.FACTORY_NAME, name, target, propertyKey);
    Reflect.defineMetadata('factory', name, target, propertyKey);
    return descriptor;
  };
}

/**
 * Method decorator factory that creates a property or method decorator.
 * This decorator marks class members as publicly accessible in the Titan/Netron service
 * and can optionally mark properties as read-only or specify available transports.
 *
 * Enhanced with auth, rate limiting, caching, prefetch, and audit support.
 *
 * This replaces the former @Public decorator from Netron.
 *
 * @param {MethodOptions} [options] - Configuration options for the decorator
 * @param {boolean} [options.readonly] - If true, marks the property as read-only
 * @param {string[]} [options.transports] - Optional array of transport names this method is available on.
 *                                          If not specified, method is available on all transports.
 * @param {object} [options.auth] - Authentication and authorization configuration
 * @param {string[]} [options.auth.roles] - Required roles (RBAC)
 * @param {string[]} [options.auth.permissions] - Required permissions (RBAC)
 * @param {string[]} [options.auth.scopes] - Required OAuth2 scopes
 * @param {string[] | object} [options.auth.policies] - Policy names or expressions to evaluate
 * @param {boolean} [options.auth.allowAnonymous] - Allow anonymous access
 * @param {boolean} [options.auth.inherit] - Inherit class-level policies
 * @param {boolean} [options.auth.override] - Override class-level policies
 * @param {RateLimitConfig} [options.rateLimit] - Rate limiting configuration
 * @param {CacheConfig} [options.cache] - Cache configuration
 * @param {PrefetchConfig} [options.prefetch] - Resource prefetch configuration
 * @param {AuditConfig} [options.audit] - Audit configuration
 * @returns {PropertyDecorator | MethodDecorator} A decorator function that processes the target member
 *
 * @example
 * // Simple method exposure
 * @Method()
 * public doSomething(): void {}
 *
 * // With authentication and authorization
 * @Method({
 *   auth: {
 *     roles: ['user'],
 *     scopes: ['write:documents'],
 *     policies: { any: ['resource:owner', 'role:admin'] }
 *   }
 * })
 * async updateDocument(id: string) {}
 *
 * // With rate limiting
 * @Method({
 *   rateLimit: {
 *     defaultTier: { name: 'free', limit: 10, burst: 20 },
 *     tiers: { premium: { limit: 100, burst: 150 } },
 *     window: 60000
 *   }
 * })
 * async searchDocuments(query: string) {}
 *
 * // With caching
 * @Method({
 *   cache: {
 *     ttl: 30000,
 *     invalidateOn: ['document:updated']
 *   }
 * })
 * async getDocument(id: string) {}
 *
 * // Transport filtering
 * @Method({ transports: ['ws', 'tcp'] })
 * public wsAndTcpOnly(): void {}
 *
 * // Read-only property
 * @Method({ readonly: true })
 * public readonly value: string;
 */
export const Method =
  (options?: MethodOptions) =>
    (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
      // Mark the member as public/method
      Reflect.defineMetadata('public', true, target, propertyKey);
      Reflect.defineMetadata(METADATA_KEYS.METHOD_ANNOTATION, true, target, propertyKey);

      // For properties (when descriptor is undefined), handle readonly flag
      if (!descriptor) {
        Reflect.defineMetadata('readonly', options?.readonly, target, propertyKey);
      }

      // Store all method options for later retrieval
      if (options) {
        Reflect.defineMetadata(METADATA_KEYS.METHOD_OPTIONS, options, target, propertyKey);
      }

      // Store transport metadata if specified (for backward compatibility)
      if (options?.transports && options.transports.length > 0) {
        Reflect.defineMetadata('method:transports', options.transports, target, propertyKey);
      }

      // Store auth metadata
      if (options?.auth !== undefined) {
        Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, options.auth, target, propertyKey);
      }

      // Store rate limit metadata
      if (options?.rateLimit) {
        Reflect.defineMetadata(METADATA_KEYS.METHOD_RATE_LIMIT, options.rateLimit, target, propertyKey);
      }

      // Store cache metadata
      if (options?.cache) {
        Reflect.defineMetadata(METADATA_KEYS.METHOD_CACHE, options.cache, target, propertyKey);
      }

      // Store prefetch metadata
      if (options?.prefetch) {
        Reflect.defineMetadata(METADATA_KEYS.METHOD_PREFETCH, options.prefetch, target, propertyKey);
      }

      // Store audit metadata
      if (options?.audit) {
        Reflect.defineMetadata(METADATA_KEYS.METHOD_AUDIT, options.audit, target, propertyKey);
      }
    };

/**
 * Public decorator - alias for Method decorator for backward compatibility
 * @deprecated Use @Method instead
 */
export const Public = Method;