/**
 * Client-Side Island Hydration
 *
 * Hydrates islands on the client based on their strategies
 */

import type { IslandInstance, IslandComponent, HydrationStrategy, IslandManifest } from './types.js';
import { createHydrationStrategy, setupPreloadOnIntent, setupPreloadOnViewport } from './hydration.js';
import { deserializeData } from './server-components.js';

/**
 * Island registry on the client
 */
const islandComponents = new Map<string, IslandComponent>();

/**
 * Active island instances
 */
const activeIslands = new Map<string, IslandInstance>();

/**
 * Loaded manifest
 */
let manifest: IslandManifest | undefined;

/**
 * Register island component on the client
 *
 * Called by island modules when they load
 *
 * @param name - Island name
 * @param component - Island component
 */
export function registerClientIsland(name: string, component: IslandComponent): void {
  islandComponents.set(name, component);
}

/**
 * Load island manifest
 *
 * @param manifestData - Manifest data
 */
export function loadIslandManifest(manifestData: IslandManifest): void {
  manifest = manifestData;
}

/**
 * Hydrate all islands on the page
 *
 * Finds all island markers in the DOM and hydrates them
 *
 * @param islandsData - Islands data from SSR
 * @param manifestData - Optional manifest
 */
export async function hydrateIslands(
  islandsData: Array<{
    id: string;
    name: string;
    strategy: HydrationStrategy;
    props: string;
  }>,
  manifestData?: IslandManifest
): Promise<void> {
  if (manifestData) {
    loadIslandManifest(manifestData);
  }

  // Find all island elements
  const islandElements = document.querySelectorAll('[data-island-id]');

  for (const element of Array.from(islandElements)) {
    const islandId = element.getAttribute('data-island-id');
    const islandName = element.getAttribute('data-island-name');
    const strategy = element.getAttribute('data-island-strategy') as HydrationStrategy;
    const propsJson = element.getAttribute('data-island-props');

    if (!islandId || !islandName || !strategy || !propsJson) {
      console.warn('[Aether Islands] Invalid island element:', element);
      continue;
    }

    try {
      // Deserialize props
      const props = deserializeData(propsJson);

      // Get or load island component
      let component = islandComponents.get(islandName);

      if (!component) {
        // Dynamically import island component
        component = await loadIslandComponent(islandName);

        if (!component) {
          console.error(`[Aether Islands] Failed to load island component: ${islandName}`);
          continue;
        }
      }

      // Create island instance
      const island = createIslandInstance(islandId, component, element as HTMLElement, props, strategy);

      // Store active island
      activeIslands.set(islandId, island);

      // Setup preloading if configured
      const options = component.__islandOptions;
      if (options.preload === 'intent') {
        setupPreloadOnIntent(island, manifest);
      } else if (options.preload === 'viewport') {
        setupPreloadOnViewport(island, manifest);
      }

      // Prefetch data if configured
      if (options.prefetch) {
        try {
          await options.prefetch();
        } catch (err) {
          console.error(`[Aether Islands] Prefetch failed for ${islandName}:`, err);
        }
      }
    } catch (err) {
      console.error(`[Aether Islands] Failed to setup island ${islandId}:`, err);
    }
  }
}

/**
 * Create island instance
 */
function createIslandInstance(
  id: string,
  component: IslandComponent,
  element: HTMLElement,
  props: any,
  strategy: HydrationStrategy
): IslandInstance {
  const island: IslandInstance = {
    id,
    component,
    element,
    props,
    state: 'pending',
    hydrate: async () => {
      if (island.state === 'hydrated') {
        return;
      }

      island.state = 'hydrating';

      try {
        // Execute component with props
        const result = component(props);

        // If result is a function (render function), execute it
        const _rendered = typeof result === 'function' ? result() : result;

        // Replace element content with hydrated component
        // In a real implementation, this would use the proper reconciliation
        // For now, we'll just mark it as hydrated
        element.setAttribute('data-hydrated', 'true');

        island.state = 'hydrated';
      } catch (err) {
        island.state = 'error';
        island.error = err as Error;
        throw err;
      }
    },
  };

  // Initialize hydration strategy
  const strategyImpl = createHydrationStrategy(island, strategy);
  strategyImpl.init(island);

  // Store cleanup function
  island.cleanup = () => {
    strategyImpl.cleanup();
  };

  return island;
}

/**
 * Load island component dynamically
 *
 * @param name - Island name
 * @returns Island component
 */
