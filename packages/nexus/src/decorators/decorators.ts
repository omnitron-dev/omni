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

import { Container } from '../container/container';
import { createToken, tokenFromClass } from '../token/token';
import { Scope, Provider, Constructor, InjectionToken, RegistrationOptions } from '../types/core';

/**
 * Lazy factory registry for storing factory functions
 * We use a Map instead of metadata to store functions since functions
 * are not serializable and can cause issues with metadata storage
 */
const lazyFactoryRegistry = new Map<string, () => InjectionToken<any>>();

/**
 * Metadata keys for decorators
 */
export const METADATA_KEYS = {
  INJECTABLE: 'nexus:injectable',
  INJECT: 'nexus:inject',
  INJECT_PARAMS: 'nexus:inject:params',
  SCOPE: 'nexus:scope',
  MULTI: 'nexus:multi',
  OPTIONAL: 'nexus:optional',
  MODULE: 'nexus:module',
  PROVIDER_METADATA: 'nexus:provider:metadata',
  LIFECYCLE_HOOKS: 'nexus:lifecycle:hooks',
  SERVICE_NAME: 'nexus:service:name',
  FACTORY_METHODS: 'nexus:factory:methods',
  PROPERTY_INJECTIONS: 'nexus:property:injections',
  VALUE_INJECTIONS: 'nexus:value:injections',
  MULTI_INJECTIONS: 'nexus:multi:injections',
  LAZY_INJECTIONS: 'nexus:lazy:injections'
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
 * Lifecycle hook metadata
 */
export interface LifecycleHooks {
  postConstruct?: string[];
  preDestroy?: string[];
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
    const optionalParams = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, target) || {};
    const valueParams = Reflect.getMetadata(METADATA_KEYS.VALUE_INJECTIONS, target) || {};
    const multiParams = Reflect.getMetadata(METADATA_KEYS.MULTI_INJECTIONS, target) || {};

    // Store dependency information
    const dependencies: InjectionToken<any>[] = [];
    for (let i = 0; i < paramTypes.length; i++) {
      const injectToken = injectParams[i];
      const valueConfig = valueParams[i];
      const multiToken = multiParams[i];

      if (injectToken) {
        dependencies.push(injectToken);
      } else if (valueConfig) {
        // Value injection - create a special token for this
        dependencies.push(createToken(`__VALUE_${valueConfig.path}__`));
      } else if (multiToken) {
        dependencies.push(multiToken);
      } else if (paramTypes[i] && !optionalParams[i]) {
        // Try to use the type as token
        dependencies.push(tokenFromClass(paramTypes[i]));
      } else {
        // Optional parameter without explicit token
        dependencies.push(undefined as any);
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
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor injection
      const existingTokens = Reflect.getMetadata(METADATA_KEYS.INJECT_PARAMS, target) || {};
      existingTokens[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.INJECT_PARAMS, existingTokens, target);
    } else if (propertyKey !== undefined) {
      // Property injection
      const constructor = target.constructor;
      const existingProperties = Reflect.getMetadata(METADATA_KEYS.PROPERTY_INJECTIONS, constructor) || {};
      existingProperties[propertyKey] = token;
      Reflect.defineMetadata(METADATA_KEYS.PROPERTY_INJECTIONS, existingProperties, constructor);
    }
  };
}

/**
 * Inject an optional dependency
 */
export function Optional() {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor parameter
      const existingOptional = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, target) || {};
      existingOptional[parameterIndex] = true;
      Reflect.defineMetadata(METADATA_KEYS.OPTIONAL, existingOptional, target);
    }
  };
}

/**
 * Inject all services for a multi-token
 */
export function InjectAll<T>(token: InjectionToken<T>) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor injection
      const existingMulti = Reflect.getMetadata(METADATA_KEYS.MULTI_INJECTIONS, target) || {};
      existingMulti[parameterIndex] = token;
      Reflect.defineMetadata(METADATA_KEYS.MULTI_INJECTIONS, existingMulti, target);
    }
  };
}

/**
 * Inject configuration value
 */
export function Value(path: string, defaultValue?: any) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor injection
      const existingValues = Reflect.getMetadata(METADATA_KEYS.VALUE_INJECTIONS, target) || {};
      existingValues[parameterIndex] = { path, defaultValue };
      Reflect.defineMetadata(METADATA_KEYS.VALUE_INJECTIONS, existingValues, target);
    }
  };
}

