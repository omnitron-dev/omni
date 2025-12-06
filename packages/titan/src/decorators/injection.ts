/**
 * Dependency Injection Parameter Decorators
 *
 * @module decorators/injection
 */

import 'reflect-metadata';
import { METADATA_KEYS } from './core.js';
import type { InjectionToken } from '@nexus/types.js';

/**
 * Inject a dependency by token
 */
export function Inject<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    // Constructor parameter injection
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existingTokens = Reflect.getMetadata(METADATA_KEYS.CONSTRUCTOR_PARAMS, target) || [];
      existingTokens[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.CONSTRUCTOR_PARAMS, existingTokens, target);
      Reflect.defineMetadata('design:paramtypes:custom', existingTokens, target);
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
  };
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
      const existingValues = Reflect.getMetadata('nexus:values', target) || [];
      existingValues[parameterIndex] = { path, defaultValue };
      Reflect.defineMetadata('nexus:values', existingValues, target);
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
          const container = Reflect.getMetadata('nexus:container', this);
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
 * Inject environment variable
 */
export function InjectEnv(key: string, defaultValue?: any) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata('nexus:env', target) || [];
      existing[parameterIndex] = { key, defaultValue };
      Reflect.defineMetadata('nexus:env', existing, target);
    }
  };
}

/**
 * Inject configuration value
 */
export function InjectConfig(path: string) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata('nexus:config', target) || [];
      existing[parameterIndex] = path;
      Reflect.defineMetadata('nexus:config', existing, target);
    }
  };
}

/**
 * Conditionally inject based on a predicate
 */
export function ConditionalInject<T>(token: InjectionToken<T>, condition: () => boolean, fallback?: T | (() => T)) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (propertyKey === undefined && parameterIndex !== undefined) {
      const existing = Reflect.getMetadata('nexus:conditional', target) || [];
      existing[parameterIndex] = { token, condition, fallback };
      Reflect.defineMetadata('nexus:conditional', existing, target);
    }
  };
}

/**
 * Inject multiple instances of a token
 */
export function InjectMany<T>(token: InjectionToken<T>) {
  return InjectAll(token);
}
