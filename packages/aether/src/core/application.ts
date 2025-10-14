/**
 * Aether Application
 *
 * Main application bootstrap and lifecycle management
 */

import type { Module, ModuleContext } from '../di/types.js';
import { DIContainer, getRootInjector } from '../di/container.js';
import { ModuleManager } from '../modules/manager.js';
import { createModuleAwareRouter, RouterLifecycleManager } from '../router/module-integration.js';
import type { ModuleAwareRouter } from '../router/module-integration.js';
import {
  ModuleScopedStoreManager,
  StoreLifecycleManager,
} from '../store/module-integration.js';
import {
  ModuleIslandManager,
  IslandLifecycleManager,
} from '../islands/module-integration.js';
import type { RouterConfig } from '../router/types.js';

/**
 * Application configuration
 */
export interface ApplicationConfig {
  /**
   * Root module
   */
  rootModule: Module;

  /**
   * Router configuration
   */
  router?: RouterConfig;

  /**
   * Enable SSR mode
   */
  ssr?: boolean;

  /**
   * Enable islands architecture
   */
  islands?: boolean;

  /**
   * Error handler
   */
  onError?: (error: Error) => void;

  /**
   * Performance monitoring
   */
  performance?: boolean;
}

/**
 * Application instance
 */
export interface Application {
  /**
   * Root container
   */
  readonly container: DIContainer;

  /**
   * Module manager
   */
  readonly modules: ModuleManager;

  /**
   * Router
   */
  readonly router: ModuleAwareRouter;

  /**
   * Store manager
   */
  readonly stores: ModuleScopedStoreManager;

  /**
   * Island manager
   */
  readonly islands: ModuleIslandManager;

  /**
   * Bootstrap the application
   */
  bootstrap(): Promise<void>;

  /**
   * Unmount the application
   */
  unmount(): Promise<void>;

  /**
   * Get module context
   */
  getModuleContext(moduleId: string): ModuleContext | undefined;
}

/**
 * Application state
 */
type ApplicationState = 'created' | 'bootstrapping' | 'running' | 'unmounted' | 'error';

/**
 * Aether Application Implementation
 */
class AetherApplication implements Application {
  private state: ApplicationState = 'created';
  private config: ApplicationConfig;
  private rootModule: Module;

  readonly container: DIContainer;
  readonly modules: ModuleManager;
  readonly router: ModuleAwareRouter;
  readonly stores: ModuleScopedStoreManager;
  readonly islands: ModuleIslandManager;

  private routerLifecycle: RouterLifecycleManager;
  private storeLifecycle: StoreLifecycleManager;
  private islandLifecycle: IslandLifecycleManager;

  constructor(config: ApplicationConfig) {
    this.config = config;
    this.rootModule = config.rootModule;

    // Create root container
    this.container = getRootInjector();

    // Create stores manager
    this.stores = new ModuleScopedStoreManager();

    // Create islands manager
    this.islands = new ModuleIslandManager();

    // Create router
    this.router = createModuleAwareRouter({
      ...config.router,
      rootContainer: this.container,
    });

    // Create module manager with integrations
    this.modules = new ModuleManager({
      container: this.container,
      router: this.router,
      storeManager: this.stores,
    });

    // Create lifecycle managers
    this.routerLifecycle = new RouterLifecycleManager(this.router);
    this.storeLifecycle = new StoreLifecycleManager();
    this.islandLifecycle = new IslandLifecycleManager(this.islands);

    // Setup global error handling
    this.setupErrorHandling();
  }