/**
 * Lazy injection decorator - returns a function that can be called to get the dependency
 */
export function Lazy<T>(tokenFactory: () => InjectionToken<T>) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor injection - inject a lazy function
      const existingParams = Reflect.getMetadata(METADATA_KEYS.INJECT_PARAMS, target) || {};
      // Create a special token for lazy injection (include class name for uniqueness)
      const lazyToken = createToken(`__LAZY_${target.name}_${parameterIndex}__`);
      existingParams[parameterIndex] = lazyToken;
      Reflect.defineMetadata(METADATA_KEYS.INJECT_PARAMS, existingParams, target);

      // Store the lazy factory in our registry using a unique key
      const factoryKey = `${target.name}:${parameterIndex}`;
      lazyFactoryRegistry.set(factoryKey, tokenFactory);

      // Also store an indicator in metadata that this parameter has a lazy factory
      const existingLazy = Reflect.getMetadata(METADATA_KEYS.LAZY_INJECTIONS, target) || {};
      existingLazy[parameterIndex] = true; // Just store a boolean to indicate lazy factory exists
      Reflect.defineMetadata(METADATA_KEYS.LAZY_INJECTIONS, existingLazy, target);
    } else if (propertyKey !== undefined) {
      // Property injection
      let cachedValue: T | undefined;

      Object.defineProperty(target, propertyKey, {
        get() {
          if (cachedValue === undefined) {
            const container = Reflect.getMetadata('container', this);
            if (container) {
              const token = tokenFactory();
              cachedValue = container.resolve(token);
            }
          }
          return cachedValue;
        },
        enumerable: true,
        configurable: true
      });
    }
  };
}

/**
 * Mark a class as a module
 */
export function Module(options: ModuleDecoratorOptions) {
  return function <T extends Constructor<any>>(target: T): T {
    Reflect.defineMetadata(METADATA_KEYS.MODULE, options, target);

    // Add getModule static method
    (target as any).getModule = function () {
      return {
        name: options.name,
        imports: (options.imports || []).map((importedModule: any) =>
          importedModule.getModule ? importedModule.getModule() : importedModule
        ),
        providers: options.providers || [],
        exports: options.exports || [],
        global: options.global || false
      };
    };

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
 * Service decorator with name
 */
export function Service(name?: string, options: Omit<InjectableOptions, 'scope'> = {}) {
  return function <T extends Constructor<any>>(target: T): T {
    if (name) {
      Reflect.defineMetadata(METADATA_KEYS.SERVICE_NAME, name, target);
    }
    return Injectable({ ...options, scope: Scope.Singleton })(target);
  };
}

/**
 * Global module decorator - marks a module as global
 * Global modules are automatically available to all other modules
 */
export function Global() {
  return function <T extends Constructor<any>>(target: T): T {
    const existingMetadata = Reflect.getMetadata(METADATA_KEYS.MODULE, target);
    if (existingMetadata) {
      // Update existing module metadata
      existingMetadata.global = true;
      Reflect.defineMetadata(METADATA_KEYS.MODULE, existingMetadata, target);
    } else {
      // If no module metadata exists, create minimal metadata
      Reflect.defineMetadata(METADATA_KEYS.MODULE, { global: true }, target);
    }
    return target;
  };
}

/**
 * Lifecycle hook decorators
 */
export function PostConstruct() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hooks: LifecycleHooks = Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, target.constructor) || {};
    if (!hooks.postConstruct) {
      hooks.postConstruct = [];
    }
    hooks.postConstruct.push(propertyKey);
    Reflect.defineMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, hooks, target.constructor);
  };
}

export function PreDestroy() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const hooks: LifecycleHooks = Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, target.constructor) || {};
    if (!hooks.preDestroy) {
      hooks.preDestroy = [];
    }
    hooks.preDestroy.push(propertyKey);
    Reflect.defineMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, hooks, target.constructor);
  };
}

/**
 * Factory decorator
 */
