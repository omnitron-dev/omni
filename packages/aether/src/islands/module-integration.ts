/**
 * Islands-Module Integration
 *
 * ModuleIslandManager for island registration with DI context support
 * and island hydration with module containers
 */

import type { DIContainer } from '../di/container.js';
import type {
  IslandComponent,
  IslandOptions,
  HydrationStrategy,
  IslandInstance,
  HydrationState,
} from './types.js';
import type { StoreFactory } from '../store/types.js';
import { signal } from '../core/reactivity/signal.js';
import { setIslandContext, clearIslandContext } from '../store/module-integration.js';

/**
 * Module island definition
 */
export interface ModuleIslandDefinition {
  id: string;
  moduleId: string;
  component: () => Promise<IslandComponent>;
  container: DIContainer;
  options?: IslandOptions;
  stores?: StoreFactory[];
}

/**
 * Island hydration context
 */
export interface IslandHydrationContext {
  container: DIContainer;
  moduleId: string;
  islandId: string;
  props: any;
  element: HTMLElement;
}

/**
 * Module Island Manager
 *
 * Manages island registration, hydration, and lifecycle with module containers
 */
export class ModuleIslandManager {
  private islands = new Map<string, ModuleIslandDefinition>();
  private instances = new Map<string, IslandInstance>();
  private moduleIslands = new Map<string, Set<string>>(); // moduleId -> Set<islandId>
  private hydrationQueue: string[] = [];
  private isHydrating = false;

  /**
   * Register an island from a module
   */
  register(definition: ModuleIslandDefinition): void {
    this.islands.set(definition.id, definition);

    // Track module ownership
    if (!this.moduleIslands.has(definition.moduleId)) {
      this.moduleIslands.set(definition.moduleId, new Set());
    }
    this.moduleIslands.get(definition.moduleId)!.add(definition.id);
  }

  /**
   * Register multiple islands from a module
   */
  registerModuleIslands(
    moduleId: string,
    islands: Array<{
      id: string;
      component: () => Promise<IslandComponent>;
      options?: IslandOptions;
      stores?: StoreFactory[];
    }>,
    container: DIContainer
  ): void {
    for (const island of islands) {
      this.register({
        id: island.id,
        moduleId,
        component: island.component,
        container,
        options: island.options,
        stores: island.stores,
      });
    }
  }

  /**
   * Hydrate an island
   */
  async hydrate(islandId: string, element: HTMLElement, props: any = {}): Promise<void> {
    const definition = this.islands.get(islandId);
    if (!definition) {
      throw new Error(`Island '${islandId}' not registered`);
    }

    // Check if already hydrated
    if (this.instances.has(islandId)) {
      console.warn(`Island '${islandId}' already hydrated`);
      return;
    }

    // Set island context for store access
    setIslandContext(islandId);

    try {
      // Load component
      const component = await definition.component();

      // Create hydration context
      const context: IslandHydrationContext = {
        container: definition.container,
        moduleId: definition.moduleId,
        islandId,
        props,
        element,
      };

      // Create island instance
      const instance: IslandInstance = {
        id: islandId,
        component,
        element,
        props,
        state: 'hydrating',
        hydrate: async () => {
          instance.state = 'hydrating';

          try {
            // Initialize island-scoped stores
            if (definition.stores) {
              for (const factory of definition.stores) {
                factory(); // Instantiate store
              }
            }

            // Render component to element
            await this.renderIsland(component, element, props, context);

            instance.state = 'hydrated';
          } catch (error) {
            instance.state = 'error';
            instance.error = error instanceof Error ? error : new Error(String(error));
            throw error;
          }
        },
        cleanup: () => {
          this.cleanupIsland(islandId);
        },
      };

      // Store instance
      this.instances.set(islandId, instance);

      // Hydrate based on strategy
      await this.hydrateByStrategy(instance, definition.options?.hydrate ?? 'immediate');
    } finally {
      clearIslandContext();
    }
  }

  /**
   * Hydrate island based on strategy
   */
  private async hydrateByStrategy(
    instance: IslandInstance,
    strategy: HydrationStrategy
  ): Promise<void> {
    switch (strategy) {
      case 'immediate':
        await instance.hydrate();
        break;

      case 'visible':
        this.hydrateWhenVisible(instance);
        break;

      case 'interaction':
        this.hydrateOnInteraction(instance);
        break;

      case 'idle':
        this.hydrateWhenIdle(instance);
        break;

      case 'media':
        this.hydrateOnMedia(instance);
        break;

      case 'custom':
        this.hydrateCustom(instance);
        break;

      default:
        // Default to immediate hydration for unknown strategies
        await instance.hydrate();
        break;
    }
  }

