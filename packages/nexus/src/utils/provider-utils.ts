/**
 * Provider Utilities for Nexus DI Container
 *
 * Unified provider format handling and normalization
 */

import type {
  Provider,
  ProviderDefinition,
  ProviderInput,
  InjectionToken,
  Constructor,
  Factory,
  AsyncFactory
} from '../types/core.js';

/**
 * Check if a value is a provider with 'provide' field
 */
export function isProvider(value: any): value is Provider {
  return value && typeof value === 'object' && 'provide' in value;
}

/**
 * Legacy alias for backward compatibility
 * @deprecated Use isProvider instead
 */
export const isExplicitProvider = isProvider;

/**
 * Check if a value is a constructor
 */
export function isConstructor(value: any): value is Constructor {
  return typeof value === 'function' && value.prototype;
}

/**
 * Check if a provider is async
 */
export function isAsyncProvider(provider: Provider | ProviderDefinition): boolean {
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
 * Normalize a provider to a consistent format
 *
 * Handles multiple input formats:
 * - Constructor functions
 * - Providers with 'provide' field
 * - Provider definitions without 'provide' field
 * - Tuple format [token, provider]
 */
export function normalizeProvider<T = any>(
  provider: ProviderInput<T> | any
): [InjectionToken<T>, ProviderDefinition<T>] | Provider<T> | Constructor<T> {
  // Already in tuple format
  if (Array.isArray(provider) && provider.length === 2) {
    return provider as [InjectionToken<T>, ProviderDefinition<T>];
  }

  // Provider with 'provide' field - extract token and definition
  if (isProvider(provider)) {
    const { provide, ...definition } = provider;
    return [provide, definition as ProviderDefinition<T>];
  }

  // Constructor - return as-is (will be handled by container)
  if (isConstructor(provider)) {
    return provider as Constructor<T>;
  }

  // Provider definition without 'provide' field - invalid without token
  throw new Error(`Invalid provider format: ${JSON.stringify(provider)}`);
}

/**
 * Extract the token and provider definition from a provider input
 */
export function extractProviderParts<T = any>(
  provider: ProviderInput<T> | Provider<T> | any
): { token?: InjectionToken<T>; definition: ProviderDefinition<T> } {
  // Tuple format
  if (Array.isArray(provider) && provider.length === 2) {
    return { token: provider[0], definition: provider[1] };
  }

  // Provider with 'provide' field
  if (isProvider(provider)) {
    const { provide, ...definition } = provider;
    return { token: provide, definition: definition as ProviderDefinition<T> };
  }

  // Constructor
  if (isConstructor(provider)) {
    return { token: provider as Constructor<T>, definition: { useClass: provider } as ProviderDefinition<T> };
  }

  // Provider definition without token - shouldn't happen
  throw new Error(`Cannot extract provider parts: ${JSON.stringify(provider)}`);
}

/**
 * Normalize an array of providers
 */
export function normalizeProviders(
  providers: any[] | undefined
): Array<[InjectionToken<any>, ProviderDefinition<any>] | Provider<any> | Constructor<any>> {
  if (!providers) return [];
  return providers.map(p => normalizeProvider(p));
}

/**
 * Convert providers to registration format for Container
 */
export function providersToRegistrations(
  providers: any[] | undefined
): Array<{ token: InjectionToken<any>; provider: ProviderDefinition<any> }> {
  if (!providers) return [];

  const registrations: Array<{ token: InjectionToken<any>; provider: ProviderDefinition<any> }> = [];

  for (const provider of providers) {
    const parts = extractProviderParts(provider);
    if (parts.token) {
      registrations.push({ token: parts.token, provider: parts.definition });
    } else {
      console.warn('Provider without token detected:', provider);
    }
  }

  return registrations;
}

/**
 * Extract token from a provider
 */
export function getProviderToken(
  provider: ProviderInput<any> | Provider<any> | any
): InjectionToken<any> | undefined {
  // Tuple format
  if (Array.isArray(provider) && provider.length === 2) {
    return provider[0];
  }

  // Provider with 'provide' field
  if (isProvider(provider)) {
    return provider.provide;
  }

  // Constructor
  if (isConstructor(provider)) {
    return provider;
  }

  return undefined;
}

/**
 * Create a value provider
 */
export function createValueProvider<T>(
  token: InjectionToken<T>,
  value: T,
  options?: { validate?: string | ((value: T) => void) }
): Provider<T> {
  return {
    provide: token,
    useValue: value,
    ...(options?.validate && { validate: options.validate })
  };
}

/**
 * Create a factory provider
 */
export function createFactoryProvider<T>(
  token: InjectionToken<T>,
  factory: (...args: any[]) => T | Promise<T>,
  options?: {
    inject?: InjectionToken[];
    scope?: string;
    async?: boolean;
    timeout?: number;
    retry?: { maxAttempts: number; delay: number };
  }
): Provider<T> {
  return {
    provide: token,
    useFactory: factory as Factory<T> | AsyncFactory<T>,
    ...(options?.inject && { inject: options.inject }),
    ...(options?.scope && { scope: options.scope as any }),
    ...(options?.async && { async: options.async }),
    ...(options?.timeout && { timeout: options.timeout }),
    ...(options?.retry && { retry: options.retry })
  };
}

/**
 * Create a class provider
 */
export function createClassProvider<T>(
  token: InjectionToken<T>,
  useClass: Constructor<T>,
  options?: {
    scope?: string;
    inject?: InjectionToken[];
  }
): Provider<T> {
  return {
    provide: token,
    useClass,
    ...(options?.scope && { scope: options.scope as any }),
    ...(options?.inject && { inject: options.inject })
  };
}

/**
 * Create a token provider (alias)
 */
export function createTokenProvider<T>(
  token: InjectionToken<T>,
  useToken: InjectionToken<T>
): Provider<T> {
  return {
    provide: token,
    useToken
  };
}

/**
 * Create a provider with explicit format
 * @deprecated Use specific provider creation functions instead
 */
export function createExplicitProvider<T>(
  token: InjectionToken<T>,
  provider: ProviderDefinition<T>
): Provider<T> {
  return {
    provide: token,
    ...provider
  } as Provider<T>;
}

/**
 * Merge multiple providers arrays
 */
export function mergeProviders(
  ...providerArrays: Array<any[] | undefined>
): Array<Provider<any> | ProviderInput<any>> {
  const merged: Array<Provider<any> | ProviderInput<any>> = [];
  const seenTokens = new Set<InjectionToken<any>>();

  for (const providers of providerArrays) {
    if (!providers) continue;

    for (const provider of providers) {
      const token = getProviderToken(provider);

      // Skip duplicate tokens (first one wins)
      if (token && seenTokens.has(token)) {
        continue;
      }

      if (token) {
        seenTokens.add(token);
      }

      merged.push(provider);
    }
  }

  return merged;
}

/**
 * Create a multi-provider
 */
export function createMultiProvider<T>(
  token: InjectionToken<T>,
  providers: Array<ProviderDefinition<T>>
): Provider<T>[] {
  return providers.map(provider => ({
    provide: token,
    ...provider,
    multi: true
  } as Provider<T>));
}

/**
 * Check if a provider is a multi-provider
 */
export function isMultiProvider(provider: Provider | ProviderDefinition<any>): boolean {
  return 'multi' in provider && provider.multi === true;
}

/**
 * Check if a provider has a specific scope
 */
export function hasScope(provider: Provider | ProviderDefinition<any>, scope: string): boolean {
  return 'scope' in provider && provider.scope === scope;
}

/**
 * Create a conditional provider
 */
export function createConditionalProvider<T>(
  token: InjectionToken<T>,
  provider: ProviderDefinition<T>,
  condition: (context: any) => boolean,
  fallback?: ProviderDefinition<T>
): Provider<T> {
  return {
    provide: token,
    ...provider,
    condition,
    ...(fallback && { fallback })
  } as Provider<T>;
}