/**
 * Container Utilities for Testing
 *
 * Provides utilities for working with containers in tests
 */

import { Container, type InjectionToken, type ProviderDefinition, normalizeProvider } from '@omnitron-dev/nexus';

/**
 * Register providers from a module into a container
 *
 * Handles both legacy and Nexus provider formats
 */
export function registerModuleProviders(
  container: Container,
  providers: any[] | undefined
): void {
  if (!providers) return;

  for (const provider of providers) {
    const normalized = normalizeProvider(provider);

    if (Array.isArray(normalized)) {
      // Tuple format [token, provider]
      const [token, providerDef] = normalized;
      registerProvider(container, token, providerDef);
    } else if (typeof normalized === 'function') {
      // Constructor - register as class provider
      container.register(normalized, { useClass: normalized });
    } else {
      // Provider object without token - shouldn't happen
      console.warn('Provider without token:', normalized);
    }
  }
}

/**
 * Register a single provider in the container
 */
export function registerProvider(
  container: Container,
  token: InjectionToken<any>,
  provider: ProviderDefinition
): void {
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
export async function resolveFromModule<T>(
  module: { providers?: any[] },
  token: InjectionToken<T>
): Promise<T> {
  const container = createTestContainer(module.providers);
  return container.resolveAsync(token);
}

/**
 * Helper to check if a provider exists in a module
 */
export function hasProvider(
  module: { providers?: any[] },
  token: InjectionToken<any>
): boolean {
  if (!module.providers) return false;

  for (const provider of module.providers) {
    const normalized = normalizeProvider(provider);

    if (Array.isArray(normalized)) {
      if (normalized[0] === token) return true;
    } else if (normalized === token) {
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
    const normalized = normalizeProvider(provider);

    if (Array.isArray(normalized)) {
      tokens.push(normalized[0]);
    } else if (typeof normalized === 'function') {
      tokens.push(normalized);
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