  /**
   * Hydrate when island becomes visible
   */
  private hydrateWhenVisible(instance: IslandInstance): void {
    if (typeof IntersectionObserver === 'undefined') {
      // Fallback to immediate hydration
      instance.hydrate();
      return;
    }

    const definition = this.islands.get(instance.id);
    const options = definition?.options;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          instance.hydrate();
        }
      },
      {
        rootMargin: options?.rootMargin ?? '0px',
      }
    );

    observer.observe(instance.element);
  }

  /**
   * Hydrate on first interaction
   */
  private hydrateOnInteraction(instance: IslandInstance): void {
    const definition = this.islands.get(instance.id);
    const events = definition?.options?.events ?? ['click', 'focus', 'touchstart'];

    const handleInteraction = () => {
      instance.hydrate();
      // Remove listeners after first interaction
      events.forEach((event) => {
        instance.element.removeEventListener(event, handleInteraction);
      });
    };

    events.forEach((event) => {
      instance.element.addEventListener(event, handleInteraction, { once: true });
    });
  }

  /**
   * Hydrate when browser is idle
   */
  private hydrateWhenIdle(instance: IslandInstance): void {
    const definition = this.islands.get(instance.id);
    const timeout = definition?.options?.timeout ?? 2000;

    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(
        () => {
          instance.hydrate();
        },
        { timeout }
      );
    } else {
      // Fallback to setTimeout
      setTimeout(() => {
        instance.hydrate();
      }, timeout);
    }
  }

  /**
   * Hydrate when media query matches
   */
  private hydrateOnMedia(instance: IslandInstance): void {
    const definition = this.islands.get(instance.id);
    const query = definition?.options?.query;

    if (!query || typeof window.matchMedia === 'undefined') {
      instance.hydrate();
      return;
    }

    const mediaQuery = window.matchMedia(query);

    if (mediaQuery.matches) {
      instance.hydrate();
    } else {
      mediaQuery.addEventListener('change', (e) => {
        if (e.matches) {
          instance.hydrate();
        }
      });
    }
  }

  /**
   * Hydrate with custom condition
   */
  private hydrateCustom(instance: IslandInstance): void {
    const definition = this.islands.get(instance.id);
    const shouldHydrate = definition?.options?.shouldHydrate;

    if (!shouldHydrate) {
      instance.hydrate();
      return;
    }

    if (shouldHydrate()) {
      instance.hydrate();
    }
  }

  /**
   * Render island component to element
   */
  private async renderIsland(
    component: IslandComponent,
    element: HTMLElement,
    props: any,
    context: IslandHydrationContext
  ): Promise<void> {
    // This is a placeholder - actual rendering depends on the component system
    // In a real implementation, this would use the Aether renderer

    if (typeof component === 'function') {
      // Function component
      const result = component(props);

      // Simple rendering (replace with proper Aether renderer)
      if (typeof result === 'string') {
        element.innerHTML = result;
      } else if (result && typeof result === 'object') {
        // Handle reactive rendering
        // This would integrate with Aether's reactivity system
      }
    }
  }

  /**
   * Get island instance
   */
  getInstance(islandId: string): IslandInstance | undefined {
    return this.instances.get(islandId);
  }

  /**
   * Get all islands for a module
   */
  getModuleIslands(moduleId: string): string[] {
    return Array.from(this.moduleIslands.get(moduleId) ?? []);
  }

  /**
   * Cleanup an island
   */
  cleanupIsland(islandId: string): void {
    const instance = this.instances.get(islandId);
    if (!instance) return;

    // Cleanup element
    if (instance.element) {
      instance.element.innerHTML = '';
    }

    this.instances.delete(islandId);
    clearIslandContext();
  }

  /**
   * Cleanup all islands for a module
   */
  cleanupModule(moduleId: string): void {
    const islandIds = this.moduleIslands.get(moduleId);
    if (!islandIds) return;

    for (const islandId of islandIds) {
      this.cleanupIsland(islandId);
      this.islands.delete(islandId);
    }

    this.moduleIslands.delete(moduleId);
  }

  /**
   * Discover islands in the DOM
   */
  discoverIslands(): void {
    if (typeof document === 'undefined') return;

    // Find all island markers
    const markers = document.querySelectorAll('[data-island-id]');

    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker) continue;

      const islandId = marker.getAttribute('data-island-id');

      if (!islandId) continue;

      // Queue for hydration
      this.hydrationQueue.push(islandId);
    }

    // Process hydration queue
    this.processHydrationQueue();
  }

  /**
   * Process hydration queue
   */
  private async processHydrationQueue(): Promise<void> {
    if (this.isHydrating) return;

    this.isHydrating = true;

    try {
      while (this.hydrationQueue.length > 0) {
        const islandId = this.hydrationQueue.shift()!;
        const element = document.querySelector(`[data-island-id="${islandId}"]`) as HTMLElement;

        if (element) {
          const propsData = element.getAttribute('data-island-props');
          const props = propsData ? JSON.parse(propsData) : {};

          await this.hydrate(islandId, element, props);
        }
      }
    } finally {
      this.isHydrating = false;
    }
  }

  /**
   * Dispose all islands
   */
  dispose(): void {
    for (const islandId of this.instances.keys()) {
      this.cleanupIsland(islandId);
    }

    this.islands.clear();
    this.instances.clear();
    this.moduleIslands.clear();
    this.hydrationQueue = [];
  }

  /**
   * Get hydration state for an island
   */
  getHydrationState(islandId: string): HydrationState | undefined {
    return this.instances.get(islandId)?.state;
  }

  /**
   * Check if island is hydrated
   */
  isHydrated(islandId: string): boolean {
    return this.instances.get(islandId)?.state === 'hydrated';
  }
}

