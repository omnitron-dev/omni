/**
 * Store-Module Integration
 *
 * Extends StoreManager to support module-scoped stores
 * and lifecycle management tied to modules
 */

import type { DIContainer } from '../di/container.js';
import type { StoreFactory, StoreOptions } from './types.js';
import { defineStore } from './defineStore.js';
import { signal } from '../core/reactivity/signal.js';

/**
 * Store scope types
 */
export type StoreScope = 'singleton' | 'module' | 'island';

/**
 * Module-scoped store options
 */
export interface ModuleScopedStoreOptions extends Partial<StoreOptions> {
  scope?: StoreScope;
  moduleId?: string;
  islandId?: string;
}

/**
 * Store instance metadata
 */
interface StoreInstanceMetadata {
  factory: StoreFactory;
  scope: StoreScope;
  instances: Map<string, any>; // keyed by moduleId or islandId
  singleton?: any;
}

/**
 * Store Manager for Module Integration
 *
 * Manages store lifecycle tied to module lifecycle
 */
export class ModuleScopedStoreManager {
  private stores = new Map<string, StoreInstanceMetadata>();
  private moduleStores = new Map<string, Set<string>>(); // moduleId -> Set<storeId>
  private islandStores = new Map<string, Set<string>>(); // islandId -> Set<storeId>

  /**
   * Register a store with module scope
   */
  register(
    storeId: string,
    factory: StoreFactory,
    options: ModuleScopedStoreOptions = {}
  ): void {
    const scope = options.scope ?? 'singleton';

    this.stores.set(storeId, {
      factory,
      scope,
      instances: new Map(),
      singleton: undefined,
    });

    // Track module ownership
    if (options.moduleId) {
      if (!this.moduleStores.has(options.moduleId)) {
        this.moduleStores.set(options.moduleId, new Set());
      }
      this.moduleStores.get(options.moduleId)!.add(storeId);
    }
  }

  /**
   * Get store instance with proper scoping
   */
  get<T = any>(storeId: string, context?: { moduleId?: string; islandId?: string }): T {
    const metadata = this.stores.get(storeId);
    if (!metadata) {
      throw new Error(`Store '${storeId}' not registered`);
    }

    const { factory, scope, instances, singleton } = metadata;

    // Singleton scope - global instance
    if (scope === 'singleton') {
      if (singleton) {
        return singleton;
      }
      const instance = factory();
      metadata.singleton = instance;
      return instance;
    }

    // Module scope - one instance per module
    if (scope === 'module') {
      const moduleId = context?.moduleId;
      if (!moduleId) {
        throw new Error(`Module scope store '${storeId}' requires moduleId in context`);
      }

      if (instances.has(moduleId)) {
        return instances.get(moduleId)!;
      }

      const instance = factory();
      instances.set(moduleId, instance);
      return instance;
    }

    // Island scope - one instance per island
    if (scope === 'island') {
      const islandId = context?.islandId;
      if (!islandId) {
        throw new Error(`Island scope store '${storeId}' requires islandId in context`);
      }

      if (instances.has(islandId)) {
        return instances.get(islandId)!;
      }

      const instance = factory();
      instances.set(islandId, instance);

      // Track island store
      if (!this.islandStores.has(islandId)) {
        this.islandStores.set(islandId, new Set());
      }
      this.islandStores.get(islandId)!.add(storeId);

      return instance;
    }

    throw new Error(`Unknown store scope: ${scope}`);
  }

  /**
   * Check if store exists
   */
  has(storeId: string): boolean {
    return this.stores.has(storeId);
  }

  /**
   * Get all stores for a module
   */
  getModuleStores(moduleId: string): Set<string> {
    return this.moduleStores.get(moduleId) ?? new Set();
  }

  /**
   * Cleanup module stores
   */
  cleanupModule(moduleId: string): void {
    const storeIds = this.moduleStores.get(moduleId);
    if (!storeIds) return;

    for (const storeId of storeIds) {
      const metadata = this.stores.get(storeId);
      if (!metadata) continue;

      // Dispose module-scoped instance
      if (metadata.scope === 'module') {
        const instance = metadata.instances.get(moduleId);
        if (instance && typeof instance.dispose === 'function') {
          instance.dispose();
        }
        metadata.instances.delete(moduleId);
      }
    }

    this.moduleStores.delete(moduleId);
  }

