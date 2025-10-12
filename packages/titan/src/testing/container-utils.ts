/**
 * Container Utilities for Testing
 *
 * Provides utilities for working with containers in tests
 */

import { Container, type InjectionToken, type Provider } from '../nexus/index.js';

/**
 * Register providers from a module into a container
 *
 * Handles tuple format [token, provider] and direct constructors
 */
export function registerModuleProviders(container: Container, providers: any[] | undefined): void {
  if (!providers) return;

  for (const provider of providers) {
    if (Array.isArray(provider) && provider.length === 2) {
      // Tuple format [token, provider]
      const [token, providerDef] = provider;
      container.register(token, providerDef);
    } else if (typeof provider === 'function') {
      // Constructor - register as class provider
      container.register(provider, { useClass: provider });
    } else {
      // Provider object without token - shouldn't happen
      console.warn('Provider without token:', provider);
    }
  }
}

/**
 * Register a single provider in the container
 */
export function registerProvider(container: Container, token: InjectionToken<any>, provider: Provider): void {
  // Always use register - Container will handle the provider type
  container.register(token, provider);
}

/**
 * Create a test container with providers
 */
export function createTestContainer(providers?: any[]): Container {
  const container = new Container();
  registerModuleProviders(container, providers);
  return container;
}

/**
 * Helper to resolve a service from a module
 */
export async function resolveFromModule<T>(module: { providers?: any[] }, token: InjectionToken<T>): Promise<T> {
  const container = createTestContainer(module.providers);
  return container.resolveAsync(token);
}

/**
 * Helper to check if a provider exists in a module
 */
export function hasProvider(module: { providers?: any[] }, token: InjectionToken<any>): boolean {
  if (!module.providers) return false;

  for (const provider of module.providers) {
    if (Array.isArray(provider)) {
      if (provider[0] === token) return true;
    } else if (provider === token) {
      return true;
    }
  }

  return false;
}

/**
 * Extract all tokens from a module's providers
 */
export function getModuleTokens(module: { providers?: any[] }): InjectionToken<any>[] {
  if (!module.providers) return [];

  const tokens: InjectionToken<any>[] = [];

  for (const provider of module.providers) {
    if (Array.isArray(provider)) {
      tokens.push(provider[0]);
    } else if (typeof provider === 'function') {
      tokens.push(provider);
    }
  }

  return tokens;
}

/**
 * Create a mock container for testing
 */
export class MockContainer extends Container {
  private mocks = new Map<InjectionToken<any>, any>();

  /**
   * Register a mock for a token
   */
  mock<T>(token: InjectionToken<T>, value: T): this {
    this.mocks.set(token, value);
    this.register(token, { useValue: value });
    return this;
  }

  /**
   * Get a mock by token
   */
  getMock<T>(token: InjectionToken<T>): T | undefined {
    return this.mocks.get(token);
  }

  /**
   * Clear all mocks
   */
  clearMocks(): void {
    this.mocks.clear();
  }

  /**
   * Check if a token has a mock
   */
  hasMock(token: InjectionToken<any>): boolean {
    return this.mocks.has(token);
  }
}
