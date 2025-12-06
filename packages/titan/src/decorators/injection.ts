/**
 * Dependency Injection Parameter Decorators
 *
 * @module decorators/injection
 */

import 'reflect-metadata';
import { METADATA_KEYS } from './core.js';
import { DECORATOR_METADATA } from './constants.js';
import type { InjectionToken } from '@nexus/types.js';

/**
 * Inject a dependency by token
 *
 * This decorator can be used on constructor parameters, properties, or method parameters
 * to specify a custom injection token for dependency resolution.
 *
 * @param token - The injection token to use for resolving the dependency
 * @returns A decorator function that can be used on parameters or properties
 *
 * @example Constructor parameter injection
 * ```typescript
 * class UserService {
 *   constructor(@Inject(DatabaseToken) private db: IDatabase) {}
 * }
 * ```
 *
 * @example Property injection
 * ```typescript
 * class UserService {
 *   @Inject(LoggerToken)
 *   private logger!: ILogger;
 * }
 * ```
 *
 * @example Method parameter injection
 * ```typescript
 * class UserService {
 *   async getUser(@Inject(CacheToken) cache: ICache, id: string) {
 *     return cache.get(`user:${id}`);
 *   }
 * }
 * ```
 */
export function Inject<T>(token: InjectionToken<T>): ParameterDecorator & PropertyDecorator {
  return function (
    target: object,
    propertyKey: string | symbol | undefined,
    parameterIndex?: number
  ): void {
    // Constructor parameter injection
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existingTokens = Reflect.getMetadata(METADATA_KEYS.CONSTRUCTOR_PARAMS, target) || [];
      existingTokens[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.CONSTRUCTOR_PARAMS, existingTokens, target);
      Reflect.defineMetadata(DECORATOR_METADATA.DESIGN_PARAMTYPES_CUSTOM, existingTokens, target);
    }
    // Property injection
    else if (propertyKey !== undefined && parameterIndex === undefined) {
      const existingTokens = Reflect.getMetadata(METADATA_KEYS.PROPERTY_PARAMS, target) || {};
      existingTokens[propertyKey] = token;
      Reflect.defineMetadata(METADATA_KEYS.PROPERTY_PARAMS, existingTokens, target);
    }
    // Method parameter injection
    else if (propertyKey !== undefined && parameterIndex !== undefined) {
      const existingTokens = Reflect.getMetadata(METADATA_KEYS.METHOD_PARAMS, target, propertyKey) || [];
      existingTokens[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.METHOD_PARAMS, existingTokens, target, propertyKey);
    }
  } as ParameterDecorator & PropertyDecorator;
}

/**
 * Mark a dependency as optional
 */
export function Optional() {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, target) || [];
      existing[parameterIndex] = true;
      Reflect.defineMetadata(METADATA_KEYS.OPTIONAL, existing, target);
    }
  };
}

/**
 * Inject all instances of a multi-provider
 */
export function InjectAll<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata(METADATA_KEYS.INJECT_ALL, target) || [];
      existing[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.INJECT_ALL, existing, target);
    }
  };
}

/**
 * Inject a value from configuration by path
 */
export function Value(path: string, defaultValue?: any) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existingValues = Reflect.getMetadata(DECORATOR_METADATA.VALUES, target) || [];
      existingValues[parameterIndex] = { path, defaultValue };
      Reflect.defineMetadata(DECORATOR_METADATA.VALUES, existingValues, target);
    }
  };
}

/**
 * Lazy injection - delays resolution until first use
 *
 * @remarks
 * This decorator uses a Symbol-keyed property to store the resolved value per-instance,
 * preventing shared state bugs across multiple instances.
 *
 * @example
 * ```typescript
 * class MyService {
 *   @Lazy(() => DatabaseToken)
 *   private db!: Database;
 *
 *   async query() {
 *     // Database is resolved on first access, not at construction
 *     return this.db.query('SELECT * FROM users');
 *   }
 * }
 * ```
 */
