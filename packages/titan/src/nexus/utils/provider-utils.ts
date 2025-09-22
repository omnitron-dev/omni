/**
 * Provider Utilities for Nexus DI Container
 *
 * Utility functions for working with providers
 */

import type {
  Provider,
  InjectionToken,
  Constructor,
  Factory,
  AsyncFactory,
  Scope
} from '../types/core.js';

/**
 * Check if a value is a constructor
 */
export function isConstructor(value: any): value is Constructor {
  return typeof value === 'function' && value.prototype;
}

/**
 * Check if a provider is async
 */
export function isAsyncProvider(provider: Provider): boolean {
  if ('async' in provider && provider.async === true) {
    return true;
  }
  if ('useFactory' in provider && provider.useFactory) {
    const factory = provider.useFactory as any;
    return factory.constructor.name === 'AsyncFunction' ||
           (typeof factory === 'function' && factory.toString().includes('__awaiter'));
  }
  return false;
}

/**
 * Create a value provider
 * Returns tuple format [token, provider] for clean API
 */
export function createValueProvider<T>(
  token: InjectionToken<T>,
  value: T,
  options?: { validate?: string | ((value: T) => void) }
): [InjectionToken<T>, Provider<T>] {
  return [token, {
    useValue: value,
    ...(options?.validate && { validate: options.validate })
  }];
}

/**
 * Create a factory provider
 * Returns tuple format [token, provider] for clean API
 */
export function createFactoryProvider<T>(
  token: InjectionToken<T>,
  factory: (...args: any[]) => T | Promise<T>,
  options?: {
    inject?: InjectionToken[];
    scope?: Scope;
    async?: boolean;
    timeout?: number;
    retry?: { maxAttempts: number; delay: number };
  }
): [InjectionToken<T>, Provider<T>] {
  return [token, {
    useFactory: factory as Factory<T> | AsyncFactory<T>,
    ...(options?.inject && { inject: options.inject }),
    ...(options?.scope && { scope: options.scope }),
    ...(options?.async && { async: options.async }),
    ...(options?.timeout && { timeout: options.timeout }),
    ...(options?.retry && { retry: options.retry })
  }];
}

/**
 * Create a class provider
 * Returns tuple format [token, provider] for clean API
 */
export function createClassProvider<T>(
  token: InjectionToken<T>,
  useClass: Constructor<T>,
  options?: {
    scope?: Scope;
    inject?: InjectionToken[];
  }
): [InjectionToken<T>, Provider<T>] {
  return [token, {
    useClass,
    ...(options?.scope && { scope: options.scope }),
    ...(options?.inject && { inject: options.inject })
  }];
}

/**
 * Create a token provider (alias)
 * Returns tuple format [token, provider] for clean API
 */
export function createTokenProvider<T>(
  token: InjectionToken<T>,
  useToken: InjectionToken<T>
): [InjectionToken<T>, Provider<T>] {
  return [token, {
    useToken
  }];
}

/**
 * Create a multi-provider
 * Returns array of tuple format for clean API
 */
export function createMultiProvider<T>(
  token: InjectionToken<T>,
  providers: Array<Provider<T>>
): Array<[InjectionToken<T>, Provider<T>]> {
  return providers.map(provider => {
    if (typeof provider === 'object' && provider !== null) {
      return [token, { ...provider, multi: true }];
    }
    return [token, provider];
  });
}

/**
 * Check if a provider is a multi-provider
 */
export function isMultiProvider(provider: Provider): boolean {
  return 'multi' in provider && provider.multi === true;
}

/**
 * Check if a provider has a specific scope
 */
export function hasScope(provider: Provider, scope: Scope): boolean {
  return 'scope' in provider && provider.scope === scope;
}

/**
 * Create a conditional provider
 * Returns tuple format [token, provider] for clean API
 */
export function createConditionalProvider<T>(
  token: InjectionToken<T>,
  provider: Provider<T>,
  condition: (context: any) => boolean,
  fallback?: Provider<T>
): [InjectionToken<T>, Provider<T>] {
  if (typeof provider === 'object' && provider !== null && typeof provider !== 'function') {
    return [token, {
      ...provider,
      condition,
      ...(fallback && { fallback })
    }];
  }
  // For constructor providers, create a class provider with condition
  if (typeof provider === 'function') {
    return [token, {
      useClass: provider as Constructor<T>,
      condition,
      ...(fallback && { fallback })
    }];
  }
  return [token, provider];
}