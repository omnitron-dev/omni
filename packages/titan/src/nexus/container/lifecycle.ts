/**
 * Lifecycle management for Nexus DI Container
 *
 * Handles instance initialization, disposal, and module lifecycle hooks.
 * Supports both interface-based lifecycle (onInit, initialize) and
 * decorator-based lifecycle (@PostConstruct, @PreDestroy).
 *
 * @internal
 * @since 0.1.0
 */

import 'reflect-metadata';
import { getTokenName } from '../token.js';
import { InjectionToken, IModule, Disposable, Initializable } from '../types.js';
import type { ILogger } from '../../modules/logger/logger.types.js';

/**
 * Metadata keys for lifecycle decorators
 */
const LIFECYCLE_METADATA_KEYS = {
  POST_CONSTRUCT: 'nexus:post-construct',
  PRE_DESTROY: 'nexus:pre-destroy',
  // Also check the secondary key set by the decorator
  POST_CONSTRUCT_ALT: 'post-construct',
  PRE_DESTROY_ALT: 'pre-destroy',
} as const;

/**
 * LifecycleService handles instance lifecycle management
 */
export class LifecycleService {
  private logger?: ILogger;
  private disposedInstances = new WeakSet<any>();

  constructor(logger?: ILogger) {
    this.logger = logger;
  }

  /**
   * Set logger instance (can be set after construction when DI is ready)
   */
  setLogger(logger: ILogger): void {
    this.logger = logger;
  }

  /**
   * Check if a method genuinely exists on the instance (own property or prototype chain).
   *
   * Unlike `typeof instance.method === 'function'`, this uses
   * Object.getOwnPropertyDescriptor which bypasses JS Proxy `get` traps.
   * This prevents false positives with Proxy-based useValue providers
   * (e.g., TopologyProxy) whose catch-all get trap makes every property
   * appear as a function, causing the container to call non-existent
   * lifecycle methods that would hang on IPC calls.
   *
   * Works correctly for:
   * - Class instances (methods on prototype chain) — e.g., ConfigService.onInit
   * - Factory-created plain objects (methods as own properties) — e.g., { dispose() {} }
   * - JS Proxy objects (no getOwnPropertyDescriptor trap) — correctly returns false
   */
  hasRealMethod(instance: any, methodName: string): boolean {
    if (!instance || typeof instance !== 'object') return false;
    // Check own property first (handles factory-created plain objects)
    const ownDesc = Object.getOwnPropertyDescriptor(instance, methodName);
    if (ownDesc && typeof ownDesc.value === 'function') return true;
    // Walk prototype chain (handles class instances)
    let proto = Object.getPrototypeOf(instance);
    while (proto && proto !== Object.prototype) {
      const desc = Object.getOwnPropertyDescriptor(proto, methodName);
      if (desc && typeof desc.value === 'function') return true;
      proto = Object.getPrototypeOf(proto);
    }
    return false;
  }

  /**
   * Check if disposable
   */
  isDisposable(instance: any): instance is Disposable {
    return this.hasRealMethod(instance, 'dispose');
  }

  /**
   * Check if initializable
   */
  isInitializable(instance: any): instance is Initializable {
    return this.hasRealMethod(instance, 'initialize');
  }

  /**
   * Check if async initializable (has onInit method)
   */
  isAsyncInitializable(instance: any): instance is { onInit(): Promise<void> } {
    return this.hasRealMethod(instance, 'onInit');
  }

  /**
   * Get @PostConstruct method name from instance's prototype
   * Returns the method name if decorated, undefined otherwise
   */
  getPostConstructMethod(instance: any): string | undefined {
    if (!instance || !instance.constructor) return undefined;

    const prototype = Object.getPrototypeOf(instance);
    if (!prototype) return undefined;

    // Check both metadata keys (the decorator sets both)
    const methodName =
      Reflect.getMetadata(LIFECYCLE_METADATA_KEYS.POST_CONSTRUCT, prototype) ||
      Reflect.getMetadata(LIFECYCLE_METADATA_KEYS.POST_CONSTRUCT_ALT, prototype);

    if (methodName && typeof instance[methodName] === 'function') {
      return methodName;
    }

    return undefined;
  }

  /**
   * Get @PreDestroy method name from instance's prototype
   * Returns the method name if decorated, undefined otherwise
   */
  getPreDestroyMethod(instance: any): string | undefined {
    if (!instance || !instance.constructor) return undefined;

    const prototype = Object.getPrototypeOf(instance);
    if (!prototype) return undefined;

    // Check both metadata keys (the decorator sets both)
    const methodName =
      Reflect.getMetadata(LIFECYCLE_METADATA_KEYS.PRE_DESTROY, prototype) ||
      Reflect.getMetadata(LIFECYCLE_METADATA_KEYS.PRE_DESTROY_ALT, prototype);

    if (methodName && typeof instance[methodName] === 'function') {
      return methodName;
    }

    return undefined;
  }

  /**
   * Check if instance has @PostConstruct decorator
   */
  hasPostConstruct(instance: any): boolean {
    return this.getPostConstructMethod(instance) !== undefined;
  }

  /**
   * Check if instance has @PreDestroy decorator
   */
  hasPreDestroy(instance: any): boolean {
    return this.getPreDestroyMethod(instance) !== undefined;
  }

  /**
   * Check if instance needs initialization (has onInit, initialize, or @PostConstruct)
   */
  needsInitialization(instance: any): boolean {
    return this.isAsyncInitializable(instance) || this.isInitializable(instance) || this.hasPostConstruct(instance);
  }

