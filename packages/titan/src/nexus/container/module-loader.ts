/**
 * Module loading logic for Nexus DI Container
 *
 * Handles module resolution, provider tracking, and token-to-module mapping.
 *
 * @internal
 * @since 0.1.0
 */

import { IModule, InjectionToken } from '../types.js';
import type { ModuleProviderInfo, ResolvedModule } from './types.js';

/**
 * ModuleLoaderService handles module loading and dependency management
 */
export class ModuleLoaderService {
  // Flat index for O(1) token-to-module lookup (optimization from O(m) iteration)
  private tokenModuleIndex = new Map<
    string,
    { moduleName: string; isGlobal: boolean; isExported: boolean }
  >();
  // Cache for getTokenKey results to avoid repeated computation
  private tokenKeyCache = new WeakMap<object, string>();

  /**
   * Resolve a forward reference or return the module as-is
   */
  resolveModule(moduleOrRef: any): ResolvedModule {
    // Check if it's a forward reference (function that returns a module)
    if (typeof moduleOrRef === 'function' && !moduleOrRef.name) {
      return { module: moduleOrRef(), isForwardRef: true };
    }
    return { module: moduleOrRef, isForwardRef: false };
  }

  /**
   * Get module dispose order (reverse dependency order)
   */
  getModuleDisposeOrder(modules: Map<string, IModule>, moduleImports: Map<string, Set<string>>): string[] {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (moduleName: string) => {
      if (visited.has(moduleName)) return;
      visited.add(moduleName);

      // Visit all modules that depend on this module first
      for (const [otherModuleName, imports] of moduleImports.entries()) {
        if (imports.has(moduleName)) {
          visit(otherModuleName);
        }
      }

      // Add this module to the order (dependents are added first)
      order.push(moduleName);
    };

    // Visit all modules
    for (const moduleName of modules.keys()) {
      visit(moduleName);
    }

    return order;
  }

  /**
   * Get a consistent key for a token to use in Maps
   * Uses WeakMap caching for object tokens to avoid repeated computation
   */
  getTokenKey(token: InjectionToken<any>): string {
    // Fast path for string tokens (most common case)
    if (typeof token === 'string') {
      return token;
    }

    // Fast path for symbols
    if (typeof token === 'symbol') {
      return token.toString();
    }

    // For functions and objects, check cache first
    if (typeof token === 'function' || (token && typeof token === 'object')) {
      const cached = this.tokenKeyCache.get(token);
      if (cached !== undefined) {
        return cached;
      }

      let key: string;
      if (typeof token === 'function') {
        // For constructors, use the constructor name
        key = token.name || token.toString();
      } else if ('name' in token) {
        // For token objects, use the name property
        key = (token as any).name;
      } else {
        // Fallback to string representation
        key = String(token);
      }

      // Cache the result
      this.tokenKeyCache.set(token, key);
      return key;
    }

    // Fallback to string representation
    return String(token);
  }

  /**
   * Track provider for module
   */
  trackModuleProvider(
    moduleName: string,
    token: InjectionToken<any>,
    isExported: boolean,
    isGlobal: boolean,
    moduleProviders: Map<string, Map<string, ModuleProviderInfo>>
  ): void {
    if (!moduleProviders.has(moduleName)) {
      moduleProviders.set(moduleName, new Map());
    }

    const tokenKey = this.getTokenKey(token);
    moduleProviders.get(moduleName)!.set(tokenKey, {
      token,
      exported: isExported,
      global: isGlobal,
    });

    // Update flat index for O(1) lookup during resolution
    this.tokenModuleIndex.set(tokenKey, {
      moduleName,
      isGlobal,
      isExported,
    });
  }

  /**
   * Get module info for a token using O(1) lookup
   */
  getTokenModuleInfo(tokenKey: string): { moduleName: string; isGlobal: boolean; isExported: boolean } | undefined {
    return this.tokenModuleIndex.get(tokenKey);
  }

  /**
   * Find module for a token (O(1) lookup)
   */
  findModuleForToken(
    token: InjectionToken<any>,
    moduleProviders: Map<string, Map<string, ModuleProviderInfo>> | undefined
  ): string | undefined {
    const tokenKey = this.getTokenKey(token);
    const info = this.tokenModuleIndex.get(tokenKey);
    return info?.moduleName;
  }

  /**
   * Clear internal caches (for dispose)
   */
  clear(): void {
    this.tokenModuleIndex.clear();
    // Note: tokenKeyCache (WeakMap) clears itself when keys are garbage collected
  }

  /**
   * Check if token is exported from module
   */
  isTokenExported(module: IModule, token: InjectionToken<any>): boolean {
    // If exports is undefined, all providers are exported by default
    // If exports is defined (even as empty array), only specified tokens are exported
    if (module.exports === undefined) return true;
    
    return module.exports.some((exportedToken) => 
      this.getTokenKey(exportedToken) === this.getTokenKey(token)
    );
  }
}
