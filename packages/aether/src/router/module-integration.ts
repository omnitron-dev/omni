/**
 * Router-Module Integration
 *
 * ModuleAwareRouter extending Router with module container injection
 * and module-level route guards
 */

import type { DIContainer } from '../di/container.js';
import type {
  Router,
  RouterConfig,
  RouteDefinition,
  RouteGuard,
  RouteMatch,
  LoaderContext,
  ActionContext,
  NavigationOptions,
  RedirectResult,
} from './types.js';
import { createRouter } from './router.js';

/**
 * Module route metadata
 */
export interface ModuleRouteMetadata {
  moduleId: string;
  container: DIContainer;
}

/**
 * Enhanced route definition with module context
 */
export interface ModuleRouteDefinition extends RouteDefinition {
  meta?: RouteDefinition['meta'] & {
    moduleId?: string;
  };
}

/**
 * Module-aware router configuration
 */
export interface ModuleAwareRouterConfig extends RouterConfig {
  rootContainer?: DIContainer;
}

/**
 * Module-Aware Router
 *
 * Extends base router with module container injection into loaders/actions
 * and support for module-level route guards
 */
export class ModuleAwareRouter {
  private baseRouter: Router;
  private rootContainer?: DIContainer;
  private moduleContainers = new Map<string, DIContainer>();
  private moduleGuards = new Map<string, RouteGuard[]>();
  private routeModules = new Map<string, string>(); // path -> moduleId

  constructor(config: ModuleAwareRouterConfig = {}) {
    this.rootContainer = config.rootContainer;

    // Enhance routes with module context
    const enhancedConfig = {
      ...config,
      routes: config.routes?.map((route) => this.enhanceRoute(route)) ?? [],
    };

    this.baseRouter = createRouter(enhancedConfig);
  }

  /**
   * Register routes from a module
   */
  registerModuleRoutes(
    moduleId: string,
    routes: RouteDefinition[],
    container: DIContainer
  ): void {
    this.moduleContainers.set(moduleId, container);

    // Enhance routes with module metadata
    const enhancedRoutes = routes.map((route) =>
      this.enhanceRouteWithModule(route, moduleId, container)
    );

    // Track route-module mapping
    for (const route of enhancedRoutes) {
      this.routeModules.set(route.path, moduleId);
    }

    // Add routes to base router
    if (this.baseRouter.config.routes) {
      this.baseRouter.config.routes.push(...enhancedRoutes);
    }
  }

  /**
   * Register module-level route guard
   */
  registerModuleGuard(moduleId: string, guard: RouteGuard): () => void {
    if (!this.moduleGuards.has(moduleId)) {
      this.moduleGuards.set(moduleId, []);
    }

    this.moduleGuards.get(moduleId)!.push(guard);

    // Return unregister function
    return () => {
      const guards = this.moduleGuards.get(moduleId);
      if (guards) {
        const index = guards.indexOf(guard);
        if (index > -1) {
          guards.splice(index, 1);
        }
      }
    };
  }

  /**
   * Get container for a route
   */
  getRouteContainer(path: string): DIContainer | undefined {
    const moduleId = this.routeModules.get(path);
    if (moduleId) {
      return this.moduleContainers.get(moduleId);
    }
    return this.rootContainer;
  }

  /**
   * Navigate with module-aware context
   */
  async navigate(to: string, options?: NavigationOptions): Promise<void> {
    return this.baseRouter.navigate(to, options);
  }

  /**
   * Register before navigation guard
   */
  beforeEach(guard: RouteGuard): () => void {
    return this.baseRouter.beforeEach((context) => {
      // Execute module-specific guards first
      const pathParam = context.params.path;
      const pathString = Array.isArray(pathParam) ? (pathParam[0] || '') : (pathParam || '');
      const moduleId = this.routeModules.get(pathString);

      if (moduleId) {
        const moduleGuards = this.moduleGuards.get(moduleId);
        if (moduleGuards) {
          // Process module guards sequentially
          // Returns Promise<boolean | RedirectResult> which is compatible with RouteGuard
          return (async (): Promise<boolean | RedirectResult> => {
            for (const moduleGuard of moduleGuards) {
              const result = await moduleGuard(context);
              // Type guard: check if result is RedirectResult
              if (result === false || (typeof result === 'object' && result !== null && 'redirect' in result)) {
                return result;
              }
            }
            // Then execute global guard
            const guardResult = await guard(context);
            return guardResult;
          })() as ReturnType<RouteGuard>;
        }
      }

      // No module guards, just execute global guard
      return guard(context);
    });
  }

