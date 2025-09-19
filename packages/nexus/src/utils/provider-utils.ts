/**
 * Provider Utilities for Nexus DI Container
 *
 * Unified provider format handling and normalization
 */

import type {
  Provider,
  InjectionToken,
  Constructor,
  ExplicitProvider,
  ClassProvider,
  ValueProvider,
  FactoryProvider,
  AsyncFactoryProvider,
  TokenProvider,
  NormalizedProvider
} from '../types/core.js';

/**
 * Check if a value is an explicit provider (with 'provide' field)
 */
export function isExplicitProvider(value: any): value is ExplicitProvider {
  return value && typeof value === 'object' && 'provide' in value;
}

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
 * Normalize a provider to a consistent format
 *
 * Handles multiple input formats:
 * - Constructor functions
 * - Explicit providers with 'provide' field
 * - Standard provider objects
 * - Tuple format [token, provider]
 */
export function normalizeProvider<T = any>(
  provider: Provider<T> | ExplicitProvider<T> | [InjectionToken<T>, Provider<T>] | Constructor<T>
): NormalizedProvider<T> {
  // Already in tuple format
  if (Array.isArray(provider) && provider.length === 2) {
    return provider as [InjectionToken<T>, Provider<T>];
  }

  // Explicit provider with 'provide' field
  if (isExplicitProvider(provider)) {
    const { provide, ...providerDef } = provider;

    // Convert to appropriate provider type
    let normalizedProvider: Provider<T>;

    if ('useClass' in providerDef && providerDef.useClass) {
      normalizedProvider = {
        useClass: providerDef.useClass,
        scope: providerDef.scope,
        inject: providerDef.inject
      } as ClassProvider<T>;
    } else if ('useValue' in providerDef && providerDef.useValue !== undefined) {
      normalizedProvider = {
        useValue: providerDef.useValue,
        validate: providerDef.validate
      } as ValueProvider<T>;
    } else if ('useFactory' in providerDef && providerDef.useFactory) {
      if (providerDef.async) {
        normalizedProvider = {
          useFactory: providerDef.useFactory as any,
          inject: providerDef.inject,
          scope: providerDef.scope,
          timeout: providerDef.timeout,
          retry: providerDef.retry,
          async: true
        } as AsyncFactoryProvider<T>;
      } else {
        normalizedProvider = {
          useFactory: providerDef.useFactory as any,
          inject: providerDef.inject,
          scope: providerDef.scope
        } as FactoryProvider<T>;
      }
    } else if ('useToken' in providerDef && providerDef.useToken) {
      normalizedProvider = {
        useToken: providerDef.useToken
      } as TokenProvider<T>;
    } else {
      throw new Error(`Invalid explicit provider: ${JSON.stringify(provider)}`);
    }

    return [provide, normalizedProvider];
  }

  // Constructor or standard provider
  return provider as Provider<T>;
}

/**
 * Normalize an array of providers
 */
export function normalizeProviders(
  providers: any[] | undefined
): NormalizedProvider[] {
  if (!providers) return [];
  return providers.map(p => normalizeProvider(p));
}

/**
 * Convert providers to registration format for Container
 */
export function providersToRegistrations(
  providers: any[] | undefined
): Array<{ token: InjectionToken<any>; provider: Provider<any> }> {
  const normalized = normalizeProviders(providers);
  const registrations: Array<{ token: InjectionToken<any>; provider: Provider<any> }> = [];

  for (const item of normalized) {
    if (Array.isArray(item)) {
      // Tuple format [token, provider]
      registrations.push({ token: item[0], provider: item[1] });
    } else if (isConstructor(item)) {
      // Constructor - use as both token and provider
      registrations.push({ token: item, provider: { useClass: item } });
    } else {
      // Standard provider object - this shouldn't happen in well-formed code
      console.warn('Provider without explicit token detected:', item);
    }
  }

  return registrations;
}

/**
 * Extract token from a provider
 */
export function getProviderToken(
  provider: Provider | ExplicitProvider | [InjectionToken<any>, Provider] | Constructor
): InjectionToken<any> | undefined {
  if (Array.isArray(provider)) {
    return provider[0];
  }
  if (isExplicitProvider(provider)) {
    return provider.provide;
  }
  if (isConstructor(provider)) {
    return provider;
  }
  return undefined;
}

