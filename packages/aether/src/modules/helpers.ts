/**
 * Module System Helpers
 *
 * Helper functions for working with modules, including lazy loading,
 * remote modules, and context hooks
 */

import type { Module, ModuleDefinition, ModuleContext } from '../di/types.js';
import type { LazyModule, DynamicModule } from './manager.js';
import { getApp } from '../core/application.js';
import { useModuleStore, useIslandStore } from '../store/module-integration.js';
import { signal } from '../core/reactivity/signal.js';

/**
 * Preload strategy for lazy modules
 */
export type PreloadStrategy = 'hover' | 'visible' | 'viewport' | 'immediate' | 'none';

/**
 * Remote module configuration
 */
export interface RemoteModuleConfig {
  url: string;
  scope?: string;
  module?: string;
  fallback?: Module;
  timeout?: number;
}

/**
 * Create a lazy-loaded module
 *
 * @param load - Function that returns a promise resolving to a module
 * @param preload - Preload strategy
 * @returns Lazy module
 *
 * @example
 * ```typescript
 * const AdminModule = lazy(
 *   () => import('./admin/AdminModule'),
 *   'viewport'
 * );
 *
 * const AppModule = defineModule({
 *   id: 'app',
 *   imports: [CoreModule, AdminModule]
 * });
 * ```
 */
export function lazy(load: () => Promise<{ default: Module } | Module>, preload?: PreloadStrategy): LazyModule {
  let loadPromise: Promise<Module> | null = null;

  const lazyModule: LazyModule = {
    type: 'lazy',
    load: async () => {
      if (!loadPromise) {
        loadPromise = load().then((loaded) =>
          // Handle default export
          'default' in loaded ? loaded.default : loaded
        );
      }
      return loadPromise;
    },
  };

  // Store preload strategy as metadata
  (lazyModule as any).__preload = preload;

  return lazyModule;
}

/**
 * Create a remote module (module federation)
 *
 * @param config - Remote module configuration
 * @returns Remote module
 *
 * @example
 * ```typescript
 * const RemoteAnalytics = remote({
 *   url: 'https://cdn.example.com/analytics.js',
 *   scope: 'analytics',
 *   module: './AnalyticsModule',
 *   fallback: LocalAnalyticsModule
 * });
 * ```
 */
export function remote(config: RemoteModuleConfig): LazyModule {
  const { url, scope = 'remote', module: moduleName = './Module', fallback, timeout = 10000 } = config;

  return lazy(async () => {
    try {
      // Load remote script
      await loadRemoteScript(url, timeout);

      // Get remote container
      const container = (window as any)[scope];
      if (!container) {
        throw new Error(`Remote container '${scope}' not found`);
      }

      // Initialize container
      await container.init(__webpack_share_scopes__.default);

      // Get module factory
      const factory = await container.get(moduleName);

      // Get module
      const remoteModule = factory();

      return remoteModule.default || remoteModule;
    } catch (error) {
      console.error(`Failed to load remote module from ${url}:`, error);

      // Use fallback if provided
      if (fallback) {
        return fallback;
      }

      throw error;
    }
  });
}

/**
 * Load remote script
 */
async function loadRemoteScript(url: string, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.type = 'text/javascript';

    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout loading remote script: ${url}`));
    }, timeout);

    script.onload = () => {
      clearTimeout(timeoutId);
      resolve();
    };

    script.onerror = () => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to load remote script: ${url}`));
    };

    document.head.appendChild(script);
  });
}

/**
 * Create a dynamic module
 *
 * @param factory - Function that returns module definition
 * @returns Dynamic module
 *
 * @example
 * ```typescript
 * const ConditionalModule = dynamic(async () => {
 *   const config = await fetchConfig();
 *   return {
 *     id: 'conditional',
 *     providers: config.enabled ? [FeatureService] : []
 *   };
 * });
 * ```
 */
export function dynamic(factory: () => ModuleDefinition | Promise<ModuleDefinition>): DynamicModule {
  return {
    type: 'dynamic',
    factory,
  };
}