export function Factory<T>(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    if (typeof method !== 'function') {
      throw new Error('Factory decorator can only be applied to methods');
    }

    // Store factory metadata
    const factories = Reflect.getMetadata(METADATA_KEYS.FACTORY_METHODS, target.constructor) || new Map();
    factories.set(name, propertyKey);
    Reflect.defineMetadata(METADATA_KEYS.FACTORY_METHODS, factories, target.constructor);
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
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor injection
      const configs = Reflect.getMetadata('config:inject', target) || {};
      configs[parameterIndex] = path;
      Reflect.defineMetadata('config:inject', configs, target);
    }
  };
}

/**
 * Conditional injection decorator
 */
export function ConditionalInject<T>(
  token: InjectionToken<T>,
  condition: () => boolean
) {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex?: number) {
    if (typeof parameterIndex === 'number') {
      // Constructor injection
      const conditions = Reflect.getMetadata('conditional:inject', target) || {};
      conditions[parameterIndex] = { token, condition };
      Reflect.defineMetadata('conditional:inject', conditions, target);
    }
  };
}

/**
 * Multi-injection decorator (alias for InjectAll for compatibility)
 */
export function InjectMany<T>(token: InjectionToken<T>) {
  return InjectAll(token);
}

/**
 * Enhanced Container with decorator support
 */
export class DecoratorContainer extends Container {
  private config: any = {};
  private factories = new Map<string, (...args: any[]) => any>();
  private lifecycleInstances = new Set<any>();

  /**
   * Set configuration for @Value injections
   */
  setConfig(config: any): this {
    this.config = { ...this.config, ...config };
    return this;
  }