export function Lazy<T>(tokenFactory: () => InjectionToken<T>) {
  return function (target: any, propertyKey: string) {
    // Use a unique Symbol to store the cached value on each instance
    const cacheSymbol = Symbol(`lazy-${propertyKey}`);

    Object.defineProperty(target, propertyKey, {
      get() {
        // Check if this instance already has a cached value
        if (!(cacheSymbol in this)) {
          const container = Reflect.getMetadata(DECORATOR_METADATA.CONTAINER, this);
          if (!container) {
            throw new Error(
              `@Lazy decorator requires a container to be set. ` +
              `Ensure the class is instantiated through the DI container.`
            );
          }
          // Store the resolved value using the Symbol key on this instance
          this[cacheSymbol] = container.resolve(tokenFactory());
        }
        return this[cacheSymbol];
      },
      enumerable: true,
      configurable: true,
    });
  };
}

/**
 * Inject environment variable value into constructor parameter
 *
 * @param key - The environment variable name to inject
 * @param defaultValue - Optional default value if environment variable is not set
 * @returns A parameter decorator that injects the environment variable value
 *
 * @example
 * ```typescript
 * import { Injectable, InjectEnv } from '@omnitron-dev/titan/decorators';
 *
 * @Injectable()
 * class DatabaseService {
 *   constructor(
 *     @InjectEnv('DATABASE_URL') private readonly dbUrl: string,
 *     @InjectEnv('DB_POOL_SIZE', 10) private readonly poolSize: number
 *   ) {
 *     console.log(`Connecting to ${dbUrl} with pool size ${poolSize}`);
 *   }
 * }
 * ```
 */
export function InjectEnv(key: string, defaultValue?: any) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata(DECORATOR_METADATA.ENV, target) || [];
      existing[parameterIndex] = { key, defaultValue };
      Reflect.defineMetadata(DECORATOR_METADATA.ENV, existing, target);
    }
  };
}

/**
 * Inject configuration value from the configuration system by path
 *
 * @param path - The configuration path (e.g., 'database.host' or 'app.port')
 * @returns A parameter decorator that injects the configuration value
 *
 * @example
 * ```typescript
 * import { Injectable, InjectConfig } from '@omnitron-dev/titan/decorators';
 *
 * @Injectable()
 * class EmailService {
 *   constructor(
 *     @InjectConfig('email.smtp.host') private readonly smtpHost: string,
 *     @InjectConfig('email.smtp.port') private readonly smtpPort: number,
 *     @InjectConfig('email.from') private readonly fromAddress: string
 *   ) {
 *     this.initialize();
 *   }
 *
 *   private initialize() {
 *     console.log(`Email service configured: ${this.smtpHost}:${this.smtpPort}`);
 *   }
 * }
 * ```
 */
export function InjectConfig(path: string) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata(DECORATOR_METADATA.CONFIG, target) || [];
      existing[parameterIndex] = path;
      Reflect.defineMetadata(DECORATOR_METADATA.CONFIG, existing, target);
    }
  };
}

/**
 * Conditionally inject a dependency based on a runtime predicate
 *
 * @param token - The injection token to resolve if condition is true
 * @param condition - A predicate function that determines whether to inject
 * @param fallback - Optional fallback value or factory function if condition is false
 * @returns A parameter decorator that conditionally injects the dependency
 *
 * @example
 * ```typescript
 * import { Injectable, ConditionalInject } from '@omnitron-dev/titan/decorators';
 *
 * @Injectable()
 * class PaymentService {
 *   constructor(
 *     @ConditionalInject(
 *       StripePaymentProvider,
 *       () => process.env.NODE_ENV === 'production',
 *       new MockPaymentProvider()
 *     )
 *     private readonly paymentProvider: IPaymentProvider
 *   ) {}
 * }
 * ```
 *
 * @example With factory fallback
 * ```typescript
 * @Injectable()
 * class CacheService {
 *   constructor(
 *     @ConditionalInject(
 *       RedisCache,
 *       () => process.env.REDIS_ENABLED === 'true',
 *       () => new InMemoryCache()
 *     )
 *     private readonly cache: ICache
 *   ) {}
 * }
 * ```
 */
export function ConditionalInject<T>(token: InjectionToken<T>, condition: () => boolean, fallback?: T | (() => T)) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata(DECORATOR_METADATA.CONDITIONAL, target) || [];
      existing[parameterIndex] = { token, condition, fallback };
      Reflect.defineMetadata(DECORATOR_METADATA.CONDITIONAL, existing, target);
    }
  };
}

/**
 * Inject multiple instances of a token
 */
export function InjectMany<T>(token: InjectionToken<T>) {
  return InjectAll(token);
}
