/**
 * Decorator support for Nexus DI Container
 * 
 * @module decorators
 * @packageDocumentation
 * 
 * This module provides decorator-based dependency injection for Nexus.
 * It requires reflect-metadata to be imported before use.
 * 
 * @example
 * ```typescript
 * // Import reflect-metadata first
 * import 'reflect-metadata';
 * import { Injectable, Inject } from '@omnitron-dev/nexus/decorators';
 * 
 * @Injectable()
 * class UserService {
 *   constructor(@Inject(DatabaseToken) private db: Database) {}
 * }
 * ```
 */

import 'reflect-metadata';
import { InjectionToken, Provider, Constructor, Scope } from '../types/core';
import { Container } from '../container/container';
import { createToken, tokenFromClass } from '../token/token';

/**
 * Metadata keys for decorators
 */
const METADATA_KEYS = {
  INJECTABLE: 'nexus:injectable',
  INJECT: 'nexus:inject',
  INJECT_PARAMS: 'nexus:inject:params',
  SCOPE: 'nexus:scope',
  MULTI: 'nexus:multi',
  OPTIONAL: 'nexus:optional',
  MODULE: 'nexus:module',
  PROVIDER_METADATA: 'nexus:provider:metadata',
  LIFECYCLE_HOOKS: 'nexus:lifecycle:hooks'
} as const;

/**
 * Injectable options
 */
export interface InjectableOptions {
  scope?: Scope;
  token?: InjectionToken<any>;
  multi?: boolean;
  tags?: string[];
  metadata?: Record<string, any>;
  eager?: boolean;
}

/**
 * Module options for decorator
 */
export interface ModuleDecoratorOptions {
  name: string;
  imports?: Constructor<any>[];
  providers?: (Constructor<any> | Provider<any>)[];
  exports?: (Constructor<any> | InjectionToken<any>)[];
  global?: boolean;
}

/**
 * Make a class injectable
 */
export function Injectable(options: InjectableOptions = {}) {
  return function <T extends Constructor<any>>(target: T): T {
    // Store injectable metadata
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, true, target);
    Reflect.defineMetadata(METADATA_KEYS.SCOPE, options.scope || Scope.Transient, target);
    
    if (options.multi) {
      Reflect.defineMetadata(METADATA_KEYS.MULTI, true, target);
    }
    
    if (options.metadata) {
      Reflect.defineMetadata(METADATA_KEYS.PROVIDER_METADATA, options.metadata, target);
    }
    
    // Get constructor parameter types
    const paramTypes = Reflect.getMetadata('design:paramtypes', target) || [];
    const injectParams = Reflect.getMetadata(METADATA_KEYS.INJECT_PARAMS, target) || {};
    
    // Store dependency information
    const dependencies: InjectionToken<any>[] = [];
    for (let i = 0; i < paramTypes.length; i++) {
      const injectToken = injectParams[i];
      if (injectToken) {
        dependencies.push(injectToken);
      } else if (paramTypes[i]) {
        // Try to use the type as token
        dependencies.push(tokenFromClass(paramTypes[i]));
      }
    }
    
    Reflect.defineMetadata(METADATA_KEYS.INJECT, dependencies, target);
    
    return target;
  };
}

/**
 * Inject a dependency
 */
export function Inject<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    if (propertyKey === undefined) {
      // Constructor injection
      const existingTokens = Reflect.getMetadata(METADATA_KEYS.INJECT_PARAMS, target) || {};
      existingTokens[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.INJECT_PARAMS, existingTokens, target);
    } else {
      // Property injection
      const constructor = target.constructor;
      const existingProperties = Reflect.getMetadata(METADATA_KEYS.INJECT, constructor) || {};
      existingProperties[propertyKey] = token;
      Reflect.defineMetadata(METADATA_KEYS.INJECT, existingProperties, constructor);
    }
  };
}

/**
 * Inject an optional dependency
 */
export function Optional() {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    if (propertyKey === undefined) {
      // Constructor parameter
      const existingOptional = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, target) || {};
      existingOptional[parameterIndex] = true;
      Reflect.defineMetadata(METADATA_KEYS.OPTIONAL, existingOptional, target);
    }
  };
}

/**
 * Mark a class as a module
 */
export function Module(options: ModuleDecoratorOptions) {
  return function <T extends Constructor<any>>(target: T): T {
    Reflect.defineMetadata(METADATA_KEYS.MODULE, options, target);
    return target;
  };
}

/**
 * Scope decorators
 */
export function Singleton() {
  return Injectable({ scope: Scope.Singleton });
}

export function Transient() {
  return Injectable({ scope: Scope.Transient });
}

export function Scoped() {
  return Injectable({ scope: Scope.Scoped });
}

export function Request() {
  return Injectable({ scope: Scope.Request });
}

/**
 * Lifecycle hook decorators
 */
export function PostConstruct() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hooks = Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, target.constructor) || {};
    hooks.postConstruct = propertyKey;
    Reflect.defineMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, hooks, target.constructor);
  };
}

export function PreDestroy() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hooks = Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, target.constructor) || {};
    hooks.preDestroy = propertyKey;
    Reflect.defineMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, hooks, target.constructor);
  };
}

/**
 * Auto-register decorated classes
 */
export class DecoratorContainer extends Container {
  /**
   * Register a decorated class
   */
  registerClass<T>(target: Constructor<T>): this {
    if (!Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target)) {
      throw new Error(`Class ${target.name} is not decorated with @Injectable`);
    }
    