  /**
   * Register after navigation hook
   */
  afterEach(hook: (to: RouteMatch, from: RouteMatch | null) => void): () => void {
    return this.baseRouter.afterEach(hook);
  }

  /**
   * Get current location
   */
  get current() {
    return this.baseRouter.current;
  }

  /**
   * Get router config
   */
  get config() {
    return this.baseRouter.config;
  }

  /**
   * Match a pathname
   */
  match(pathname: string): RouteMatch | null {
    return this.baseRouter.match(pathname);
  }

  /**
   * Navigate back
   */
  back(): void {
    this.baseRouter.back();
  }

  /**
   * Navigate forward
   */
  forward(): void {
    this.baseRouter.forward();
  }

  /**
   * Go to specific history entry
   */
  go(delta: number): void {
    this.baseRouter.go(delta);
  }

  /**
   * Wait for router to be ready
   */
  async ready(): Promise<void> {
    return this.baseRouter.ready();
  }

  /**
   * Dispose router
   */
  dispose(): void {
    this.baseRouter.dispose();
    this.moduleContainers.clear();
    this.moduleGuards.clear();
    this.routeModules.clear();
  }

  /**
   * Cleanup module routes and guards
   */
  cleanupModule(moduleId: string): void {
    this.moduleContainers.delete(moduleId);
    this.moduleGuards.delete(moduleId);

    // Remove route mappings
    for (const [path, modId] of this.routeModules.entries()) {
      if (modId === moduleId) {
        this.routeModules.delete(path);
      }
    }
  }

  /**
   * Enhance route with module context
   */
  private enhanceRoute(route: RouteDefinition): RouteDefinition {
    return {
      ...route,
      loader: route.loader ? this.wrapLoader(route.loader) : undefined,
      action: route.action ? this.wrapAction(route.action) : undefined,
      children: route.children?.map((child) => this.enhanceRoute(child)),
    };
  }

  /**
   * Enhance route with module metadata and container
   */
  private enhanceRouteWithModule(
    route: RouteDefinition,
    moduleId: string,
    container: DIContainer
  ): RouteDefinition {
    return {
      ...route,
      meta: {
        ...route.meta,
        moduleId,
      },
      loader: route.loader ? this.wrapLoaderWithContainer(route.loader, container) : undefined,
      action: route.action ? this.wrapActionWithContainer(route.action, container) : undefined,
      children: route.children?.map((child) =>
        this.enhanceRouteWithModule(child, moduleId, container)
      ),
    };
  }

  /**
   * Wrap loader to inject root container
   */
  private wrapLoader(loader: any): any {
    return (context: LoaderContext) =>
      // Add root container to context
       loader({
        ...context,
        container: this.rootContainer,
      })
    ;
  }

  /**
   * Wrap action to inject root container
   */
  private wrapAction(action: any): any {
    return (context: ActionContext) =>
      // Add root container to context
       action({
        ...context,
        container: this.rootContainer,
      })
    ;
  }

  /**
   * Wrap loader to inject module container
   */
  private wrapLoaderWithContainer(loader: any, container: DIContainer): any {
    return (context: LoaderContext) => 
      // Add module container to context
       loader({
        ...context,
        container,
      })
    ;
  }

  /**
   * Wrap action to inject module container
   */
  private wrapActionWithContainer(action: any, container: DIContainer): any {
    return (context: ActionContext) => 
      // Add module container to context
       action({
        ...context,
        container,
      })
    ;
  }
}

