/**
 * Module Manager
 *
 * Manages module loading, lifecycle, and dependency resolution
 */

import { DIContainer } from '../di/container.js';
import { InjectionToken } from '../di/tokens.js';
import { ModuleGraph } from './graph.js';
import type {
  Module,
  ModuleDefinition,
  LoadedModule,
  ModuleContext,
  SetupContext,
  RouteDefinition,
  IslandDefinition,
  StoreFactory,
  Container,
} from '../di/types.js';

/**
 * Dynamic module type
 */
export interface DynamicModule {
  type: 'dynamic';
  factory: () => ModuleDefinition | Promise<ModuleDefinition>;
}

/**
 * Lazy module type
 */
export interface LazyModule {
  type: 'lazy';
  load: () => Promise<Module>;
}

/**
 * Module manager options
 */
export interface ModuleManagerOptions {
  container?: DIContainer;
  router?: any;
  storeManager?: any;
}

/**
 * Module Manager
 *
 * Handles module registration, loading, and lifecycle management
 */
export class ModuleManager {
  private modules = new Map<string, LoadedModule>();
  private loading = new Map<string, Promise<LoadedModule>>();
  private graph: ModuleGraph;
  private container: DIContainer;
  private router?: any;
  private storeManager?: any;

  constructor(options: ModuleManagerOptions = {}) {
    this.container = options.container || new DIContainer();
    this.router = options.router;
    this.storeManager = options.storeManager;
    this.graph = new ModuleGraph();
  }

  /**
   * Register a module in the graph
   */
  async register(module: Module): Promise<void> {
    // Validate module
    if (!module || typeof module !== 'object') {
      throw new Error('Invalid module: module must be an object');
    }

    if (!module.id) {
      throw new Error('Invalid module: module must have an id');
    }

    const definition = await this.resolveDefinition(module);

    if (!definition) {
      throw new Error(`Invalid module '${module.id}': could not resolve definition`);
    }

    if (!definition.id) {
      throw new Error('Invalid module: definition must have an id');
    }

    this.graph.addNode(definition.id, definition);

    // Track dependencies
    if (definition.imports) {
      for (const dep of definition.imports) {
        const depDef = await this.resolveDefinition(dep);
        this.graph.addEdge(definition.id, depDef.id);

        // Register dependency if not already registered
        if (!this.graph.getNode(depDef.id)) {
          await this.register(dep);
        }
      }
    }
  }

  /**
   * Load a module by ID
   */
  async load(moduleId: string): Promise<LoadedModule> {
    // Check if already loaded
    if (this.modules.has(moduleId)) {
      return this.modules.get(moduleId)!;
    }

    // Check if currently loading
    if (this.loading.has(moduleId)) {
      return this.loading.get(moduleId)!;
    }

    // Check for circular dependencies
    const cycles = this.graph.findCircularDependencies();
    const cyclicModule = cycles.find((cycle) => cycle.includes(moduleId));
    if (cyclicModule) {
      throw new Error(
        `Circular dependency detected: ${cyclicModule.join(' -> ')} -> ${cyclicModule[0]}`
      );
    }

    // Start loading
    const loadPromise = this.loadModule(moduleId);
    this.loading.set(moduleId, loadPromise);

    try {
      const loaded = await loadPromise;
      this.modules.set(moduleId, loaded);
      this.loading.delete(moduleId);
      return loaded;
    } catch (error) {
      this.loading.delete(moduleId);
      throw error;
    }
  }

  /**
   * Load multiple modules
   */
  async loadAll(moduleIds: string[]): Promise<LoadedModule[]> {
    return Promise.all(moduleIds.map((id) => this.load(id)));
  }

  /**
   * Get a loaded module
   */
  get(moduleId: string): LoadedModule | undefined {
    return this.modules.get(moduleId);
  }

  /**
   * Check if a module is loaded
   */
  has(moduleId: string): boolean {
    return this.modules.has(moduleId);
  }

  /**
   * Setup a module (run setup lifecycle)
   */
  async setup(moduleId: string): Promise<ModuleContext> {
    const module = this.modules.get(moduleId);
    if (!module) {
      throw new Error(`Module ${moduleId} not loaded`);
    }

    if (!module.definition.setup) {
      return {};
    }

    const context: SetupContext = {
      container: module.container,
      router: this.router,
      stores: this.storeManager,
      config: module.definition.metadata,
      parent: this.getParentContext(module.definition),
    };

    try {
      const moduleContext = await module.definition.setup(context);
      module.context = moduleContext;
      return moduleContext;
    } catch (error) {
      module.status = 'error';
      module.error = error instanceof Error ? error : new Error(String(error));
      throw error;
    }
  }

  /**
   * Teardown a module (run teardown lifecycle)
   */
  async teardown(moduleId: string): Promise<void> {
    const module = this.modules.get(moduleId);
    if (!module) {
      return;
    }

    if (module.definition.teardown) {
      await module.definition.teardown({
        container: module.container,
        stores: this.storeManager,
      });
    }

    // Dispose container
    if (module.container && typeof module.container.dispose === 'function') {
      module.container.dispose();
    }

    this.modules.delete(moduleId);
  }

  /**
   * Get module dependencies
   */
  getDependencies(moduleId: string): string[] {
    return this.graph.getDependencies(moduleId);
  }

  /**
   * Get modules that depend on this module
   */
  getDependents(moduleId: string): string[] {
    return this.graph.getDependents(moduleId);
  }

