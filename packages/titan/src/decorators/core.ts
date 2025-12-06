/**
 * Core Dependency Injection Decorators
 *
 * @module decorators/core
 */

import 'reflect-metadata';
import semver from 'semver';
import { Scope, type ScopeValue, type Constructor } from '../nexus/index.js';
import { Errors } from '../errors/index.js';
import type { ServiceMetadata } from '../netron/types.js';
import type { ITransport } from '../netron/transport/types.js';
import type { MethodOptions } from '../netron/auth/types.js';

/**
 * Type representing a service contract for validation
 * Can be any object with string keys
 */
export type ServiceContract = Record<string, unknown>;

/**
 * Type representing a DI provider definition
 * Kept flexible for compatibility with various provider types
 */
export type ProviderDefinition = 
  | Constructor<unknown>
  | { useClass: Constructor<unknown> }
  | { useValue: unknown }
  | { useFactory: (...args: unknown[]) => unknown }
  | { useToken: symbol | string };

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
  contract?: ServiceContract;

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
  contract?: ServiceContract;

  /**
   * Transport names this service should be exposed on (for decorator → ServiceStub transfer)
   * This field is extracted during ServiceStub construction and stored on the stub itself.
   * It is NOT included in the ServiceMetadata that gets sent to clients.
   */
  transports?: string[];

  /**
   * Transport instances configured for the service (internal use)
   * @internal
   */
  _transports?: ITransport[];

  /**
   * Transport configuration options
   */
  transportConfig?: ServiceOptions['transportConfig'];
}

// Re-export Scope enum and ScopeValue type from nexus for backward compatibility
export { Scope, type ScopeValue };

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
  scope?: Scope | ScopeValue;
  token?: symbol | string | Constructor<unknown>;
  providedIn?: 'root' | 'any' | string;
}

/**
 * Module decorator options
 */
export interface ModuleDecoratorOptions {
  name?: string;
  version?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  imports?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providers?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exports?: any[];
  global?: boolean;
}
/**
 * Interface for classes marked with @Module decorator.
 * These properties are added at runtime for auto-discovery.
 */
export interface TitanModuleMarker {
  /** Flag indicating this is a Titan module */
  __titanModule?: boolean;
  /** Module metadata options */
  __titanModuleMetadata?: ModuleDecoratorOptions;
}



/**
 * Mark a class as injectable and available for dependency injection.
 * 
 * Injectable classes can be automatically resolved by the Nexus DI container
 * and can have their dependencies injected via constructor parameters.
 *
 * @param options - Configuration options for the injectable
 * @returns A class decorator that marks the class as injectable
 *
 * @example Basic injectable service
 * ```typescript
 * import { Injectable } from '@omnitron-dev/titan/decorators';
 *
 * @Injectable()
 * class UserService {
 *   constructor(private readonly db: DatabaseService) {}
 *
 *   async findUser(id: string): Promise<User> {
 *     return await this.db.query('SELECT * FROM users WHERE id = ?', [id]);
 *   }
 * }
 * ```
 *
 * @example Injectable with singleton scope (default)
 * ```typescript
 * @Injectable({ scope: 'singleton' })
 * class ConfigService {
 *   private config: Record<string, string> = {};
 *
 *   get(key: string): string {
 *     return this.config[key];
 *   }
 * }
 * ```
 *
 * @example Injectable with transient scope (new instance per injection)
 * ```typescript
 * @Injectable({ scope: 'transient' })
 * class RequestContext {
 *   readonly id = crypto.randomUUID();
 *   readonly timestamp = Date.now();
 * }
 * ```
 *
 * @example Injectable with request scope (per-request instance)
 * ```typescript
 * @Injectable({ scope: 'request' })
 * class RequestLogger {
 *   private logs: string[] = [];
 *
 *   log(message: string): void {
 *     this.logs.push(`[${new Date().toISOString()}] ${message}`);
 *   }
 *
 *   getLogs(): string[] {
 *     return this.logs;
 *   }
 * }
 * ```
 *
 * @example Injectable with custom token
 * ```typescript
 * import { Injectable, createToken } from '@omnitron-dev/titan/decorators';
 *
 * const CACHE_TOKEN = createToken<ICacheService>('CacheService');
 *
 * @Injectable({ token: CACHE_TOKEN })
 * class RedisCacheService implements ICacheService {
 *   async get<T>(key: string): Promise<T | null> {
 *     // Redis implementation
 *   }
 * }
 *
 * // Later, resolve by token:
 * const cache = container.resolve(CACHE_TOKEN);
 * ```
 *
 * @example Injectable with providedIn option
 * ```typescript
 * @Injectable({ providedIn: 'root' })
 * class GlobalService {
 *   // Available application-wide without explicit registration
 * }
 *
 * @Injectable({ providedIn: 'any' })
 * class FeatureService {
 *   // New instance provided to any module that imports it
 * }
 * ```
 */