/**
 * Hook to access current module context
 *
 * @param moduleId - Module ID (optional, auto-detected)
 * @returns Module context
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const context = useModule<FeatureContext>('feature');
 *   const data = context.featureService.getData();
 *
 *   return <div>{data}</div>;
 * }
 * ```
 */
export function useModule<T extends ModuleContext = ModuleContext>(moduleId?: string): T {
  const app = getApp();
  if (!app) {
    throw new Error('No application context. Ensure app is bootstrapped.');
  }

  // If moduleId provided, get specific module
  if (moduleId) {
    const context = app.getModuleContext(moduleId);
    if (!context) {
      throw new Error(`Module '${moduleId}' not found or not loaded`);
    }
    return context as T;
  }

  // Otherwise, try to get current module from context
  const currentModuleId = getCurrentModuleId();
  if (!currentModuleId) {
    throw new Error('Cannot determine current module. Provide moduleId explicitly.');
  }

  const context = app.getModuleContext(currentModuleId);
  if (!context) {
    throw new Error(`Module '${currentModuleId}' not found or not loaded`);
  }

  return context as T;
}

/**
 * Hook to access store (singleton, module, or island scoped)
 *
 * Automatically detects the appropriate scope based on context
 *
 * @param storeId - Store ID
 * @returns Store instance
 *
 * @example
 * ```typescript
 * // In a component
 * function MyComponent() {
 *   const userStore = useStore('user');
 *   const users = userStore.users();
 *
 *   return <div>{users.length} users</div>;
 * }
 *
 * // In an island
 * function WidgetIsland() {
 *   const widgetStore = useStore('widget'); // Island-scoped
 *   const active = widgetStore.active();
 *
 *   return <div>{active ? 'Active' : 'Inactive'}</div>;
 * }
 * ```
 */
export function useStore<T = any>(storeId: string): T {
  // Try island context first
  const islandId = getCurrentIslandId();
  if (islandId) {
    return useIslandStore<T>(storeId, islandId);
  }

  // Try module context
  const moduleId = getCurrentModuleId();
  if (moduleId) {
    return useModuleStore<T>(storeId, moduleId);
  }

  // Fallback to singleton
  return useModuleStore<T>(storeId);
}

/**
 * Hook to check if module is loaded
 *
 * @param moduleId - Module ID
 * @returns Signal indicating if module is loaded
 *
 * @example
 * ```typescript
 * function LazyContent() {
 *   const isLoaded = useModuleLoaded('feature');
 *
 *   return <div>{isLoaded() ? <FeatureComponent /> : <Loading />}</div>;
 * }
 * ```
 */
export function useModuleLoaded(moduleId: string) {
  const loaded = signal(false);

  const app = getApp();
  if (!app) {
    return loaded;
  }

  // Check if module is loaded
  loaded.set(app.modules.has(moduleId));

  return loaded;
}

/**
 * Preload a lazy module
 *
 * @param module - Lazy module to preload
 * @returns Promise that resolves when module is loaded
 *
 * @example
 * ```typescript
 * // Preload on hover
 * <button onMouseEnter={() => preloadModule(AdminModule)}>
 *   Admin
 * </button>
 * ```
 */
export async function preloadModule(module: LazyModule): Promise<Module> {
  if (module.type !== 'lazy') {
    throw new Error('Can only preload lazy modules');
  }

  return module.load();
}

/**
 * Conditionally load a module
 *
 * @param condition - Condition to check
 * @param module - Module to load if condition is true
 * @param fallback - Optional fallback module
 * @returns Module or null
 *
 * @example
 * ```typescript
 * const AdminModule = conditional(
 *   () => user.isAdmin,
 *   () => import('./admin/AdminModule'),
 *   () => import('./admin/RestrictedModule')
 * );
 * ```
 */
export function conditional(
  condition: boolean | (() => boolean),
  module: () => Promise<Module>,
  fallback?: () => Promise<Module>
): DynamicModule {
  return dynamic(async () => {
    const shouldLoad = typeof condition === 'function' ? condition() : condition;

    if (shouldLoad) {
      const loaded = await module();
      return loaded.definition;
    }

    if (fallback) {
      const loaded = await fallback();
      return loaded.definition;
    }

    // Return empty module
    return {
      id: 'conditional-empty',
      providers: [],
    };
  });
}