/**
 * Create a module-aware router
 *
 * @param config - Router configuration
 * @returns Module-aware router instance
 *
 * @example
 * ```typescript
 * const router = createModuleAwareRouter({
 *   mode: 'history',
 *   rootContainer: container,
 *   routes: []
 * });
 *
 * // Register module routes
 * router.registerModuleRoutes('todos', todoRoutes, todoContainer);
 *
 * // Register module guard
 * router.registerModuleGuard('todos', async (context) => {
 *   if (!hasAccess()) return { redirect: '/login' };
 *   return true;
 * });
 * ```
 */
export function createModuleAwareRouter(
  config: ModuleAwareRouterConfig = {}
): ModuleAwareRouter {
  return new ModuleAwareRouter(config);
}

/**
 * Router lifecycle manager for modules
 *
 * Coordinates router setup with module lifecycle
 */
export class RouterLifecycleManager {
  private router: ModuleAwareRouter;
  private registeredModules = new Set<string>();

  constructor(router: ModuleAwareRouter) {
    this.router = router;
  }

  /**
   * Initialize routes for a module
   */
  async initializeModule(
    moduleId: string,
    routes: RouteDefinition[],
    container: DIContainer
  ): Promise<void> {
    if (this.registeredModules.has(moduleId)) {
      return;
    }

    this.router.registerModuleRoutes(moduleId, routes, container);
    this.registeredModules.add(moduleId);
  }

  /**
   * Cleanup module routes
   */
  async cleanupModule(moduleId: string): Promise<void> {
    this.router.cleanupModule(moduleId);
    this.registeredModules.delete(moduleId);
  }

  /**
   * Check if module is initialized
   */
  isModuleInitialized(moduleId: string): boolean {
    return this.registeredModules.has(moduleId);
  }

  /**
   * Get all registered modules
   */
  getRegisteredModules(): string[] {
    return Array.from(this.registeredModules);
  }
}

/**
 * Route group for organizing module routes
 */
export interface RouteGroup {
  prefix: string;
  routes: RouteDefinition[];
  guards?: RouteGuard[];
  meta?: Record<string, any>;
}

/**
 * Create a route group with common prefix and guards
 *
 * @param group - Route group definition
 * @returns Normalized routes
 *
 * @example
 * ```typescript
 * const adminRoutes = createRouteGroup({
 *   prefix: '/admin',
 *   guards: [requireAdmin],
 *   routes: [
 *     { path: '/users', component: UsersList },
 *     { path: '/settings', component: Settings }
 *   ]
 * });
 * ```
 */
export function createRouteGroup(group: RouteGroup): RouteDefinition[] {
  const { prefix, routes, guards = [], meta = {} } = group;

  return routes.map((route) => ({
    ...route,
    path: `${prefix}${route.path}`,
    guards: [...guards, ...(route.guards ?? [])],
    meta: {
      ...meta,
      ...route.meta,
    },
    children: route.children?.map((child) => ({
      ...child,
      guards: [...guards, ...(child.guards ?? [])],
      meta: {
        ...meta,
        ...child.meta,
      },
    })),
  }));
}

/**
 * Extract routes from modules
 *
 * @param modules - Array of modules
 * @returns Flat array of routes
 */
export function extractRoutesFromModules(modules: any[]): RouteDefinition[] {
  const routes: RouteDefinition[] = [];

  for (const module of modules) {
    if (module.definition?.routes) {
      routes.push(...module.definition.routes);
    }
  }

  return routes;
}

// Global router instance
let globalModuleRouter: ModuleAwareRouter | null = null;

/**
 * Get global module-aware router
 */
export function getModuleRouter(): ModuleAwareRouter {
  if (!globalModuleRouter) {
    throw new Error('Module router not initialized. Call setModuleRouter() first.');
  }
  return globalModuleRouter;
}

/**
 * Set global module-aware router
 */
export function setModuleRouter(router: ModuleAwareRouter): void {
  if (globalModuleRouter) {
    globalModuleRouter.dispose();
  }
  globalModuleRouter = router;
}

/**
 * Reset global module router (for testing)
 */
export function resetModuleRouter(): void {
  if (globalModuleRouter) {
    globalModuleRouter.dispose();
  }
  globalModuleRouter = null;
}
