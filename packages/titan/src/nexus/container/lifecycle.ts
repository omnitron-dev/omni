/**
 * Lifecycle management for Nexus DI Container
 *
 * Handles instance initialization, disposal, and module lifecycle hooks.
 *
 * @internal
 * @since 0.1.0
 */

import { getTokenName } from '../token.js';
import { InjectionToken, IModule, Disposable, Initializable } from '../types.js';
import type { ILogger } from '../../modules/logger/logger.types.js';

/**
 * LifecycleService handles instance lifecycle management
 */
export class LifecycleService {
  private logger?: ILogger;

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
   * Check if disposable
   */
  isDisposable(instance: any): instance is Disposable {
    return instance && typeof instance.dispose === 'function';
  }

  /**
   * Check if initializable
   */
  isInitializable(instance: any): instance is Initializable {
    return instance && typeof instance.initialize === 'function';
  }

  /**
   * Check if async initializable (has onInit method)
   */
  isAsyncInitializable(instance: any): instance is { onInit(): Promise<void> } {
    return instance && typeof instance.onInit === 'function';
  }

  /**
   * Dispose all instances
   */
  async disposeInstances(
    instances: Map<InjectionToken<any>, any>,
    scopedInstances: Map<string, Map<InjectionToken<any>, any>>
  ): Promise<void> {
    // Dispose instances in reverse order (dispose dependents before dependencies)
    const disposableEntries = Array.from(instances.entries()).reverse();

    for (const [token, instance] of disposableEntries) {
      // Call onDestroy lifecycle hook first
      if (instance && typeof instance.onDestroy === 'function') {
        try {
          const result = instance.onDestroy();
          if (result instanceof Promise) {
            await result;
          }
        } catch (error: any) {
          this.logger?.error({ err: error, token: getTokenName(token) }, 'Failed to call onDestroy');
        }
      }

      // Then call dispose if available
      if (this.isDisposable(instance)) {
        try {
          await instance.dispose();
        } catch (error: any) {
          this.logger?.error({ err: error, token: getTokenName(token) }, 'Failed to dispose instance');
        }
      }
    }

    // Dispose scoped instances
    for (const scopeCache of scopedInstances.values()) {
      const scopedEntries = Array.from(scopeCache.entries()).reverse();

      for (const [token, instance] of scopedEntries) {
        // Call onDestroy lifecycle hook first
        if (instance && typeof instance.onDestroy === 'function') {
          try {
            const result = instance.onDestroy();
            if (result instanceof Promise) {
              await result;
            }
          } catch (error: any) {
            this.logger?.error({ err: error, token: getTokenName(token), scoped: true }, 'Failed to call onDestroy');
          }
        }

        // Then call dispose if available
        if (this.isDisposable(instance)) {
          try {
            await instance.dispose();
          } catch (error: any) {
            this.logger?.error({ err: error, token: getTokenName(token), scoped: true }, 'Failed to dispose instance');
          }
        }
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
   */
  async initializeInstances(initializableInstances: Set<any>): Promise<void> {
    const initPromises: Promise<void>[] = [];

    for (const instance of initializableInstances) {
      if (instance && typeof instance.onInit === 'function') {
        try {
          const result = instance.onInit();
          if (result instanceof Promise) {
            initPromises.push(result);
          }
        } catch (error: any) {
          this.logger?.error({ err: error }, 'Failed to initialize instance');
          throw error;
        }
      }
    }

    // Wait for all async initializations
    if (initPromises.length > 0) {
      const results = await Promise.allSettled(initPromises);
      // Check for any rejected promises
      const rejected = results.find((r) => r.status === 'rejected');
      if (rejected && rejected.status === 'rejected') {
        throw rejected.reason;
      }
    }
  }
}