async function loadIslandComponent(name: string): Promise<IslandComponent | undefined> {
  try {
    // Get chunk from manifest
    if (manifest) {
      const entry = Object.values(manifest.islands).find((e) => e.name === name);
      if (entry) {
        const module = await import(`/${entry.chunk}`);
        const component = module.default || module[name];
        if (component) {
          registerClientIsland(name, component);
          return component;
        }
      }
    }

    // Fallback: try to import from standard path
    const module = await import(`/islands/${name}.js`);
    const component = module.default || module[name];
    if (component) {
      registerClientIsland(name, component);
      return component;
    }
  } catch (err) {
    console.error(`[Aether Islands] Failed to load island ${name}:`, err);
  }

  return undefined;
}

/**
 * Get active island by ID
 *
 * @param islandId - Island ID
 * @returns Island instance
 */
export function getIsland(islandId: string): IslandInstance | undefined {
  return activeIslands.get(islandId);
}

/**
 * Get all active islands
 *
 * @returns Island instances
 */
export function getAllIslands(): IslandInstance[] {
  return Array.from(activeIslands.values());
}

/**
 * Manually hydrate an island
 *
 * @param islandId - Island ID
 */
export async function hydrateIsland(islandId: string): Promise<void> {
  const island = activeIslands.get(islandId);
  if (!island) {
    throw new Error(`[Aether Islands] Island not found: ${islandId}`);
  }

  await island.hydrate();
}

/**
 * Cleanup an island
 *
 * @param islandId - Island ID
 */
export function cleanupIsland(islandId: string): void {
  const island = activeIslands.get(islandId);
  if (island && island.cleanup) {
    island.cleanup();
  }
  activeIslands.delete(islandId);
}

/**
 * Cleanup all islands
 */
export function cleanupAllIslands(): void {
  for (const island of activeIslands.values()) {
    if (island.cleanup) {
      island.cleanup();
    }
  }
  activeIslands.clear();
}

/**
 * Check if island is hydrated
 *
 * @param islandId - Island ID
 * @returns True if hydrated
 */
export function isIslandHydrated(islandId: string): boolean {
  const island = activeIslands.get(islandId);
  return island?.state === 'hydrated';
}

/**
 * Wait for island to hydrate
 *
 * @param islandId - Island ID
 * @param timeout - Optional timeout in ms
 * @returns Promise that resolves when hydrated
 */
export async function waitForIslandHydration(islandId: string, timeout?: number): Promise<void> {
  const island = activeIslands.get(islandId);
  if (!island) {
    throw new Error(`[Aether Islands] Island not found: ${islandId}`);
  }

  if (island.state === 'hydrated') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if (island.state === 'hydrated') {
        clearInterval(checkInterval);
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
        resolve();
      } else if (island.state === 'error') {
        clearInterval(checkInterval);
        if (timeoutHandle !== undefined) {
          clearTimeout(timeoutHandle);
        }
        reject(island.error || new Error('Island hydration failed'));
      }
    }, 50);

    let timeoutHandle: number | undefined;
    if (timeout) {
      timeoutHandle = window.setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Island hydration timeout: ${islandId}`));
      }, timeout);
    }
  });
}

/**
 * Auto-initialize islands from global data
 *
 * Automatically hydrates islands from window.__AETHER_ISLANDS__
 */
export function autoInitIslands(): void {
  if (typeof window !== 'undefined' && (window as any).__AETHER_ISLANDS__) {
    const islandsData = (window as any).__AETHER_ISLANDS__;
    const manifestData = (window as any).__AETHER_MANIFEST__;

    hydrateIslands(islandsData, manifestData).catch((err) => {
      console.error('[Aether Islands] Auto-initialization failed:', err);
    });
  }
}

/**
 * Island statistics
 */
export interface IslandStats {
  total: number;
  pending: number;
  hydrating: number;
  hydrated: number;
  error: number;
  byStrategy: Record<HydrationStrategy, number>;
}

/**
 * Get island statistics
 *
 * @returns Island stats
 */
export function getIslandStats(): IslandStats {
  const islands = getAllIslands();

  const stats: IslandStats = {
    total: islands.length,
    pending: 0,
    hydrating: 0,
    hydrated: 0,
    error: 0,
    byStrategy: {
      immediate: 0,
      visible: 0,
      interaction: 0,
      idle: 0,
      media: 0,
      custom: 0,
    },
  };

  for (const island of islands) {
    stats[island.state]++;

    const strategy = island.component.__islandOptions.hydrate || 'immediate';
    stats.byStrategy[strategy]++;
  }

  return stats;
}

// Auto-initialize when DOM is ready
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitIslands);
  } else {
    // DOM already loaded
    autoInitIslands();
  }
}
