/**
 * Titan Framework - Minimal Decorator Set
 *
 * Only essential decorators for DI and module system.
 * No HTTP, no incomplete implementations, no backward compatibility.
 *
 * @module titan/decorators
 */

import {
  createDecorator,
  createMethodInterceptor,
  Inject as NexusInject,
  Singleton as NexusSingleton,
  Transient as NexusTransient,
  Injectable as NexusInjectable,
  Optional,
  PreDestroy,
  PostConstruct,
  Repository
} from '@nexus';

// ============================================================================
// Module Decorators
// ============================================================================

/**
 * Titan module decorator - defines a module with providers, imports, and exports
 */
export const Module = createDecorator<{
  name?: string;
  version?: string;
  providers?: any[];
  imports?: any[];
  exports?: any[];
}>()
  .withName('Module')
  .forClass()
  .withMetadata((context: any) => {
    Reflect.defineMetadata('module', context.options || {}, context.target);
    Reflect.defineMetadata('nexus:module', context.options || {}, context.target);
    return context.options || {};
  })
  .withHooks({
    afterApply: (context: any) => {
      // Mark for auto-discovery
      (context.target as any).__titanModule = true;
      (context.target as any).__titanModuleMetadata = context.options || {};
    }
  })
  .build();

// ============================================================================
// DI Decorators
// ============================================================================

/**
 * Injectable decorator - marks a class as injectable
 */
export function Injectable(options: any = {}) {
  return function (target: any) {
    NexusInjectable(options)(target);
    Reflect.defineMetadata('injectable', true, target);
    return target;
  };
}

/**
 * Singleton decorator - marks a class as singleton scoped
 */
export function Singleton() {
  return function (target: any) {
    NexusSingleton()(target);
    Reflect.defineMetadata('injectable', true, target);
    Reflect.defineMetadata('scope', 'singleton', target);
    return target;
  };
}

/**
 * Transient decorator - marks a class as transient scoped
 */
export function Transient() {
  return function (target: any) {
    NexusTransient()(target);
    Reflect.defineMetadata('injectable', true, target);
    Reflect.defineMetadata('scope', 'transient', target);
    return target;
  };
}

/**
 * Service decorator - marks a class as a service with optional name and version
 */
export const Service = createDecorator<string | { name?: string; version?: string }>()
  .withName('Service')
  .forClass()
  .withMetadata((context: any) => {
    const name = typeof context.options === 'string' ? context.options : context.options?.name;
    const version = typeof context.options === 'object' ? context.options?.version : undefined;

    Reflect.defineMetadata('service', { name, version }, context.target);
    if (name) {
      Reflect.defineMetadata('nexus:service:name', name, context.target);
    }

    return {
      service: true,
      name,
      version
    };
  })
  .withHooks({
    afterApply: (context: any) => {
      NexusInjectable({ scope: 'singleton' as any })(context.target);
    }
  })
  .build();

// ============================================================================
// Method Interceptors
// ============================================================================

/**
 * Timeout decorator - adds timeout to async methods
 */
export const Timeout = createMethodInterceptor<{ ms: number }>('Timeout', (originalMethod, args, context) => {
  const timeoutMs = context.options?.ms || 5000;

  return Promise.race([
    originalMethod(...args),
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(
        `Method ${context.target.constructor.name}.${String(context.propertyKey)} timed out after ${timeoutMs}ms`
      )), timeoutMs)
    )
  ]);
});

/**
 * Retryable decorator - adds retry logic with exponential backoff
 */
export const Retryable = createMethodInterceptor<{
  attempts?: number;
  delay?: number;
  maxDelay?: number;
  backoff?: number;
  retryOn?: (error: any) => boolean;
}>('Retryable', async (originalMethod, args, context) => {
  const {
    attempts = 3,
    delay = 1000,
    maxDelay = 30000,
    backoff = 2,
    retryOn
  } = context.options || {};

  let lastError: any;
  let currentDelay = delay;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await originalMethod(...args);
    } catch (error) {
      lastError = error;

      if (retryOn && !retryOn(error)) {
        throw error;
      }

      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        currentDelay = Math.min(currentDelay * backoff, maxDelay);

        console.warn(
          `Retry attempt ${attempt}/${attempts} for ${context.target.constructor.name}.${String(context.propertyKey)}`,
          { error, delay: currentDelay }
        );
      }
    }
  }

  throw lastError;
});

// ============================================================================
// Error Classes
// ============================================================================

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// ============================================================================
// Re-exports from Nexus
// ============================================================================

export {
  NexusInject as Inject,
  Optional,
  PostConstruct,
  PreDestroy,
  Repository
};