/**
 * Create value provider in normalized format
 */
export function createValueProvider<T>(
  token: InjectionToken<T>,
  value: T
): [InjectionToken<T>, ValueProvider<T>] {
  return [token, { useValue: value }];
}

/**
 * Create factory provider in normalized format
 */
export function createFactoryProvider<T>(
  token: InjectionToken<T>,
  factory: (...args: any[]) => T | Promise<T>,
  options?: {
    inject?: InjectionToken<any>[];
    scope?: string;
    async?: boolean;
  }
): [InjectionToken<T>, FactoryProvider<T> | AsyncFactoryProvider<T>] {
  if (options?.async) {
    return [token, {
      useFactory: factory as any,
      inject: options.inject,
      scope: options.scope as any,
      async: true
    } as AsyncFactoryProvider<T>];
  }

  return [token, {
    useFactory: factory as any,
    inject: options?.inject,
    scope: options?.scope as any
  } as FactoryProvider<T>];
}

/**
 * Create class provider in normalized format
 */
export function createClassProvider<T>(
  token: InjectionToken<T>,
  useClass: Constructor<T>,
  options?: {
    scope?: string;
    inject?: InjectionToken<any>[];
  }
): [InjectionToken<T>, ClassProvider<T>] {
  return [token, {
    useClass,
    scope: options?.scope as any,
    inject: options?.inject
  }];
}

/**
 * Create explicit provider (with 'provide' field)
 */
export function createExplicitProvider<T>(
  token: InjectionToken<T>,
  provider: Provider<T>
): ExplicitProvider<T> {
  if ('useClass' in provider) {
    return {
      provide: token,
      useClass: provider.useClass,
      scope: provider.scope,
      inject: provider.inject
    };
  } else if ('useValue' in provider) {
    return {
      provide: token,
      useValue: provider.useValue,
      validate: provider.validate
    };
  } else if ('useFactory' in provider) {
    const factoryProvider = provider as FactoryProvider<T> | AsyncFactoryProvider<T>;
    const asyncProvider = provider as AsyncFactoryProvider<T>;
    return {
      provide: token,
      useFactory: factoryProvider.useFactory,
      inject: 'inject' in factoryProvider ? factoryProvider.inject : undefined,
      scope: 'scope' in factoryProvider ? factoryProvider.scope : undefined,
      async: 'async' in asyncProvider ? asyncProvider.async : undefined,
      timeout: 'timeout' in asyncProvider ? asyncProvider.timeout : undefined,
      retry: 'retry' in asyncProvider ? asyncProvider.retry : undefined
    };
  } else if ('useToken' in provider) {
    return {
      provide: token,
      useToken: provider.useToken
    };
  }

  throw new Error(`Cannot create explicit provider from: ${JSON.stringify(provider)}`);
}

/**
 * Merge provider arrays, handling duplicates
 *
 * Later providers override earlier ones with the same token
 */
export function mergeProviders(
  ...providerArrays: Array<any[] | undefined>
): NormalizedProvider[] {
  const mergedProviders: NormalizedProvider[] = [];
  const tokenMap = new Map<InjectionToken<any>, NormalizedProvider>();

  for (const providers of providerArrays) {
    if (!providers) continue;

    for (const provider of providers) {
      const normalized = normalizeProvider(provider);
      const token = getProviderToken(normalized);

      if (token) {
        // Override existing provider with same token
        tokenMap.set(token, normalized);
      } else {
        // Provider without token (shouldn't happen)
        mergedProviders.push(normalized);
      }
    }
  }

  // Add all providers from map in order
  for (const provider of tokenMap.values()) {
    mergedProviders.push(provider);
  }

  return mergedProviders;
}

/**
 * Check if a provider has a specific scope
 */
export function hasScope(provider: Provider, scope: string): boolean {
  if ('scope' in provider) {
    return provider.scope === scope;
  }
  return false;
}

/**
 * Check if a provider is multi-provider
 */
export function isMultiProvider(provider: Provider | ExplicitProvider): boolean {
  if (isExplicitProvider(provider)) {
    return provider.multi === true;
  }
  return false;
}