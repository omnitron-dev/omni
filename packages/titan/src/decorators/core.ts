/**
 * Core Dependency Injection Decorators
 *
 * @module decorators/core
 */

import 'reflect-metadata';
import { createDecorator } from './decorator-factory.js';
import type { Constructor } from '../nexus/index.js';

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
} as const;

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
 * Service decorator - marks a class as a service with optional name
 */
export const Service = createDecorator<string | { name?: string; version?: string }>()
  .withName('Service')
  .forClass()
  .withMetadata((context: any) => {
    const name = typeof context.options === 'string' ? context.options : context.options?.name;
    const version = typeof context.options === 'object' ? context.options?.version : undefined;

    // Set service metadata
    Reflect.defineMetadata('service', { name, version }, context.target);

    if (name) {
      Reflect.defineMetadata(METADATA_KEYS.SERVICE_NAME, name, context.target);
    }

    return { service: true, name, version };
  })
  .withHooks({
    afterApply: (context: any) => {
      // Apply Injectable decorator
      Injectable({ scope: 'singleton' })(context.target);
    }
  })
  .build();

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