export function Injectable(options: InjectableOptions = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Mark class for auto-discovery using module marker interface
    const moduleTarget = target as Constructor<unknown> & TitanModuleMarker;
    moduleTarget.__titanModule = true;
    moduleTarget.__titanModuleMetadata = options;

    // Apply Injectable decorator
    Injectable({ scope: 'singleton' })(target);

    return target;
  };
}

/**
 * Mark a class as singleton scoped (one instance for the entire application)
 */
export function Singleton() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function transientDecorator<T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'transient' })(target);
    return target;
  };
}

/**
 * Mark a class as scoped (one instance per scope/context)
 */
export function Scoped() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function scopedDecorator<T extends Constructor<any>>(target: T): T {
    Injectable({ scope: 'scoped' })(target);
    return target;
  };
}

/**
 * Mark a class as request scoped (one instance per request)
 */
export function Request() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * @param options - Either a qualified name string 'name[@version]'
 *                  or an options object with name and optional transports
 * @returns A decorator function that processes the target class
 *
 * @throws Error - If the service name is invalid or doesn't match the required pattern
 * @throws Error - If the version string is provided but doesn't follow semantic versioning
 *
 * @example Basic service with version
 * ```typescript
 * import { Service, Method } from '@omnitron-dev/titan/decorators';
 *
 * @Service('auth@1.0.0')
 * class AuthService {
 *   @Method()
 *   async login(username: string, password: string): Promise<{ token: string }> {
 *     const user = await this.validateCredentials(username, password);
 *     return { token: this.generateToken(user) };
 *   }
 *
 *   @Method()
 *   async logout(token: string): Promise<void> {
 *     await this.invalidateToken(token);
 *   }
 * }
 * ```
 *
 * @example Service with namespaced name
 * ```typescript
 * @Service('api.users@2.0.0')
 * class UserService {
 *   @Method()
 *   async getUser(id: string): Promise<User> {
 *     return await this.userRepository.findById(id);
 *   }
 *
 *   @Method()
 *   async createUser(data: CreateUserDto): Promise<User> {
 *     return await this.userRepository.create(data);
 *   }
 *
 *   @Method()
 *   async updateUser(id: string, data: UpdateUserDto): Promise<User> {
 *     return await this.userRepository.update(id, data);
 *   }
 *
 *   @Method()
 *   async deleteUser(id: string): Promise<void> {
 *     await this.userRepository.delete(id);
 *   }
 * }
 * ```
 *
 * @example Service with contract validation
 * ```typescript
 * import { Service, Method } from '@omnitron-dev/titan/decorators';
 *
 * // Define a contract for type-safe RPC
 * const userContract = {
 *   getUser: { params: ['string'], returns: 'User' },
 *   listUsers: { params: ['object'], returns: 'User[]' }
 * };
 *
 * @Service({
 *   name: 'UserService@1.0.0',
 *   contract: userContract
 * })
 * class UserService {
 *   @Method()
 *   async getUser(id: string): Promise<User> {
 *     return await this.db.users.findUnique({ where: { id } });
 *   }
 *
 *   @Method()
 *   async listUsers(filter: UserFilter): Promise<User[]> {
 *     return await this.db.users.findMany({ where: filter });
 *   }
 * }
 * ```
 *
 * @example Service with transport configuration
 * ```typescript
 * import { Service, Method } from '@omnitron-dev/titan/decorators';
 * import { WebSocketTransport, TcpTransport } from '@omnitron-dev/titan/netron';
 *
 * @Service({
 *   name: 'StreamService@1.0.0',
 *   transports: [
 *     new WebSocketTransport({ port: 8080 }),
 *     new TcpTransport({ port: 9000 })
 *   ],
 *   transportConfig: {
 *     timeout: 30000,
 *     compression: true,
 *     maxMessageSize: 1024 * 1024 // 1MB
 *   }
 * })
 * class StreamService {
 *   @Method()
 *   async streamData(options: StreamOptions): Promise<AsyncIterable<DataChunk>> {
 *     return this.createDataStream(options);
 *   }
 * }
 * ```
 *
 * @example Service with dependency injection
 * ```typescript
 * import { Service, Method, Inject } from '@omnitron-dev/titan/decorators';
 *
 * @Service('orders@1.0.0')
 * class OrderService {
 *   constructor(
 *     @Inject(UserService) private readonly userService: UserService,
 *     @Inject(InventoryService) private readonly inventory: InventoryService,
 *     @Inject(PaymentService) private readonly payments: PaymentService
 *   ) {}
 *
 *   @Method()
 *   async createOrder(userId: string, items: OrderItem[]): Promise<Order> {
 *     const user = await this.userService.getUser(userId);
 *     await this.inventory.reserveItems(items);
 *     const order = await this.processOrder(user, items);
 *     return order;
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Service = (options?: string | ServiceOptions) => (target: any) => {
  // Normalize options to ensure we always have an object
  const serviceOptions: ServiceOptions =
    typeof options === 'string' ? { name: options } : options || { name: target.name };

  const qualifiedName = serviceOptions.name || target.name;
  // Parse the qualified name into name and version components
  const [name, versionFromName] = qualifiedName.split('@');

  // Use explicit version from options if provided, otherwise from qualified name
  const version = typeof options === 'object' && 'version' in options ? options.version : versionFromName;

  // Regular expression to validate service names
  // Allows alphanumeric characters and dots for namespacing
  const nameRegex = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/;

  // Validate service name format
  if (!name || !nameRegex.test(name)) {
    throw Errors.badRequest(`Invalid service name "${name}". Only latin letters, numbers and dots are allowed.`);
  }

  // Validate version string if provided
  if (version && !semver.valid(version)) {
    throw Errors.badRequest(`Invalid version "${version}". Version must follow semver.`);
  }

  // Initialize metadata structure with extended properties
  const metadata: ExtendedServiceMetadata = {
    name,
    version: version || '',
    properties: {},
    methods: {},
    contract: serviceOptions.contract,
    transports: serviceOptions.transports?.map((t) => t.name),
    _transports: serviceOptions.transports,
    transportConfig: serviceOptions.transportConfig,
  };

  // Process class methods to extract metadata
  for (const key of Object.getOwnPropertyNames(target.prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(target.prototype, key);
    if (!descriptor) continue;

    // Skip non-public methods (check for Method decorator metadata)
    const isPublic =
      Reflect.getMetadata('public', target.prototype, key) ||
      Reflect.getMetadata(METADATA_KEYS.METHOD_ANNOTATION, target.prototype, key);
    if (!isPublic) continue;

    // Process method metadata
    if (typeof descriptor.value === 'function') {
      // Extract parameter types and return type using reflection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paramTypes = Reflect.getMetadata('design:paramtypes', target.prototype, key) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const returnType = Reflect.getMetadata('design:returntype', target.prototype, key)?.name || 'void';

      // Store method metadata
      metadata.methods[key] = {
        type: returnType,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        arguments: paramTypes.map((type: any, index: number) => ({
          index,
          type: type?.name || 'unknown'
        })),
      };
    }
  }

  // Process class properties to extract metadata
  // This requires creating an instance to get properties
  try {
    const instance = new target();
    for (const key of Object.keys(instance)) {
      // Skip non-public properties
      const isPublic =
        Reflect.getMetadata('public', target.prototype, key) ||
        Reflect.getMetadata(METADATA_KEYS.METHOD_ANNOTATION, target.prototype, key);
      if (!isPublic) continue;

      // Extract property type and readonly status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Repository(entity?: Constructor<any>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (options?: MethodOptions) => (target: any, propertyKey: string | symbol, descriptor?: PropertyDescriptor) => {
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

    // Store transports metadata (legacy support)
    if (options?.transports) {
      Reflect.defineMetadata('method:transports', options.transports, target, propertyKey);
    }
  };

// Track if deprecation warning has been shown to avoid console spam
let publicDecoratorWarningShown = false;

/**
 * Public decorator - alias for Method decorator for backward compatibility
 *
 * @deprecated Use @Method instead. This decorator will be removed in a future version.
 * The @Method decorator provides the same functionality with enhanced features.
 *
 * @example
 * // Old way (deprecated):
 * @Public()
 * async doSomething() {}
 *
 * // New way:
 * @Method()
 * async doSomething() {}
 */
export const Public = (options?: MethodOptions) => {
  // Show deprecation warning once at runtime
  if (!publicDecoratorWarningShown && typeof console !== 'undefined') {
    publicDecoratorWarningShown = true;
    console.warn(
      '[Titan] @Public decorator is deprecated. Use @Method instead. ' +
      'This decorator will be removed in a future version.'
    );
  }
  return Method(options);
};

// ============================================================================
// Composable Method Decorators
// ============================================================================
// These decorators can be used alongside @Method() for cleaner separation of concerns.
// They allow for more readable and maintainable code by splitting configuration.

/**
 * Auth decorator - configures authentication and authorization for a method.
 * Use alongside @Method() for cleaner separation of concerns.
 *
 * @example
 * ```typescript
 * @Method()
 * @Auth({ roles: ['admin'], scopes: ['write:users'] })
 * async deleteUser(id: string) {}
 * ```
 */
export const Auth =
  (config: NonNullable<MethodOptions['auth']>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(METADATA_KEYS.METHOD_AUTH, config, target, propertyKey);
  };

/**
 * RateLimit decorator - configures rate limiting for a method.
 * Use alongside @Method() for cleaner separation of concerns.
 *
 * @example
 * ```typescript
 * @Method()
 * @RateLimit({ limit: 100, window: 60000 })
 * async searchDocuments(query: string) {}
 * ```
 */
export const RateLimit =
  (config: NonNullable<MethodOptions['rateLimit']>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(METADATA_KEYS.METHOD_RATE_LIMIT, config, target, propertyKey);
  };

/**
 * Cache decorator - configures caching for a method.
 * Use alongside @Method() for cleaner separation of concerns.
 *
 * @example
 * ```typescript
 * @Method()
 * @Cache({ ttl: 30000, invalidateOn: ['document:updated'] })
 * async getDocument(id: string) {}
 * ```
 */
export const Cache =
  (config: NonNullable<MethodOptions['cache']>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(METADATA_KEYS.METHOD_CACHE, config, target, propertyKey);
  };

/**
 * Prefetch decorator - configures resource prefetching for a method.
 * Use alongside @Method() for cleaner separation of concerns.
 *
 * @example
 * ```typescript
 * @Method()
 * @Prefetch({ resources: ['user-profile', 'permissions'] })
 * async getUserDashboard(userId: string) {}
 * ```
 */
export const Prefetch =
  (config: NonNullable<MethodOptions['prefetch']>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(METADATA_KEYS.METHOD_PREFETCH, config, target, propertyKey);
  };

/**
 * Audit decorator - configures audit logging for a method.
 * Use alongside @Method() for cleaner separation of concerns.
 *
 * @example
 * ```typescript
 * @Method()
 * @Audit({ action: 'user.delete', level: 'critical' })
 * async deleteUser(id: string) {}
 * ```
 */
export const Audit =
  (config: NonNullable<MethodOptions['audit']>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(METADATA_KEYS.METHOD_AUDIT, config, target, propertyKey);
  };

/**
 * Transports decorator - specifies which transports a method is available on.
 * Use alongside @Method() for cleaner separation of concerns.
 *
 * @example
 * ```typescript
 * @Method()
 * @Transports(['ws', 'tcp']) // Only available on WebSocket and TCP
 * async streamData() {}
 * ```
 */
export const Transports =
  (transports: string[]) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata('method:transports', transports, target, propertyKey);
  };

/**
 * Readonly decorator - marks a property as read-only.
 * Use alongside @Method() for properties.
 *
 * @example
 * ```typescript
 * @Method()
 * @Readonly()
 * public readonly version: string = '1.0.0';
 * ```
 */
export const Readonly =
  () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (target: any, propertyKey: string | symbol) => {
    Reflect.defineMetadata('readonly', true, target, propertyKey);
  };