    const scope = Reflect.getMetadata(METADATA_KEYS.SCOPE, target) || Scope.Transient;
    const dependencies = Reflect.getMetadata(METADATA_KEYS.INJECT, target) || [];
    const token = tokenFromClass(target);
    
    this.register(token, {
      useClass: target,
      scope,
      inject: dependencies
    });
    
    return this;
  }
  
  /**
   * Auto-scan and register all decorated classes
   */
  autoRegister(...targets: Constructor<any>[]): this {
    for (const target of targets) {
      if (Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target)) {
        this.registerClass(target);
      }
    }
    return this;
  }
  
  /**
   * Load a decorated module
   */
  loadDecoratedModule<T>(moduleClass: Constructor<T>): this {
    const metadata = Reflect.getMetadata(METADATA_KEYS.MODULE, moduleClass);
    if (!metadata) {
      throw new Error(`Class ${moduleClass.name} is not decorated with @Module`);
    }
    
    const moduleOptions = metadata as ModuleDecoratorOptions;
    
    // Register imports
    if (moduleOptions.imports) {
      for (const importedModule of moduleOptions.imports) {
        this.loadDecoratedModule(importedModule);
      }
    }
    
    // Register providers
    if (moduleOptions.providers) {
      for (const provider of moduleOptions.providers) {
        if (typeof provider === 'function') {
          this.registerClass(provider as Constructor<any>);
        } else {
          // It's already a provider object
          this.register((provider as any).provide || (provider as any).token, provider);
        }
      }
    }
    
    return this;
  }
}

/**
 * Helper to get metadata
 */
export function getInjectableMetadata(target: Constructor<any>) {
  return {
    isInjectable: Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target) || false,
    scope: Reflect.getMetadata(METADATA_KEYS.SCOPE, target),
    dependencies: Reflect.getMetadata(METADATA_KEYS.INJECT, target) || [],
    optionalParams: Reflect.getMetadata(METADATA_KEYS.OPTIONAL, target) || {},
    lifecycleHooks: Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, target) || {},
    metadata: Reflect.getMetadata(METADATA_KEYS.PROVIDER_METADATA, target) || {}
  };
}

/**
 * Controller decorator for web frameworks
 */
export function Controller(path: string = '') {
  return function <T extends Constructor<any>>(target: T): T {
    Reflect.defineMetadata('controller:path', path, target);
    return Injectable({ scope: Scope.Singleton })(target);
  };
}

/**
 * Service decorator (alias for Injectable with singleton scope)
 */
export function Service(options: Omit<InjectableOptions, 'scope'> = {}) {
  return Injectable({ ...options, scope: Scope.Singleton });
}

/**
 * Repository decorator
 */
export function Repository(entity?: Constructor<any>) {
  return function <T extends Constructor<any>>(target: T): T {
    if (entity) {
      Reflect.defineMetadata('repository:entity', entity, target);
    }
    return Injectable({ scope: Scope.Singleton })(target);
  };
}

/**
 * Factory decorator
 */
export function Factory<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    if (typeof method !== 'function') {
      throw new Error('Factory decorator can only be applied to methods');
    }
    
    // Store factory metadata
    const factories = Reflect.getMetadata('factories', target.constructor) || new Map();
    factories.set(token, propertyKey);
    Reflect.defineMetadata('factories', factories, target.constructor);
  };
}

/**
 * Lazy injection decorator
 */
export function Lazy<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string) {
    let cachedValue: T | undefined;
    
    Object.defineProperty(target, propertyKey, {
      get() {
        if (cachedValue === undefined) {
          const container = Reflect.getMetadata('container', this);
          if (container) {
            cachedValue = container.resolve(token);
          }
        }
        return cachedValue;
      },
      enumerable: true,
      configurable: true
    });
  };
}

/**
 * Conditional injection decorator
 */
export function ConditionalInject<T>(
  token: InjectionToken<T>,
  condition: () => boolean
) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    if (propertyKey === undefined) {
      // Constructor injection
      const conditions = Reflect.getMetadata('conditional:inject', target) || {};
      conditions[parameterIndex] = { token, condition };
      Reflect.defineMetadata('conditional:inject', conditions, target);
    }
  };
}

/**
 * Multi-injection decorator
 */
export function InjectMany<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    if (propertyKey === undefined) {
      // Constructor injection
      const multiInjects = Reflect.getMetadata('multi:inject', target) || {};
      multiInjects[parameterIndex] = token;
      Reflect.defineMetadata('multi:inject', multiInjects, target);
    }
  };
}

/**
 * Environment-based injection
 */
export function InjectEnv(key: string, defaultValue?: any) {
  return function (target: any, propertyKey: string) {
    Object.defineProperty(target, propertyKey, {
      get() {
        return process.env[key] || defaultValue;
      },
      enumerable: true,
      configurable: true
    });
  };
}

/**
 * Config injection
 */
export function InjectConfig(path: string) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    if (propertyKey === undefined) {
      // Constructor injection
      const configs = Reflect.getMetadata('config:inject', target) || {};
      configs[parameterIndex] = path;
      Reflect.defineMetadata('config:inject', configs, target);
    }
  };
}

/**
 * Export metadata and utilities
 */
export { METADATA_KEYS };
export { DecoratorContainer as Container };

// Re-export common types for convenience
export type { InjectionToken, Scope, Provider } from '../types/core';