  /**
   * Cleanup island stores
   */
  cleanupIsland(islandId: string): void {
    const storeIds = this.islandStores.get(islandId);
    if (!storeIds) return;

    for (const storeId of storeIds) {
      const metadata = this.stores.get(storeId);
      if (!metadata) continue;

      // Dispose island-scoped instance
      if (metadata.scope === 'island') {
        const instance = metadata.instances.get(islandId);
        if (instance && typeof instance.dispose === 'function') {
          instance.dispose();
        }
        metadata.instances.delete(islandId);
      }
    }

    this.islandStores.delete(islandId);
  }

  /**
   * Dispose all stores
   */
  dispose(): void {
    for (const [storeId, metadata] of this.stores.entries()) {
      // Dispose singleton
      if (metadata.singleton && typeof metadata.singleton.dispose === 'function') {
        metadata.singleton.dispose();
      }

      // Dispose all instances
      for (const [_key, instance] of metadata.instances.entries()) {
        if (instance && typeof instance.dispose === 'function') {
          instance.dispose();
        }
      }

      metadata.instances.clear();
    }

    this.stores.clear();
    this.moduleStores.clear();
    this.islandStores.clear();
  }
}

/**
 * Create a module-scoped store
 *
 * @param id - Store ID
 * @param setup - Store setup function
 * @param options - Store options with scope
 * @returns Store factory
 *
 * @example
 * ```typescript
 * // Module-scoped store (new instance per module)
 * const useFeatureStore = defineModuleStore('feature', (netron) => {
 *   const data = signal([]);
 *   return { data };
 * }, { scope: 'module' });
 *
 * // Island-scoped store (new instance per island)
 * const useWidgetStore = defineModuleStore('widget', (netron) => {
 *   const active = signal(false);
 *   return { active };
 * }, { scope: 'island' });
 * ```
 */
export function defineModuleStore<T>(
  id: string,
  setup: (netron: any) => T,
  options?: ModuleScopedStoreOptions
): StoreFactory<T> {
  const scope = options?.scope ?? 'singleton';

  // Create base store with metadata
  const factory = defineStore<T>(id, setup, options);

  // Attach scope metadata
  Object.defineProperty(factory, '__scope', {
    value: scope,
    writable: false,
    enumerable: false,
  });

  return factory;
}

/**
 * Store export manager for modules
 *
 * Manages store exports between modules
 */
export class StoreExportManager {
  private exports = new Map<string, Map<string, StoreFactory>>(); // moduleId -> storeId -> factory

  /**
   * Export stores from a module
   */
  export(moduleId: string, storeIds: string[], stores: Map<string, StoreFactory>): void {
    if (!this.exports.has(moduleId)) {
      this.exports.set(moduleId, new Map());
    }

    const moduleExports = this.exports.get(moduleId)!;

    for (const storeId of storeIds) {
      const factory = stores.get(storeId);
      if (factory) {
        moduleExports.set(storeId, factory);
      }
    }
  }

  /**
   * Get exported store from a module
   */
  getExport(moduleId: string, storeId: string): StoreFactory | undefined {
    return this.exports.get(moduleId)?.get(storeId);
  }

  /**
   * Get all exports from a module
   */
  getModuleExports(moduleId: string): Map<string, StoreFactory> {
    return this.exports.get(moduleId) ?? new Map();
  }

  /**
   * Clear exports for a module
   */
  clearModule(moduleId: string): void {
    this.exports.delete(moduleId);
  }
}

/**
 * Store lifecycle manager for modules
 *
 * Coordinates store initialization and cleanup with module lifecycle
 */
export class StoreLifecycleManager {
  private initialized = new Set<string>();
  private initializing = new Map<string, Promise<void>>();