  /**
   * Get configuration value by path
   */
  getConfigValue(path: string, defaultValue?: any): any {
    const parts = path.split('.');
    let value = this.config;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return defaultValue;
      }
    }

    return value;
  }

  /**
   * Register a factory function
   */
  registerFactory(name: string, factory: (...args: any[]) => any): this {
    this.factories.set(name, factory);
    return this;
  }

  /**
   * Resolve a factory function
   */
  resolveFactory(name: string, ...args: any[]): any {
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`Factory '${name}' not found`);
    }
    return factory(...args);
  }

  /**
   * Register a decorated class
   */
  registerClass<T>(target: Constructor<T>): this {
    if (!Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target)) {
      throw new Error(`Class ${target.name} is not decorated with @Injectable`);
    }

    const scope = Reflect.getMetadata(METADATA_KEYS.SCOPE, target) || Scope.Transient;
    const dependencies = Reflect.getMetadata(METADATA_KEYS.INJECT, target) || [];
    const serviceName = Reflect.getMetadata(METADATA_KEYS.SERVICE_NAME, target);

    // Use service name if available, otherwise use class-based token
    const token = serviceName ? createToken<T>(serviceName) : tokenFromClass(target);

    this.register(token, {
      useClass: target,
      scope,
      inject: dependencies
    });

    return this;
  }

  /**
   * Auto-register all decorated classes
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

  /**
   * Override register to handle decorator metadata
   */
  override register<T>(
    token: InjectionToken<T>,
    provider: Provider<T>,
    options?: RegistrationOptions
  ): this {
    // If registering a class with decorator metadata, use it
    if ('useClass' in provider && provider.useClass) {
      const classConstructor = provider.useClass;
      const metadata = getInjectableMetadata(classConstructor);

      if (metadata.isInjectable) {
        // Build dependency list and register value injections first
        const dependencies = this.buildDependencyList(classConstructor);

        // Override provider with decorator metadata
        const decoratorProvider: Provider<T> = {
          ...provider,
          scope: provider.scope || (metadata.scope as Scope),
          inject: dependencies
        };

        return super.register(token, decoratorProvider, options || {});
      }
    }

    return super.register(token, provider, options || {});
  }

  /**
   * Build dependency list from metadata
   */
  private buildDependencyList(classConstructor: Constructor<any>): InjectionToken<any>[] {
    const paramTypes = Reflect.getMetadata('design:paramtypes', classConstructor) || [];
    const injectParams = Reflect.getMetadata(METADATA_KEYS.INJECT_PARAMS, classConstructor) || {};
    const optionalParams = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, classConstructor) || {};
    const valueParams = Reflect.getMetadata(METADATA_KEYS.VALUE_INJECTIONS, classConstructor) || {};
    const multiParams = Reflect.getMetadata(METADATA_KEYS.MULTI_INJECTIONS, classConstructor) || {};
    const lazyParams = Reflect.getMetadata(METADATA_KEYS.LAZY_INJECTIONS, classConstructor) || {};

    const dependencies: InjectionToken<any>[] = [];

    for (let i = 0; i < paramTypes.length; i++) {
      const injectToken = injectParams[i];
      const valueConfig = valueParams[i];
      const multiToken = multiParams[i];
      const lazyFactory = lazyParams[i];
      const isOptional = optionalParams[i];

      // Remove debug for now

      if (injectToken) {
        // Handle lazy injection tokens
        if (typeof injectToken === 'object' && injectToken.name && injectToken.name.startsWith('__LAZY_') && injectToken.name.includes(`${classConstructor.name}_`)) {
          const lazyToken = injectToken;

          // Get the factory function from our registry
          const factoryKey = `${classConstructor.name}:${i}`;
          const lazyFactory = lazyFactoryRegistry.get(factoryKey);

          if (!lazyFactory) {
            throw new Error(`No lazy factory found for ${factoryKey}. Available keys: ${Array.from(lazyFactoryRegistry.keys()).join(', ')}`);
          }

          // Register lazy provider
          super.register(lazyToken, {
            useFactory: () => () => {
              const actualToken = lazyFactory();
              return this.resolve(actualToken);
            }
          });
          dependencies.push(lazyToken);
        } else if (isOptional) {
          // Handle optional injection - wrap the token to make it optional
          const optionalToken = createToken(`__OPTIONAL_${typeof injectToken === 'string' ? injectToken : injectToken.toString()}__`);
          super.register(optionalToken, {
            useFactory: () => {
              try {
                return this.resolve(injectToken);
              } catch (error) {
                return undefined;
              }
            }
          });
          dependencies.push(optionalToken);
        } else {
          dependencies.push(injectToken);
        }
      } else if (valueConfig) {
        // Create a special provider for value injection
        const valueToken = createToken(`__VALUE_${valueConfig.path}__`);
        super.register(valueToken, {
          useValue: this.getConfigValue(valueConfig.path, valueConfig.defaultValue)
        });
        dependencies.push(valueToken);
      } else if (multiToken) {
        // Create a special provider that resolves multiple instances
        const multiProviderToken = createToken(`__MULTI_${i}__`);
        super.register(multiProviderToken, {
          useFactory: () => this.resolveMany(multiToken)
        });
        dependencies.push(multiProviderToken);
      } else if (paramTypes[i] && !isOptional) {
        // Try to use the type as token
        dependencies.push(tokenFromClass(paramTypes[i]));
      } else if (isOptional) {
        // For optional parameters without explicit token, use undefined
        const optionalToken = createToken(`__OPTIONAL_${i}__`);
        super.register(optionalToken, { useValue: undefined });
        dependencies.push(optionalToken);
      } else {
        // No parameter info, add null placeholder
        dependencies.push(null as any);
      }
    }

    return dependencies;
  }

  /**
   * Override resolve to handle decorator-specific features
   */
  override resolve<T>(token: InjectionToken<T>, context?: Partial<import('../types/core').ResolutionContext>): T {
    // Handle value injections
    if (typeof token === 'string' && token.startsWith('__VALUE_')) {
      const path = token.substring(8, token.length - 2); // Remove __VALUE_ and __
      return this.getConfigValue(path) as T;
    }

    // Handle optional parameters
    if (typeof token === 'string' && token.startsWith('__OPTIONAL_')) {
      return undefined as T;
    }

    // Handle lazy tokens - they should return a function
    if (typeof token === 'string' && token.startsWith('__LAZY_')) {
      return super.resolve(token, context);
    }

    const instance = super.resolve(token, context);

    // Handle property injections and container metadata if instance exists and has a constructor
    if (instance && instance.constructor) {
      this.injectProperties(instance, instance.constructor as Constructor<any>);

      // Track instances that have lifecycle hooks
      const lifecycleHooks: LifecycleHooks = Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, instance.constructor) || {};
      if (lifecycleHooks.postConstruct || lifecycleHooks.preDestroy) {
        this.lifecycleInstances.add(instance);
      }
    }

    return instance;
  }

  /**
   * Override initialize to handle lifecycle hooks
   */
  override async initialize(): Promise<void> {
    await super.initialize();

    // Call PostConstruct hooks on all initialized instances
    await this.callLifecycleHooks('postConstruct');
  }

  /**
   * Override dispose to handle lifecycle hooks
   */
  override async dispose(): Promise<void> {
    // Call PreDestroy hooks before disposing
    await this.callLifecycleHooks('preDestroy');

    await super.dispose();
  }

  /**
   * Call lifecycle hooks on instances
   */
  private async callLifecycleHooks(hookType: 'postConstruct' | 'preDestroy'): Promise<void> {
    // The issue is that we're trying to find instances in caches, but for transient instances
    // they won't be cached. We need a different approach - we need to track instances that
    // have been created and have lifecycle hooks.

    // For now, we'll use a simple approach - track instances that have been resolved
    // and have lifecycle hooks in a dedicated Set.
    if (!this.lifecycleInstances) {
      this.lifecycleInstances = new Set<any>();
    }

    // Call hooks on tracked instances
    for (const instance of this.lifecycleInstances) {
      if (!instance || !instance.constructor) continue;

      const classConstructor = instance.constructor as Constructor<any>;
      const lifecycleHooks: LifecycleHooks = Reflect.getMetadata(METADATA_KEYS.LIFECYCLE_HOOKS, classConstructor) || {};
      const hooks = lifecycleHooks[hookType];

      if (hooks && hooks.length > 0) {
        for (const methodName of hooks) {
          if (typeof instance[methodName] === 'function') {
            try {
              const result = instance[methodName]();
              if (result && typeof result.then === 'function') {
                await result;
              }
            } catch (error) {
              console.error(`Failed to call ${hookType} hook ${methodName} on ${classConstructor.name}:`, error);
            }
          }
        }
      }
    }
  }

  /**
   * Inject properties
   */
  private injectProperties(instance: any, classConstructor: Constructor<any>): void {
    // Only proceed if we have a valid instance that can hold metadata
    if (!instance || typeof instance !== 'object') {
      return;
    }

    const propertyInjections = Reflect.getMetadata(METADATA_KEYS.PROPERTY_INJECTIONS, classConstructor);
    if (propertyInjections) {
      for (const [propertyKey, propertyToken] of Object.entries(propertyInjections)) {
        try {
          (instance as any)[propertyKey] = this.resolve(propertyToken as InjectionToken<any>);
        } catch (error) {
          // Handle optional property injections
          const optionalProps = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, classConstructor);
          if (!optionalProps?.[propertyKey]) {
            throw error;
          }
        }
      }
    }

    // Store container reference for lazy injections - use try/catch to handle edge cases
    try {
      Reflect.defineMetadata('container', this, instance);
    } catch (error) {
      // Some objects might not support metadata - that's okay, skip it
    }
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
    metadata: Reflect.getMetadata(METADATA_KEYS.PROVIDER_METADATA, target) || {},
    serviceName: Reflect.getMetadata(METADATA_KEYS.SERVICE_NAME, target),
    propertyInjections: Reflect.getMetadata(METADATA_KEYS.PROPERTY_INJECTIONS, target) || {},
    valueInjections: Reflect.getMetadata(METADATA_KEYS.VALUE_INJECTIONS, target) || {},
    multiInjections: Reflect.getMetadata(METADATA_KEYS.MULTI_INJECTIONS, target) || {},
    lazyInjections: Reflect.getMetadata(METADATA_KEYS.LAZY_INJECTIONS, target) || {}
  };
}

/**
 * Export metadata keys and utilities
 */
export { DecoratorContainer as Container };

// Re-export custom decorator API
export {
  Retry,
  Memoize,
  Validate,
  Deprecated,
  hasDecorator,
  createDecorator,
  getCustomMetadata,
  combineDecorators,
  getDecoratorOptions,
  getAllCustomMetadata,
  CustomDecoratorBuilder,
  createMethodInterceptor,
  createPropertyInterceptor,
  createParameterizedDecorator
} from './custom-decorators';

// Re-export common types for convenience
export type { Scope, Provider, InjectionToken } from '../types/core';

// Re-export types from custom decorators
export type {
  DecoratorHook,
  DecoratorTarget,
  DecoratorContext,
  OptionsValidator,
  MetadataTransform,
  DecoratorTransform,
  CustomDecoratorConfig
} from './custom-decorators';