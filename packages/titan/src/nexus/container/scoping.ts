/**
 * Scope management for Nexus DI Container
 *
 * Handles singleton, transient, scoped, and request-scoped instance management.
 *
 * @internal
 * @since 0.1.0
 */

import { isMultiToken } from '../token.js';
import { Scope, ResolutionContext } from '../types.js';
import type { Registration } from './types.js';
import type { ContainerStore } from './store.js';
import { LifecycleEvent } from '../lifecycle.js';

/**
 * ScopingService handles scope management and instance caching.
 *
 * NX-9: everything the service needs — the instance caches, the lifecycle
 * manager, and the `createInstance` hook back into the container — is supplied
 * once via the injected {@link ContainerStore} instead of being threaded through
 * every method as positional arguments. Only `context` (per-resolution) is
 * passed per call.
 */
export class ScopingService {
  constructor(private readonly store: ContainerStore) {}

  /**
   * Resolve with scope management
   */
  resolveWithScope<T>(registration: Registration, context: ResolutionContext): T {
    switch (registration.scope) {
      case Scope.Singleton:
        return this.resolveSingleton(registration);
      case Scope.Transient:
        return this.resolveTransient(registration);
      case Scope.Scoped:
        return this.resolveScoped(registration, context);
      case Scope.Request:
        return this.resolveRequest(registration, context);
      default:
        return this.resolveTransient(registration);
    }
  }

  /**
   * Resolve singleton
   */
  private resolveSingleton<T>(registration: Registration): T {
    const { instances, lifecycleManager } = this.store;

    // For multi-tokens with useValue, always return the value directly
    if (registration.options?.multi && 'useValue' in registration.provider) {
      return (registration.provider as any).useValue;
    }

    // Check if instance already exists in registration
    if (registration.instance !== undefined) {
      // Emit cache hit for singleton reuse
      lifecycleManager.emitSync(LifecycleEvent.CacheHit, {
        token: registration.token,
      });
      return registration.instance;
    }

    // For individual registrations (not multi-token), check if already resolved
    if (!isMultiToken(registration.token) && !registration.options?.multi) {
      if (instances.has(registration.token)) {
        // Emit cache hit for singleton reuse
        lifecycleManager.emitSync(LifecycleEvent.CacheHit, {
          token: registration.token,
        });
        return instances.get(registration.token);
      }
    }

    const instance = this.store.createInstance(registration);

    // Don't cache instance for multi-tokens
    if (!registration.options?.multi) {
      registration.instance = instance;
    }

    // Only cache in instances map for non-multi-tokens
    if (!isMultiToken(registration.token) && !registration.options?.multi) {
      instances.set(registration.token, instance);
    }

    return instance;
  }

  /**
   * Resolve transient
   */
  private resolveTransient<T>(registration: Registration): T {
    return this.store.createInstance(registration);
  }

  /**
   * Resolve scoped
   */
  private resolveScoped<T>(registration: Registration, context: ResolutionContext): T {
    const { scopedInstances } = this.store;
    const scopeId = context.metadata?.['scopeId'] || 'default';

    // Each scope maintains its own instances - don't share with parent
    if (!scopedInstances.has(scopeId)) {
      scopedInstances.set(scopeId, new Map());
    }

    const scopeCache = scopedInstances.get(scopeId)!;

    if (scopeCache.has(registration.token)) {
      return scopeCache.get(registration.token);
    }

    const instance = this.store.createInstance(registration);
    scopeCache.set(registration.token, instance);

    return instance;
  }

  /**
   * Resolve request-scoped
   */
  private resolveRequest<T>(registration: Registration, context: ResolutionContext): T {
    // For request scope, use scopeId or requestId to identify the request context
    const requestContext = context.metadata?.['scopeId'] || context.metadata?.['requestId'];

    if (!requestContext) {
      // Fallback to transient if no request context
      return this.resolveTransient(registration);
    }

    return this.resolveScoped(registration, context);
  }

  /**
   * Resolve a single registration
   */
  resolveRegistration(registration: Registration, context: ResolutionContext): any {
    const { instances, scopedInstances } = this.store;

    // Handle different scopes
    if (registration.scope === Scope.Singleton) {
      // For multi-injection with useValue, don't use the shared instances cache
      // Each registration should return its own value
      if (registration.options?.multi && 'useValue' in registration.provider) {
        return (registration.provider as any).useValue;
      }

      if (instances.has(registration.token)) {
        return instances.get(registration.token);
      }
      const instance = this.store.createInstance(registration);
      instances.set(registration.token, instance);
      return instance;
    } else if (registration.scope === Scope.Transient) {
      return this.store.createInstance(registration);
    } else if (registration.scope === Scope.Scoped || registration.scope === Scope.Request) {
      const scopeKey = context.scope || 'default';
      let scopedMap = scopedInstances.get(scopeKey);
      if (!scopedMap) {
        scopedMap = new Map();
        scopedInstances.set(scopeKey, scopedMap);
      }
      if (scopedMap.has(registration.token)) {
        return scopedMap.get(registration.token);
      }
      const instance = this.store.createInstance(registration);
      scopedMap.set(registration.token, instance);
      return instance;
    }
    return this.store.createInstance(registration);
  }
}
