/**
 * Scope management for Nexus DI Container
 *
 * Handles singleton, transient, scoped, and request-scoped instance management.
 *
 * @internal
 * @since 0.1.0
 */

import { isMultiToken } from '../token.js';
import { Scope, InjectionToken, ResolutionContext } from '../types.js';
import type { Registration } from './types.js';
import type { ContainerStore } from './store.js';
import { LifecycleEvent } from '../lifecycle.js';

/**
 * ScopingService handles scope management and instance caching.
 *
 * NX-9: the container's shared state (instance caches + lifecycle manager) is
 * supplied once via the injected {@link ContainerStore} instead of being threaded
 * through every method as positional arguments. `createInstanceFn` (a callback
 * back into the container) and `context` (per-resolution) remain per-call.
 */
export class ScopingService {
  constructor(private readonly store: ContainerStore) {}

  /**
   * Resolve with scope management
   */
  resolveWithScope<T>(
    registration: Registration,
    context: ResolutionContext,
    createInstanceFn: (registration: Registration) => any
  ): T {
    switch (registration.scope) {
      case Scope.Singleton:
        return this.resolveSingleton(registration, createInstanceFn);
      case Scope.Transient:
        return this.resolveTransient(registration, createInstanceFn);
      case Scope.Scoped:
        return this.resolveScoped(registration, context, createInstanceFn);
      case Scope.Request:
        return this.resolveRequest(registration, context, createInstanceFn);
      default:
        return this.resolveTransient(registration, createInstanceFn);
    }
  }

  /**
   * Resolve singleton
   */
  private resolveSingleton<T>(
    registration: Registration,
    createInstanceFn: (registration: Registration) => any
  ): T {
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

    const instance = createInstanceFn(registration);

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
  private resolveTransient<T>(registration: Registration, createInstanceFn: (registration: Registration) => any): T {
    return createInstanceFn(registration);
  }

  /**
   * Resolve scoped
   */
  private resolveScoped<T>(
    registration: Registration,
    context: ResolutionContext,
    createInstanceFn: (registration: Registration) => any
  ): T {
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

    const instance = createInstanceFn(registration);
    scopeCache.set(registration.token, instance);

    return instance;
  }

  /**
   * Resolve request-scoped
   */
  private resolveRequest<T>(
    registration: Registration,
    context: ResolutionContext,
    createInstanceFn: (registration: Registration) => any
  ): T {
    // For request scope, use scopeId or requestId to identify the request context
    const requestContext = context.metadata?.['scopeId'] || context.metadata?.['requestId'];

    if (!requestContext) {
      // Fallback to transient if no request context
      return this.resolveTransient(registration, createInstanceFn);
    }

    return this.resolveScoped(registration, context, createInstanceFn);
  }

  /**
   * Resolve a single registration
   */
  resolveRegistration(
    registration: Registration,
    context: ResolutionContext,
    createInstanceFn: (registration: Registration) => any
  ): any {
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
      const instance = createInstanceFn(registration);
      instances.set(registration.token, instance);
      return instance;
    } else if (registration.scope === Scope.Transient) {
      return createInstanceFn(registration);
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
      const instance = createInstanceFn(registration);
      scopedMap.set(registration.token, instance);
      return instance;
    }
    return createInstanceFn(registration);
  }
}
