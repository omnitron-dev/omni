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

/**
 * Options for the Service decorator
 */
export interface ServiceOptions {
  /**
   * The fully qualified name of the service (name[@version])
   */
  name: string;

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
   * Transports configured for the service
   */
  transports?: ITransport[];

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
  return function <T extends Constructor<any>>(target: T): T {
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
  return function <T extends Constructor<any>>(target: T): T {
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
  return function <T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'singleton' })(target);
    Reflect.defineMetadata('singleton', true, target);
    return target;
  };
}

/**
 * Mark a class as transient scoped (new instance for every injection)
 */
export function Transient() {
  return function <T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'transient' })(target);
    return target;
  };
}

/**
 * Mark a class as scoped (one instance per scope/context)
 */
export function Scoped() {
  return function <T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'scoped' })(target);
    return target;
  };
}

/**
 * Mark a class as request scoped (one instance per request)
 */
export function Request() {
  return function <T extends Constructor<any>>(target: T): T {
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
 * // With transports configuration
 * import { WebSocketTransport, TcpTransport } from '@omnitron-dev/titan/netron';
 *
 * @Service({
 *   name: 'auth@1.0.0',
 *   transports: [
 *     new WebSocketTransport({ port: 8080 }),
 *     new TcpTransport({ port: 3000 })
 *   ]
 * })
 * class AuthService {
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
    transports: serviceOptions.transports,
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

      // Store method metadata
      metadata.methods[key] = {
        type: returnType,
        arguments: paramTypes.map((type: any) => type?.name || 'unknown'),
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
  Reflect.defineMetadata('service', { name, version: version || '' }, target);
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
  return function <T extends Constructor<any>>(target: T): T {
    Reflect.defineMetadata(METADATA_KEYS.GLOBAL, true, target);
    Reflect.defineMetadata('global', true, target);
    return target;
  };
}

/**
 * Controller decorator - marks a class as a controller
 */
export function Controller(path: string = '') {
  return function <T extends Constructor<any>>(target: T): T {
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
  return function <T extends Constructor<any>>(target: T): T {
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
export function Factory<T>(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Reflect.defineMetadata(METADATA_KEYS.FACTORY_NAME, name, target, propertyKey);
    Reflect.defineMetadata('factory', name, target, propertyKey);
    return descriptor;
  };
}

/**
 * Method decorator factory that creates a property or method decorator.
 * This decorator marks class members as publicly accessible in the Titan/Netron service
 * and can optionally mark properties as read-only.
 *
 * This replaces the former @Public decorator from Netron.
 *
 * @param {Object} [options] - Configuration options for the decorator
 * @param {boolean} [options.readonly] - If true, marks the property as read-only
 * @returns {PropertyDecorator | MethodDecorator} A decorator function that processes the target member
 *
 * @example
 * class ExampleService {
 *   @Method({ readonly: true })
 *   public readonly value: string;
 *
 *   @Method()
 *   public doSomething(): void {
 *     // Implementation
 *   }
 * }
 */
export const Method =
  (options?: { readonly?: boolean }) =>
    (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
      // Mark the member as public/method
      Reflect.defineMetadata('public', true, target, propertyKey);
      Reflect.defineMetadata(METADATA_KEYS.METHOD_ANNOTATION, true, target, propertyKey);

      // For properties (when descriptor is undefined), handle readonly flag
      if (!descriptor) {
        Reflect.defineMetadata('readonly', options?.readonly, target, propertyKey);
      }
    };

/**
 * Public decorator - alias for Method decorator for backward compatibility
 * @deprecated Use @Method instead
 */
export const Public = Method;