  /**
   * Bootstrap the application
   */
  async bootstrap(): Promise<void> {
    if (this.state !== 'created') {
      throw new Error(`Cannot bootstrap application in state: ${this.state}`);
    }

    this.state = 'bootstrapping';

    try {
      // Register root module
      await this.modules.register(this.rootModule);

      // Load module hierarchy
      await this.loadModuleHierarchy(this.rootModule);

      // Initialize router
      await this.router.ready();

      // Discover and hydrate islands (if enabled)
      if (this.config.islands && typeof document !== 'undefined') {
        this.islands.discoverIslands();
      }

      this.state = 'running';
    } catch (error) {
      this.state = 'error';
      this.handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Load module hierarchy recursively
   */
  private async loadModuleHierarchy(module: Module): Promise<void> {
    // Load the module
    const loaded = await this.modules.load(module.id);

    // Setup module lifecycle
    await this.setupModuleLifecycle(loaded.id, loaded.definition);

    // Run module setup
    await this.modules.setup(loaded.id);

    // Load child modules
    if (loaded.definition.imports) {
      for (const childModule of loaded.definition.imports) {
        // Resolve module definition
        const childDef =
          'definition' in childModule ? childModule : await (childModule as any)();

        await this.loadModuleHierarchy(childDef);
      }
    }
  }

  /**
   * Setup module lifecycle (stores, routes, islands)
   */
  private async setupModuleLifecycle(moduleId: string, definition: any): Promise<void> {
    const loaded = this.modules.get(moduleId);
    if (!loaded) return;

    const { container } = loaded;

    // Cast container to DIContainer (it's returned as Container interface but is actually DIContainer)
    const diContainer = container as unknown as DIContainer;

    // Initialize stores
    if (definition.stores) {
      await this.storeLifecycle.initializeStores(moduleId, definition.stores, diContainer);
    }

    // Initialize routes
    if (definition.routes) {
      await this.routerLifecycle.initializeModule(moduleId, definition.routes, diContainer);
    }

    // Initialize islands
    if (definition.islands) {
      await this.islandLifecycle.initializeModule(moduleId, definition.islands, diContainer);
    }
  }

  /**
   * Unmount the application
   */
  async unmount(): Promise<void> {
    if (this.state === 'unmounted') {
      return;
    }

    try {
      // Teardown all modules in reverse order
      const graph = this.modules.getGraph();
      const nodes = (graph as any).nodes; // Access private property
      const moduleIds = Array.from(nodes.keys()).reverse();

      for (const moduleId of moduleIds) {
        await this.teardownModule(moduleId);
      }

      // Dispose router
      this.router.dispose();

      // Dispose stores
      this.stores.dispose();

      // Dispose islands
      this.islands.dispose();

      // Clear container
      this.container.clear();

      this.state = 'unmounted';
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Teardown a module
   */
  private async teardownModule(moduleId: string): Promise<void> {
    const loaded = this.modules.get(moduleId);
    if (!loaded) return;

    // Cleanup stores
    if (loaded.definition.stores) {
      await this.storeLifecycle.cleanupStores(moduleId, loaded.definition.stores);
    }

    // Cleanup routes
    await this.routerLifecycle.cleanupModule(moduleId);

    // Cleanup islands
    await this.islandLifecycle.cleanupModule(moduleId);

    // Run module teardown
    await this.modules.teardown(moduleId);
  }

  /**
   * Get module context
   */
  getModuleContext(moduleId: string): ModuleContext | undefined {
    const loaded = this.modules.get(moduleId);
    return loaded?.context;
  }

  /**
   * Setup global error handling
   */
  private setupErrorHandling(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        this.handleError(event.error);
      });

      window.addEventListener('unhandledrejection', (event) => {
        this.handleError(
          event.reason instanceof Error ? event.reason : new Error(String(event.reason))
        );
      });
    }
  }

  /**
   * Handle error
   */
  private handleError(error: Error): void {
    console.error('[Aether Application Error]', error);

    if (this.config.onError) {
      this.config.onError(error);
    }
  }
}

/**
 * Create an Aether application
 *
 * @param config - Application configuration
 * @returns Application instance
 *
 * @example
 * ```typescript
 * // Define root module
 * const AppModule = defineModule({
 *   id: 'app',
 *   imports: [RouterModule, StoreModule, FeatureModule],
 *   providers: [AppService],
 *   routes: [
 *     { path: '/', component: HomePage },
 *     { path: '/about', component: AboutPage }
 *   ]
 * });
 *
 * // Create application
 * const app = createApp({
 *   rootModule: AppModule,
 *   router: {
 *     mode: 'history',
 *     base: '/'
 *   },
 *   islands: true
 * });
 *
 * // Bootstrap
 * await app.bootstrap();
 * ```
 */
export function createApp(config: ApplicationConfig): Application {
  return new AetherApplication(config);
}

/**
 * Mount application to DOM element
 *
 * @param app - Application instance
 * @param selector - DOM selector or element
 * @returns Unmount function
 *
 * @example
 * ```typescript
 * const app = createApp({ rootModule: AppModule });
 * const unmount = await mount(app, '#app');
 *
 * // Later...
 * await unmount();
 * ```
 */
export async function mount(
  app: Application,
  selector: string | HTMLElement
): Promise<() => Promise<void>> {
  // Bootstrap application
  await app.bootstrap();

  // Get root element
  const rootElement =
    typeof selector === 'string' ? document.querySelector(selector) : selector;

  if (!rootElement) {
    throw new Error(`Cannot find element: ${selector}`);
  }

  // Render root component (placeholder - actual implementation would use renderer)
  // This would integrate with the Aether rendering system

  // Return unmount function
  return async () => {
    await app.unmount();
    if (rootElement) {
      rootElement.innerHTML = '';
    }
  };
}

/**
 * Quick start helper for simple applications
 *
 * @param rootModule - Root module
 * @param options - Quick start options
 *
 * @example
 * ```typescript
 * await quickStart(AppModule, {
 *   mount: '#app',
 *   router: { mode: 'history' }
 * });
 * ```
 */
export async function quickStart(
  rootModule: Module,
  options: {
    mount?: string | HTMLElement;
    router?: RouterConfig;
    islands?: boolean;
    onError?: (error: Error) => void;
  } = {}
): Promise<Application> {
  const app = createApp({
    rootModule,
    router: options.router,
    islands: options.islands,
    onError: options.onError,
  });

  if (options.mount) {
    await mount(app, options.mount);
  } else {
    await app.bootstrap();
  }

  return app;
}

/**
 * Create a test application for testing
 *
 * @param config - Test configuration
 * @returns Test application instance
 *
 * @example
 * ```typescript
 * const app = createTestApp({
 *   rootModule: TestModule,
 *   mockProviders: [
 *     { provide: ApiService, useClass: MockApiService }
 *   ]
 * });
 * ```
 */
export function createTestApp(config: {
  rootModule: Module;
  mockProviders?: any[];
  router?: RouterConfig;
}): Application {
  const app = createApp({
    rootModule: config.rootModule,
    router: config.router,
    islands: false, // Disable islands in tests
  });

  // Register mock providers
  if (config.mockProviders) {
    for (const provider of config.mockProviders) {
      app.container.register(provider.provide, provider);
    }
  }

  return app;
}

/**
 * Global application instance (for dev tools)
 */
let globalApp: Application | null = null;

/**
 * Get global application instance
 */
export function getApp(): Application | null {
  return globalApp;
}

/**
 * Set global application instance
 */
export function setApp(app: Application): void {
  globalApp = app;

  // Expose to window for dev tools
  if (typeof window !== 'undefined') {
    (window as any).__AETHER_APP__ = app;
  }
}