/**
 * Island lifecycle manager
 *
 * Coordinates island hydration with module lifecycle
 */
export class IslandLifecycleManager {
  private manager: ModuleIslandManager;
  private initializedModules = new Set<string>();

  constructor(manager: ModuleIslandManager) {
    this.manager = manager;
  }

  /**
   * Initialize islands for a module
   */
  async initializeModule(
    moduleId: string,
    islands: Array<{
      id: string;
      component: () => Promise<IslandComponent>;
      options?: IslandOptions;
      stores?: StoreFactory[];
    }>,
    container: DIContainer
  ): Promise<void> {
    if (this.initializedModules.has(moduleId)) {
      return;
    }

    this.manager.registerModuleIslands(moduleId, islands, container);
    this.initializedModules.add(moduleId);
  }

  /**
   * Cleanup module islands
   */
  async cleanupModule(moduleId: string): Promise<void> {
    this.manager.cleanupModule(moduleId);
    this.initializedModules.delete(moduleId);
  }

  /**
   * Check if module is initialized
   */
  isModuleInitialized(moduleId: string): boolean {
    return this.initializedModules.has(moduleId);
  }
}

/**
 * Create module island manager
 */
export function createModuleIslandManager(): ModuleIslandManager {
  return new ModuleIslandManager();
}

// Global island manager
let globalIslandManager: ModuleIslandManager | null = null;

/**
 * Get global island manager
 */
export function getModuleIslandManager(): ModuleIslandManager {
  if (!globalIslandManager) {
    globalIslandManager = new ModuleIslandManager();
  }
  return globalIslandManager;
}

/**
 * Set global island manager
 */
export function setModuleIslandManager(manager: ModuleIslandManager): void {
  if (globalIslandManager) {
    globalIslandManager.dispose();
  }
  globalIslandManager = manager;
}

/**
 * Reset global island manager (for testing)
 */
export function resetModuleIslandManager(): void {
  if (globalIslandManager) {
    globalIslandManager.dispose();
  }
  globalIslandManager = null;
}

/**
 * Hook to check if island is hydrated
 *
 * @param islandId - Island ID
 * @returns Signal with hydration state
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const isHydrated = useIslandHydration('my-island');
 *
 *   return <div>{isHydrated() ? 'Hydrated' : 'Loading...'}</div>;
 * }
 * ```
 */
export function useIslandHydration(islandId: string) {
  const manager = getModuleIslandManager();
  const state = signal<HydrationState>('pending');

  // Watch for hydration state changes
  const instance = manager.getInstance(islandId);
  if (instance) {
    state.set(instance.state);
  }

  return state;
}