  /**
   * Dispose all instances
   *
   * Calls lifecycle methods in this order:
   * 1. @PreDestroy decorated method (if present)
   * 2. onDestroy() method (if present)
   * 3. dispose() method (if implements Disposable)
   */
  async disposeInstances(
    instances: Map<InjectionToken<any>, any>,
    scopedInstances: Map<string, Map<InjectionToken<any>, any>>
  ): Promise<void> {
    // Dispose instances in reverse order (dispose dependents before dependencies)
    const disposableEntries = Array.from(instances.entries()).reverse();

    for (const [token, instance] of disposableEntries) {
      await this.disposeInstance(token, instance);
    }

    // Dispose scoped instances
    for (const scopeCache of scopedInstances.values()) {
      const scopedEntries = Array.from(scopeCache.entries()).reverse();

      for (const [token, instance] of scopedEntries) {
        await this.disposeInstance(token, instance, true);
      }
    }
  }

  /**
   * Dispose a single instance — calls lifecycle methods in order:
   * 1. @PreDestroy decorated method (if present)
   * 2. onDestroy() method (if present and no dispose)
   * 3. dispose() method (if implements Disposable)
   *
   * Uses prototype-based method detection (hasRealMethod) to avoid
   * false positives from JS Proxy catch-all get traps.
   */
  private async disposeInstance(token: InjectionToken<any>, instance: any, scoped = false): Promise<void> {
    // Skip if not an object (WeakSet only accepts objects)
    if (!instance || typeof instance !== 'object') {
      return;
    }

    // Skip if already disposed (idempotent disposal)
    if (this.disposedInstances.has(instance)) {
      return;
    }

    // Mark as disposed before calling lifecycle methods
    this.disposedInstances.add(instance);

    // First, call @PreDestroy method if decorated
    const preDestroyMethod = this.getPreDestroyMethod(instance);
    if (preDestroyMethod) {
      try {
        const result = instance[preDestroyMethod]();
        if (result instanceof Promise) {
          await result;
        }
      } catch (error: any) {
        this.logger?.error(
          { err: error, token: getTokenName(token), method: preDestroyMethod, scoped },
          'Failed to call @PreDestroy'
        );
      }
    }

    // Then call onDestroy lifecycle hook (but only if no dispose method, since dispose often calls onDestroy)
    // Uses prototype-based check to avoid JS Proxy false positives.
    if (this.hasRealMethod(instance, 'onDestroy') && preDestroyMethod !== 'onDestroy' && !this.isDisposable(instance)) {
      try {
        const result = instance.onDestroy();
        if (result instanceof Promise) {
          await result;
        }
      } catch (error: any) {
        this.logger?.error({ err: error, token: getTokenName(token), scoped }, 'Failed to call onDestroy');
      }
    }

    // Finally call dispose if available (this may internally call onDestroy)
    if (this.isDisposable(instance)) {
      try {
        await instance.dispose();
      } catch (error: any) {
        this.logger?.error({ err: error, token: getTokenName(token), scoped }, 'Failed to dispose instance');
      }
    }
  }

  /**
   * Dispose modules in order
   */
  async disposeModules(modules: Map<string, IModule>, disposeOrder: string[]): Promise<void> {
    for (const moduleName of disposeOrder) {
      const module = modules.get(moduleName);
      if (module?.onModuleDestroy) {
        try {
          await module.onModuleDestroy();
        } catch (error: any) {
          this.logger?.error({ err: error, module: module.name }, 'Failed to destroy module');
        }
      }
    }
  }

  /**
   * Initialize all initializable instances
   *
   * Calls lifecycle methods in this order:
   * 1. @PostConstruct decorated method (if present)
   * 2. onInit() method (if present)
   *
   * This supports both decorator-based (@PostConstruct) and
   * interface-based (onInit) initialization patterns.
   *
   * Errors during initialization are logged but don't prevent other instances
   * from being initialized (graceful error handling).
   */
  async initializeInstances(initializableInstances: Set<any>): Promise<void> {
    const initPromises: Promise<void>[] = [];

    for (const instance of initializableInstances) {
      // First, call @PostConstruct method if decorated
      const postConstructMethod = this.getPostConstructMethod(instance);
      if (postConstructMethod) {
        try {
          const result = instance[postConstructMethod]();
          if (result instanceof Promise) {
            // Wrap in a promise that catches errors gracefully
            initPromises.push(
              result.catch((error: any) => {
                this.logger?.error({ err: error, method: postConstructMethod }, 'Failed to call @PostConstruct');
              })
            );
          }
        } catch (error: any) {
          this.logger?.error({ err: error, method: postConstructMethod }, 'Failed to call @PostConstruct');
        }
      }
      // Then call onInit() if present (and different from @PostConstruct method)
      else if (this.hasRealMethod(instance, 'onInit')) {
        try {
          const result = instance.onInit();
          if (result instanceof Promise) {
            // Wrap in a promise that catches errors gracefully
            initPromises.push(
              result.catch((error: any) => {
                this.logger?.error({ err: error }, 'Failed to initialize instance');
              })
            );
          }
        } catch (error: any) {
          this.logger?.error({ err: error }, 'Failed to initialize instance');
        }
      }
    }

    // Wait for all async initializations (errors are already handled)
    if (initPromises.length > 0) {
      await Promise.all(initPromises);
    }
  }

  /**
   * Call @PreDestroy method on an instance if decorated
   */
  async callPreDestroy(instance: any): Promise<void> {
    const preDestroyMethod = this.getPreDestroyMethod(instance);
    if (preDestroyMethod) {
      try {
        const result = instance[preDestroyMethod]();
        if (result instanceof Promise) {
          await result;
        }
      } catch (error: any) {
        this.logger?.error({ err: error, method: preDestroyMethod }, 'Failed to call @PreDestroy');
      }
    }
  }
}
