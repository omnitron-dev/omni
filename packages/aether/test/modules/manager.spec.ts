/**
 * @fileoverview Comprehensive tests for Module Manager
 *
 * Tests module manager functionality including:
 * - Module registration
 * - Module loading with dependencies
 * - Lifecycle hooks (setup, teardown)
 * - Store registration
 * - Route registration
 * - Island registration
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModuleManager } from '../../src/modules/manager.js';
import { DIContainer } from '../../src/di/container.js';
import type { Module, ModuleDefinition } from '../../src/di/types.js';

describe('ModuleManager', () => {
  let manager: ModuleManager;
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
    manager = new ModuleManager({ container });
  });

  afterEach(() => {
    manager.clear();
  });

  describe('module registration', () => {
    it('should register a simple module', async () => {
      const definition: ModuleDefinition = {
        id: 'test-module',
        providers: [],
      };

      const module: Module = {
        id: 'test-module',
        definition,
      };

      await manager.register(module);

      const graph = manager.getGraph();
      const node = graph.getNode('test-module');
      expect(node).toBeDefined();
      expect(node?.id).toBe('test-module');
    });

    it('should register module with dependencies', async () => {
      const depDefinition: ModuleDefinition = {
        id: 'dep-module',
        providers: [],
      };

      const depModule: Module = {
        id: 'dep-module',
        definition: depDefinition,
      };

      const definition: ModuleDefinition = {
        id: 'main-module',
        imports: [depModule],
        providers: [],
      };

      const module: Module = {
        id: 'main-module',
        definition,
      };

      await manager.register(module);

      const graph = manager.getGraph();
      expect(graph.getNode('main-module')).toBeDefined();
      expect(graph.getNode('dep-module')).toBeDefined();

      const deps = graph.getDependencies('main-module');
      expect(deps).toContain('dep-module');
    });

    it('should register nested module dependencies', async () => {
      const level3: ModuleDefinition = {
        id: 'level3',
        providers: [],
      };

      const level2: ModuleDefinition = {
        id: 'level2',
        imports: [{ id: 'level3', definition: level3 }],
        providers: [],
      };

      const level1: ModuleDefinition = {
        id: 'level1',
        imports: [{ id: 'level2', definition: level2 }],
        providers: [],
      };

      const module: Module = {
        id: 'level1',
        definition: level1,
      };

      await manager.register(module);

      const graph = manager.getGraph();
      expect(graph.getNode('level1')).toBeDefined();
      expect(graph.getNode('level2')).toBeDefined();
      expect(graph.getNode('level3')).toBeDefined();
    });

    it('should handle already registered dependencies', async () => {
      const shared: Module = {
        id: 'shared',
        definition: { id: 'shared', providers: [] },
      };

      await manager.register(shared);

      const module1: Module = {
        id: 'module1',
        definition: {
          id: 'module1',
          imports: [shared],
          providers: [],
        },
      };

      const module2: Module = {
        id: 'module2',
        definition: {
          id: 'module2',
          imports: [shared],
          providers: [],
        },
      };

      await manager.register(module1);
      await manager.register(module2);

      const graph = manager.getGraph();
      const sharedDeps = graph.getSharedDependencies();
      expect(sharedDeps.has('shared')).toBe(true);
    });
  });

  describe('module loading', () => {
    beforeEach(async () => {
      const dep: Module = {
        id: 'dependency',
        definition: { id: 'dependency', providers: [] },
      };

      const main: Module = {
        id: 'main',
        definition: {
          id: 'main',
          imports: [dep],
          providers: [],
        },
      };

      await manager.register(dep);
      await manager.register(main);
    });

    it('should load a module', async () => {
      const loaded = await manager.load('dependency');

      expect(loaded).toBeDefined();
      expect(loaded.id).toBe('dependency');
      expect(loaded.status).toBe('loaded');
    });

    it('should load module with dependencies in correct order', async () => {
      const loaded = await manager.load('main');

      expect(loaded).toBeDefined();
      expect(manager.has('dependency')).toBe(true);
      expect(manager.has('main')).toBe(true);
    });

    it('should return same instance on multiple loads', async () => {
      const loaded1 = await manager.load('dependency');
      const loaded2 = await manager.load('dependency');

      expect(loaded1).toBe(loaded2);
    });

    it('should detect circular dependencies', async () => {
      const module1: Module = {
        id: 'circular1',
        definition: {
          id: 'circular1',
          imports: [],
          providers: [],
        },
      };

      const module2: Module = {
        id: 'circular2',
        definition: {
          id: 'circular2',
          imports: [module1],
          providers: [],
        },
      };

      // Create circular reference
      module1.definition.imports = [module2];

      await manager.register(module1);
      await manager.register(module2);

      await expect(manager.load('circular1')).rejects.toThrow(/circular dependency/i);
    });

    it('should throw error for non-registered module', async () => {
      await expect(manager.load('non-existent')).rejects.toThrow(/not registered/i);
    });

    it('should load multiple modules', async () => {
      const loaded = await manager.loadAll(['dependency', 'main']);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].id).toBe('dependency');
      expect(loaded[1].id).toBe('main');
    });

    it('should handle loading state correctly', async () => {
      const loadPromise = manager.load('dependency');
      expect(manager.has('dependency')).toBe(false);

      await loadPromise;
      expect(manager.has('dependency')).toBe(true);
    });
  });

  describe('lifecycle hooks', () => {
    it('should execute setup hook', async () => {
      const setupFn = vi.fn().mockResolvedValue({ initialized: true });

      const definition: ModuleDefinition = {
        id: 'lifecycle-module',
        providers: [],
        setup: setupFn,
      };

      const module: Module = {
        id: 'lifecycle-module',
        definition,
      };

      await manager.register(module);
      await manager.load('lifecycle-module');
      await manager.setup('lifecycle-module');

      expect(setupFn).toHaveBeenCalled();
    });

    it('should pass correct context to setup', async () => {
      let receivedContext: any;

      const definition: ModuleDefinition = {
        id: 'context-module',
        providers: [],
        setup: (context) => {
          receivedContext = context;
          return {};
        },
      };

      const module: Module = {
        id: 'context-module',
        definition,
      };

      await manager.register(module);
      await manager.load('context-module');
      await manager.setup('context-module');

      expect(receivedContext).toBeDefined();
      expect(receivedContext.container).toBeDefined();
    });

    it('should execute teardown hook', async () => {
      const teardownFn = vi.fn().mockResolvedValue(undefined);

      const definition: ModuleDefinition = {
        id: 'teardown-module',
        providers: [],
        teardown: teardownFn,
      };

      const module: Module = {
        id: 'teardown-module',
        definition,
      };

      await manager.register(module);
      await manager.load('teardown-module');
      await manager.teardown('teardown-module');

      expect(teardownFn).toHaveBeenCalled();
    });

    it('should handle setup errors', async () => {
      const setupFn = vi.fn().mockRejectedValue(new Error('Setup failed'));

      const definition: ModuleDefinition = {
        id: 'error-module',
        providers: [],
        setup: setupFn,
      };

      const module: Module = {
        id: 'error-module',
        definition,
      };

      await manager.register(module);
      await manager.load('error-module');

      await expect(manager.setup('error-module')).rejects.toThrow('Setup failed');

      const loaded = manager.get('error-module');
      expect(loaded?.status).toBe('error');
      expect(loaded?.error).toBeDefined();
    });

    it('should remove module from registry on teardown', async () => {
      const definition: ModuleDefinition = {
        id: 'remove-module',
        providers: [],
      };

      const module: Module = {
        id: 'remove-module',
        definition,
      };

      await manager.register(module);
      await manager.load('remove-module');

      expect(manager.has('remove-module')).toBe(true);

      await manager.teardown('remove-module');

      expect(manager.has('remove-module')).toBe(false);
    });

    it('should not throw for teardown of non-existent module', async () => {
      await expect(manager.teardown('non-existent')).resolves.not.toThrow();
    });
  });

  describe('store registration', () => {
    it('should register stores from module', async () => {
      const mockStoreManager = {
        register: vi.fn(),
      };

      const storeFactory = vi.fn().mockResolvedValue({
        id: 'test-store',
        state: { count: 0 },
      });

      const definition: ModuleDefinition = {
        id: 'store-module',
        providers: [],
        stores: [storeFactory],
      };

      const module: Module = {
        id: 'store-module',
        definition,
      };

      const managerWithStores = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await managerWithStores.register(module);
      await managerWithStores.load('store-module');

      expect(storeFactory).toHaveBeenCalled();
      expect(mockStoreManager.register).toHaveBeenCalled();
    });

    it('should make stores available in DI container', async () => {
      const storeFactory = async () => ({
        id: 'test-store',
        state: { count: 0 },
      });

      const definition: ModuleDefinition = {
        id: 'di-store-module',
        providers: [],
        stores: [storeFactory],
      };

      const module: Module = {
        id: 'di-store-module',
        definition,
      };

      const mockStoreManager = { register: vi.fn() };
      const managerWithStores = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await managerWithStores.register(module);
      const loaded = await managerWithStores.load('di-store-module');

      // Check that container has store registered
      expect(loaded.container).toBeDefined();
    });
  });

  describe('route registration', () => {
    it('should register routes from module', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const routes = [
        { path: '/', component: {} },
        { path: '/about', component: {} },
      ];

      const definition: ModuleDefinition = {
        id: 'route-module',
        providers: [],
        routes,
      };

      const module: Module = {
        id: 'route-module',
        definition,
      };

      const managerWithRouter = new ModuleManager({
        container,
        router: mockRouter,
      });

      await managerWithRouter.register(module);
      await managerWithRouter.load('route-module');

      expect(mockRouter.addRoutes).toHaveBeenCalled();
      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      expect(addedRoutes).toHaveLength(2);
    });

    it('should enhance routes with module metadata', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const routes = [{ path: '/', component: {} }];

      const definition: ModuleDefinition = {
        id: 'meta-route-module',
        providers: [],
        routes,
      };

      const module: Module = {
        id: 'meta-route-module',
        definition,
      };

      const managerWithRouter = new ModuleManager({
        container,
        router: mockRouter,
      });

      await managerWithRouter.register(module);
      await managerWithRouter.load('meta-route-module');

      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      expect(addedRoutes[0].meta.moduleId).toBe('meta-route-module');
    });

    it('should wrap route loaders with container', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const loaderFn = vi.fn().mockReturnValue({ data: 'test' });

      const routes = [
        {
          path: '/',
          component: {},
          loader: loaderFn,
        },
      ];

      const definition: ModuleDefinition = {
        id: 'loader-module',
        providers: [],
        routes,
      };

      const module: Module = {
        id: 'loader-module',
        definition,
      };

      const managerWithRouter = new ModuleManager({
        container,
        router: mockRouter,
      });

      await managerWithRouter.register(module);
      await managerWithRouter.load('loader-module');

      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      expect(addedRoutes[0].loader).toBeDefined();
      expect(addedRoutes[0].loader).not.toBe(loaderFn);
    });
  });

  describe('island registration', () => {
    it('should register islands in browser environment', async () => {
      // Mock window object
      global.window = {} as any;
      (global.window as any).__AETHER_ISLANDS__ = [];

      const islands = [
        {
          id: 'test-island',
          component: async () => ({}),
          strategy: 'idle' as const,
        },
      ];

      const definition: ModuleDefinition = {
        id: 'island-module',
        providers: [],
        islands,
      };

      const module: Module = {
        id: 'island-module',
        definition,
      };

      await manager.register(module);
      await manager.load('island-module');

      expect((global.window as any).__AETHER_ISLANDS__).toHaveLength(1);
      expect((global.window as any).__AETHER_ISLANDS__[0].id).toBe('test-island');

      // Cleanup
      delete (global as any).window;
    });

    it('should attach module ID to islands', async () => {
      global.window = {} as any;
      (global.window as any).__AETHER_ISLANDS__ = [];

      const islands = [
        {
          id: 'meta-island',
          component: async () => ({}),
        },
      ];

      const definition: ModuleDefinition = {
        id: 'meta-island-module',
        providers: [],
        islands,
      };

      const module: Module = {
        id: 'meta-island-module',
        definition,
      };

      await manager.register(module);
      await manager.load('meta-island-module');

      expect((global.window as any).__AETHER_ISLANDS__[0].moduleId).toBe('meta-island-module');

      delete (global as any).window;
    });
  });

  describe('module dependencies', () => {
    beforeEach(async () => {
      const dep1: Module = {
        id: 'dep1',
        definition: { id: 'dep1', providers: [] },
      };

      const dep2: Module = {
        id: 'dep2',
        definition: { id: 'dep2', providers: [] },
      };

      const main: Module = {
        id: 'main',
        definition: {
          id: 'main',
          imports: [dep1, dep2],
          providers: [],
        },
      };

      await manager.register(dep1);
      await manager.register(dep2);
      await manager.register(main);
    });

    it('should get module dependencies', () => {
      const deps = manager.getDependencies('main');
      expect(deps).toHaveLength(2);
      expect(deps).toContain('dep1');
      expect(deps).toContain('dep2');
    });

    it('should get module dependents', () => {
      const dependents1 = manager.getDependents('dep1');
      const dependents2 = manager.getDependents('dep2');

      expect(dependents1).toContain('main');
      expect(dependents2).toContain('main');
    });
  });

  describe('error handling', () => {
    it('should handle invalid module definition', async () => {
      const invalidModule = {
        id: 'invalid',
        definition: null as any,
      };

      await expect(manager.register(invalidModule)).rejects.toThrow();
    });

    it('should handle load errors gracefully', async () => {
      const definition: ModuleDefinition = {
        id: 'error-module',
        providers: [
          {
            provide: 'ErrorService',
            useFactory: () => {
              throw new Error('Factory error');
            },
          },
        ],
      };

      const module: Module = {
        id: 'error-module',
        definition,
      };

      await manager.register(module);

      // Module loads successfully (providers are lazy)
      const loaded = await manager.load('error-module');
      expect(loaded).toBeDefined();
      expect(loaded.status).toBe('loaded');

      // Error happens when trying to resolve the provider
      expect(() => loaded.container.resolve('ErrorService')).toThrow('Factory error');
    });
  });

  describe('module statistics', () => {
    it('should return correct stats', async () => {
      const module1: Module = {
        id: 'module1',
        definition: { id: 'module1', providers: [] },
      };

      const module2: Module = {
        id: 'module2',
        definition: { id: 'module2', providers: [] },
      };

      await manager.register(module1);
      await manager.register(module2);

      await manager.load('module1');

      const stats = manager.getStats();
      expect(stats.loaded).toBe(1);
      expect(stats.loading).toBe(0);
      expect(stats.errors).toBe(0);
      expect(stats.graph.nodeCount).toBe(2);
    });

    it('should track error count in stats', async () => {
      const definition: ModuleDefinition = {
        id: 'error-module',
        providers: [],
        setup: () => {
          throw new Error('Setup error');
        },
      };

      const module: Module = {
        id: 'error-module',
        definition,
      };

      await manager.register(module);
      await manager.load('error-module');

      try {
        await manager.setup('error-module');
      } catch (e) {
        // Expected error
      }

      const stats = manager.getStats();
      expect(stats.errors).toBe(1);
    });
  });

  describe('graph access', () => {
    it('should provide access to module graph', () => {
      const graph = manager.getGraph();
      expect(graph).toBeDefined();
      expect(graph.getNodes).toBeDefined();
      expect(graph.addNode).toBeDefined();
    });
  });

  describe('clear functionality', () => {
    it('should clear all modules', async () => {
      const module1: Module = {
        id: 'module1',
        definition: { id: 'module1', providers: [] },
      };

      const module2: Module = {
        id: 'module2',
        definition: { id: 'module2', providers: [] },
      };

      await manager.register(module1);
      await manager.register(module2);
      await manager.load('module1');
      await manager.load('module2');

      expect(manager.has('module1')).toBe(true);
      expect(manager.has('module2')).toBe(true);

      manager.clear();

      expect(manager.has('module1')).toBe(false);
      expect(manager.has('module2')).toBe(false);
      expect(manager.getGraph().getNodes()).toHaveLength(0);
    });
  });
});
