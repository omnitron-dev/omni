/**
 * Dependency Injection - Scope Management
 *
 * Manages provider scopes and lifetimes
 */

import 'reflect-metadata';
import type { ProviderScope } from './types.js';

/**
 * Scope manager for tracking provider instances
 */
export class ScopeManager {
  private singletons = new Map<any, any>();
  private moduleInstances = new Map<string, Map<any, any>>();
  private requestInstances = new Map<string, Map<any, any>>();

  /**
   * Get instance for a given scope
   */
  getInstance<T>(token: any, scope: ProviderScope, moduleId?: string, requestId?: string): T | undefined {
    switch (scope) {
      case 'singleton':
        return this.singletons.get(token);

      case 'module':
        if (!moduleId) return undefined;
        return this.moduleInstances.get(moduleId)?.get(token);

      case 'request':
        if (!requestId) return undefined;
        return this.requestInstances.get(requestId)?.get(token);

      case 'transient':
        return undefined; // Always create new instance

      default:
        return undefined;
    }
  }

  /**
   * Set instance for a given scope
   */
  setInstance<T>(token: any, instance: T, scope: ProviderScope, moduleId?: string, requestId?: string): void {
    switch (scope) {
      case 'singleton':
        this.singletons.set(token, instance);
        break;

      case 'module':
        if (!moduleId) break;
        if (!this.moduleInstances.has(moduleId)) {
          this.moduleInstances.set(moduleId, new Map());
        }
        this.moduleInstances.get(moduleId)!.set(token, instance);
        break;

      case 'request':
        if (!requestId) break;
        if (!this.requestInstances.has(requestId)) {
          this.requestInstances.set(requestId, new Map());
        }
        this.requestInstances.get(requestId)!.set(token, instance);
        break;

      case 'transient':
        // Don't cache transient instances
        break;
    }
  }

  /**
   * Clear request scope instances
   */
  clearRequest(requestId: string): void {
    this.requestInstances.delete(requestId);
  }

  /**
   * Clear module scope instances
   */
  clearModule(moduleId: string): void {
    this.moduleInstances.delete(moduleId);
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.singletons.clear();
    this.moduleInstances.clear();
    this.requestInstances.clear();
  }
}

/**
 * Get the default scope for a provider
 */
export function getDefaultScope(provider: any): ProviderScope {
  if (typeof provider === 'function') {
    // Check if provider has Injectable metadata
    const metadata = Reflect.getMetadata?.('injectable:options', provider);
    if (metadata?.scope) {
      return metadata.scope;
    }
  }
  return 'singleton';
}