  /**
   * Get the module graph
   */
  getGraph(): ModuleGraph {
    return this.graph;
  }

  /**
   * Internal: Load a module
   */
  private async loadModule(moduleId: string): Promise<LoadedModule> {
    const node = this.graph.getNode(moduleId);
    if (!node) {
      throw new Error(`Module ${moduleId} not registered`);
    }

    const definition = node.data;

    // Load dependencies first
    if (definition.imports) {
      await Promise.all(
        definition.imports.map(async (dep) => {
          const depDef = await this.resolveDefinition(dep);
          await this.load(depDef.id);
        })
      );
    }

    // Create module container
    const moduleContainer = this.container.createChild(definition.providers || []);

    // Register stores
    if (definition.stores) {
      await this.registerStores(definition.stores, moduleContainer, definition.id);
    }

    // Register routes
    if (definition.routes && this.router) {
      this.registerRoutes(definition.routes, moduleContainer, definition.id);
    }

    // Register islands
    if (definition.islands) {
      this.registerIslands(definition.islands, moduleContainer, definition.id);
    }

    // Create loaded module
    const loaded: LoadedModule = {
      id: definition.id,
      definition,
      container: moduleContainer,
      context: {},
      status: 'loaded',
    };

    return loaded;
  }

  /**
   * Register stores from module
   */
  private async registerStores(
    stores: StoreFactory[],
    container: Container,
    moduleId: string
  ): Promise<void> {
    if (!this.storeManager) return;

    for (const factory of stores) {
      const store = await factory();

      // Register store with store manager
      if (this.storeManager.register) {
        this.storeManager.register(store, moduleId);
      }

      // Make store available in DI
      const storeId = store.id || `store_${moduleId}_${Math.random().toString(36).slice(2)}`;
      const storeToken = new InjectionToken<any>(`STORE_${storeId}`);
      container.register(storeToken, {
        provide: storeToken,
        useValue: store,
      });
    }
  }

  /**
   * Register routes from module
   */
  private registerRoutes(
    routes: RouteDefinition[],
    container: Container,
    moduleId: string
  ): void {
    if (!this.router) return;

    // Enhance routes with module container
    const enhancedRoutes = routes.map((route) => ({
      ...route,
      meta: {
        ...route.meta,
        moduleId,
      },
      // Wrap loaders/actions with container
      loader: route.loader ? this.wrapLoader(route.loader, container) : undefined,
      action: route.action ? this.wrapAction(route.action, container) : undefined,
    }));

    // Add routes to router
    if (this.router.addRoutes) {
      this.router.addRoutes(enhancedRoutes);
    } else if (this.router.config?.routes) {
      // Fallback: add to config routes
      this.router.config.routes.push(...enhancedRoutes);
    }
  }

  /**
   * Wrap route loader with container
   */
  private wrapLoader(loader: any, container: Container): any {
    return (context: any) =>
      // Add container to loader context
       loader({ ...context, container })
    ;
  }

  /**
   * Wrap route action with container
   */
  private wrapAction(action: any, container: Container): any {
    return (context: any) =>
      // Add container to action context
       action({ ...context, container })
    ;
  }

  /**
   * Register islands from module
   */
  private registerIslands(
    islands: IslandDefinition[],
    container: Container,
    moduleId: string
  ): void {
    // Register islands for hydration
    if (typeof window !== 'undefined') {
      (window as any).__AETHER_ISLANDS__ = (window as any).__AETHER_ISLANDS__ || [];
      (window as any).__AETHER_ISLANDS__.push(
        ...islands.map((island) => ({
          ...island,
          moduleId,
          container, // Attach container for DI in islands
        }))
      );
    }
  }

  /**
   * Resolve module definition from various module types
   */
  private async resolveDefinition(module: any): Promise<ModuleDefinition> {
    // Static module
    if ('definition' in module) {
      if (!module.definition) {
        throw new Error('Invalid module: definition is null or undefined');
      }
      return module.definition;
    }

    // Dynamic module
    if (module.type === 'dynamic' && module.factory) {
      return await module.factory();
    }

    // Lazy module
    if (module.type === 'lazy' && module.load) {
      const loaded = await module.load();
      return this.resolveDefinition(loaded);
    }

    // Module with providers (forRoot/forChild pattern)
    if (module.module) {
      return module.module.definition;
    }

    // Plain module definition
    if (module.id) {
      return module;
    }

    throw new Error('Invalid module type');
  }

  /**
   * Get parent module context
   */
  private getParentContext(definition: ModuleDefinition): ModuleContext | undefined {
    // Find first imported module that has a context
    if (definition.imports) {
      for (const imp of definition.imports) {
        const impId = (imp as any).definition?.id || (imp as any).id;
        if (impId) {
          const parent = this.modules.get(impId);
          if (parent && parent.context) {
            return parent.context;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Clear all modules
   */
  clear(): void {
    this.modules.clear();
    this.loading.clear();
    this.graph.clear();
  }

  /**
   * Get module statistics
   */
  getStats(): {
    loaded: number;
    loading: number;
    errors: number;
    graph: ReturnType<ModuleGraph['getStats']>;
  } {
    const errors = Array.from(this.modules.values()).filter((m) => m.status === 'error').length;

    return {
      loaded: this.modules.size,
      loading: this.loading.size,
      errors,
      graph: this.graph.getStats(),
    };
  }
}
