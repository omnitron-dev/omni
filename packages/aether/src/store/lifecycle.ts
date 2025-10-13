/**
 * Store Lifecycle Hooks
 * @module store/lifecycle
 *
 * Provides lifecycle hook management for stores.
 * Hooks are called at key points in the store lifecycle.
 */

import type { StoreLifecycleHandlers, StoreLifecycleHook } from './types.js';

/**
 * Current lifecycle context
 */
let currentLifecycle: LifecycleManager | null = null;

/**
 * Lifecycle manager for a store
 */
export class LifecycleManager {
  private handlers: Map<StoreLifecycleHook, Array<(...args: any[]) => void | Promise<void>>> = new Map([
    ['onStoreInit', []],
    ['onStoreDestroy', []],
    ['onStoreHydrate', []],
  ]);

  /**
   * Register a lifecycle hook
   */
  on(hook: StoreLifecycleHook, handler: (...args: any[]) => void | Promise<void>): () => void {
    const handlers = this.handlers.get(hook);
    if (!handlers) {
      throw new Error(`Unknown lifecycle hook: ${hook}`);
    }

    handlers.push(handler);

    // Return unregister function
    return () => {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    };
  }

  /**
   * Call all handlers for a lifecycle hook
   */
  async trigger(hook: StoreLifecycleHook, ...args: any[]): Promise<void> {
    const handlers = this.handlers.get(hook);
    if (!handlers || handlers.length === 0) {
      return;
    }

    // Run handlers sequentially
    for (const handler of handlers) {
      try {
        const result = handler(...args);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        console.error(`Error in ${hook} handler:`, error);
        // Continue executing other handlers even if one fails
      }
    }
  }

  /**
   * Check if there are handlers for a hook
   */
  has(hook: StoreLifecycleHook): boolean {
    const handlers = this.handlers.get(hook);
    return handlers ? handlers.length > 0 : false;
  }

  /**
   * Clear all handlers for a hook
   */
  clear(hook?: StoreLifecycleHook): void {
    if (hook) {
      const handlers = this.handlers.get(hook);
      if (handlers) {
        handlers.length = 0;
      }
    } else {
      // Clear all hooks
      for (const handlers of this.handlers.values()) {
        handlers.length = 0;
      }
    }
  }

  /**
   * Get all handlers for a hook
   */
  getHandlers(hook: StoreLifecycleHook): Array<(...args: any[]) => void | Promise<void>> {
    return this.handlers.get(hook) || [];
  }
}

/**
 * Get current lifecycle manager
 */
export function getCurrentLifecycle(): LifecycleManager | null {
  return currentLifecycle;
}

/**
 * Set current lifecycle manager
 */
export function setCurrentLifecycle(lifecycle: LifecycleManager | null): void {
  currentLifecycle = lifecycle;
}

/**
 * Run function with lifecycle context
 */
export function runWithLifecycle<T>(lifecycle: LifecycleManager, fn: () => T): T {
  const prev = currentLifecycle;
  currentLifecycle = lifecycle;
  try {
    return fn();
  } finally {
    currentLifecycle = prev;
  }
}

/**
 * Called when store is initialized
 * Must be called during store setup function
 */
export function onStoreInit(handler: () => void | Promise<void>): () => void {
  const lifecycle = getCurrentLifecycle();
  if (!lifecycle) {
    throw new Error('onStoreInit must be called during store setup');
  }
  return lifecycle.on('onStoreInit', handler);
}

/**
 * Called when store is destroyed
 * Must be called during store setup function
 */
export function onStoreDestroy(handler: () => void | Promise<void>): () => void {
  const lifecycle = getCurrentLifecycle();
  if (!lifecycle) {
    throw new Error('onStoreDestroy must be called during store setup');
  }
  return lifecycle.on('onStoreDestroy', handler);
}

/**
 * Called when store is hydrated from storage
 * Must be called during store setup function
 */
export function onStoreHydrate(handler: (data: any) => void | Promise<void>): () => void {
  const lifecycle = getCurrentLifecycle();
  if (!lifecycle) {
    throw new Error('onStoreHydrate must be called during store setup');
  }
  return lifecycle.on('onStoreHydrate', handler as any);
}

/**
 * Create lifecycle handlers object from manager
 */
export function createLifecycleHandlers(lifecycle: LifecycleManager): StoreLifecycleHandlers {
  return {
    onStoreInit: async () => {
      await lifecycle.trigger('onStoreInit');
    },
    onStoreDestroy: async () => {
      await lifecycle.trigger('onStoreDestroy');
    },
    onStoreHydrate: async (data: any) => {
      await lifecycle.trigger('onStoreHydrate', data);
    },
  };
}