/**
 * Compose multiple modules into one
 *
 * @param id - Composed module ID
 * @param modules - Modules to compose
 * @returns Composed module
 *
 * @example
 * ```typescript
 * const CoreModule = compose('core', [
 *   LoggerModule,
 *   ConfigModule,
 *   HttpModule
 * ]);
 * ```
 */
export function compose(id: string, modules: Module[]): Module {
  return {
    id,
    definition: {
      id,
      imports: modules,
    },
  };
}

/**
 * Create a module with providers (forRoot/forChild pattern)
 *
 * @param module - Base module
 * @param providers - Additional providers
 * @returns Module with providers
 *
 * @example
 * ```typescript
 * const RouterModule = {
 *   forRoot: (config: RouterConfig) =>
 *     withProviders(RouterModule, [
 *       { provide: ROUTER_CONFIG, useValue: config }
 *     ])
 * };
 * ```
 */
export function withProviders(module: Module, providers: any[]): any {
  return {
    module,
    providers,
  };
}

/**
 * Extract all stores from a module tree
 *
 * @param module - Root module
 * @returns Array of store factories
 */
export function extractStores(module: Module): any[] {
  const stores: any[] = [];

  function extractFromModule(mod: Module): void {
    if (mod.definition.stores) {
      stores.push(...mod.definition.stores);
    }

    if (mod.definition.imports) {
      for (const imp of mod.definition.imports) {
        extractFromModule(imp);
      }
    }
  }

  extractFromModule(module);
  return stores;
}

/**
 * Extract all routes from a module tree
 *
 * @param module - Root module
 * @returns Array of route definitions
 */
export function extractRoutes(module: Module): any[] {
  const routes: any[] = [];

  function extractFromModule(mod: Module): void {
    if (mod.definition.routes) {
      routes.push(...mod.definition.routes);
    }

    if (mod.definition.imports) {
      for (const imp of mod.definition.imports) {
        extractFromModule(imp);
      }
    }
  }

  extractFromModule(module);
  return routes;
}

// Current module/island context tracking
const currentModuleContext = signal<string | undefined>(undefined);
const currentIslandContext = signal<string | undefined>(undefined);

/**
 * Get current module ID from context
 */
function getCurrentModuleId(): string | undefined {
  return currentModuleContext();
}

/**
 * Get current island ID from context
 */
function getCurrentIslandId(): string | undefined {
  return currentIslandContext();
}

/**
 * Set current module context (internal use)
 */
export function setCurrentModuleContext(moduleId: string): void {
  currentModuleContext.set(moduleId);
}

/**
 * Set current island context (internal use)
 */
export function setCurrentIslandContext(islandId: string): void {
  currentIslandContext.set(islandId);
}

/**
 * Clear current module context (internal use)
 */
export function clearCurrentModuleContext(): void {
  currentModuleContext.set(undefined);
}

/**
 * Clear current island context (internal use)
 */
export function clearCurrentIslandContext(): void {
  currentIslandContext.set(undefined);
}

/**
 * Run function with module context
 *
 * @param moduleId - Module ID
 * @param fn - Function to run
 * @returns Result of function
 *
 * @example
 * ```typescript
 * const result = withModuleContext('feature', () => {
 *   const store = useStore('feature');
 *   return store.getData();
 * });
 * ```
 */
export function withModuleContext<T>(moduleId: string, fn: () => T): T {
  const previous = currentModuleContext();
  setCurrentModuleContext(moduleId);

  try {
    return fn();
  } finally {
    if (previous) {
      currentModuleContext.set(previous);
    } else {
      clearCurrentModuleContext();
    }
  }
}

/**
 * Run function with island context
 *
 * @param islandId - Island ID
 * @param fn - Function to run
 * @returns Result of function
 */
export function withIslandContext<T>(islandId: string, fn: () => T): T {
  const previous = currentIslandContext();
  setCurrentIslandContext(islandId);

  try {
    return fn();
  } finally {
    if (previous) {
      currentIslandContext.set(previous);
    } else {
      clearCurrentIslandContext();
    }
  }
}

// Webpack share scopes support
declare global {
  var __webpack_share_scopes__: { default: any };
}