  /**
   * Initialize stores for a module
   */
  async initializeStores(
    moduleId: string,
    storeFactories: StoreFactory[],
    container: DIContainer
  ): Promise<void> {
    const key = `${moduleId}:init`;

    // Prevent duplicate initialization
    if (this.initialized.has(key)) {
      return;
    }

    // Wait for ongoing initialization
    if (this.initializing.has(key)) {
      return this.initializing.get(key);
    }

    // Start initialization
    const initPromise = (async () => {
      for (const factory of storeFactories) {
        // Instantiate store (triggers setup)
        factory();

        // Register in DI container if needed
        const storeId = (factory as any).id;
        if (storeId) {
          container.register(`STORE_${storeId}`, {
            provide: `STORE_${storeId}`,
            useValue: factory(),
          });
        }
      }

      this.initialized.add(key);
      this.initializing.delete(key);
    })();

    this.initializing.set(key, initPromise);
    await initPromise;
  }

  /**
   * Cleanup stores for a module
   */
  async cleanupStores(moduleId: string, storeFactories: StoreFactory[]): Promise<void> {
    for (const factory of storeFactories) {
      if (typeof factory.dispose === 'function') {
        factory.dispose();
      }
    }

    this.initialized.delete(`${moduleId}:init`);
  }

  /**
   * Check if stores are initialized for a module
   */
  isInitialized(moduleId: string): boolean {
    return this.initialized.has(`${moduleId}:init`);
  }
}

/**
 * Hook to access module-scoped store
 *
 * @param storeId - Store ID
 * @param moduleId - Module ID (optional, auto-detected)
 * @returns Store instance
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const store = useModuleStore('feature');
 *   const data = store.data();
 *   return <div>{data}</div>;
 * }
 * ```
 */
export function useModuleStore<T = any>(storeId: string, moduleId?: string): T {
  // Get store manager from global context
  const manager = getModuleScopedStoreManager();

  // Get current module context if not provided
  const context = {
    moduleId: moduleId ?? getCurrentModuleId(),
  };

  return manager.get<T>(storeId, context);
}

/**
 * Hook to access island-scoped store
 *
 * @param storeId - Store ID
 * @param islandId - Island ID (optional, auto-detected)
 * @returns Store instance
 *
 * @example
 * ```typescript
 * function WidgetIsland() {
 *   const store = useIslandStore('widget');
 *   const active = store.active();
 *   return <div>{active ? 'Active' : 'Inactive'}</div>;
 * }
 * ```
 */
export function useIslandStore<T = any>(storeId: string, islandId?: string): T {
  const manager = getModuleScopedStoreManager();

  const context = {
    islandId: islandId ?? getCurrentIslandId(),
  };

  return manager.get<T>(storeId, context);
}

// Global store manager instance
let globalStoreManager: ModuleScopedStoreManager | null = null;

/**
 * Get or create global store manager
 */
export function getModuleScopedStoreManager(): ModuleScopedStoreManager {
  if (!globalStoreManager) {
    globalStoreManager = new ModuleScopedStoreManager();
  }
  return globalStoreManager;
}

/**
 * Reset global store manager (for testing)
 */
export function resetModuleScopedStoreManager(): void {
  if (globalStoreManager) {
    globalStoreManager.dispose();
  }
  globalStoreManager = null;
}

// Context signals for current module/island
const currentModuleIdSignal = signal<string | undefined>(undefined);
const currentIslandIdSignal = signal<string | undefined>(undefined);

/**
 * Get current module ID from context
 */
function getCurrentModuleId(): string | undefined {
  return currentModuleIdSignal();
}

/**
 * Get current island ID from context
 */
function getCurrentIslandId(): string | undefined {
  return currentIslandIdSignal();
}

/**
 * Set current module context
 */
export function setModuleContext(moduleId: string): void {
  currentModuleIdSignal.set(moduleId);
}

/**
 * Set current island context
 */
export function setIslandContext(islandId: string): void {
  currentIslandIdSignal.set(islandId);
}

/**
 * Clear module context
 */
export function clearModuleContext(): void {
  currentModuleIdSignal.set(undefined);
}

/**
 * Clear island context
 */
export function clearIslandContext(): void {
  currentIslandIdSignal.set(undefined);
}
