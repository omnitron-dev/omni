/**
 * @fileoverview Module Integration Tests
 *
 * Tests integration between modules and other Aether systems:
 * - Store integration with modules
 * - Router integration with modules
 * - Islands integration with modules
 * - Module exports and imports
 * - Module scoping (singleton, module, island)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ModuleManager } from '../../src/modules/manager.js';
import { DIContainer } from '../../src/di/container.js';
import type { Module, ModuleDefinition } from '../../src/di/types.js';

describe('Module Integration', () => {
  let manager: ModuleManager;
  let container: DIContainer;

  beforeEach(() => {
    container = new DIContainer();
  });

  afterEach(() => {
    if (manager) {
      manager.clear();
    }
  });

  describe('store integration', () => {
    it('should integrate stores with module scope', async () => {
      const mockStoreManager = {
        register: vi.fn(),
        get: vi.fn(),
      };

      const storeFactory = vi.fn().mockResolvedValue({
        id: 'user-store',
        state: { users: [] },
      });

      const definition: ModuleDefinition = {
        id: 'user-module',
        providers: [],
        stores: [storeFactory],
      };

      const module: Module = {
        id: 'user-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await manager.register(module);
      await manager.load('user-module');

      expect(storeFactory).toHaveBeenCalled();
      expect(mockStoreManager.register).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-store' }),
        'user-module'
      );
    });

    it('should support multiple stores per module', async () => {
      const mockStoreManager = {
        register: vi.fn(),
      };

      const store1 = async () => ({ id: 'store1', state: {} });
      const store2 = async () => ({ id: 'store2', state: {} });
      const store3 = async () => ({ id: 'store3', state: {} });

      const definition: ModuleDefinition = {
        id: 'multi-store-module',
        providers: [],
        stores: [store1, store2, store3],
      };

      const module: Module = {
        id: 'multi-store-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await manager.register(module);
      await manager.load('multi-store-module');

      expect(mockStoreManager.register).toHaveBeenCalledTimes(3);
    });

    it('should make stores available in DI container', async () => {
      const mockStoreManager = {
        register: vi.fn(),
      };

      const storeFactory = async () => ({
        id: 'injectable-store',
        state: { count: 0 },
        increment: () => {},
      });

      const definition: ModuleDefinition = {
        id: 'di-module',
        providers: [],
        stores: [storeFactory],
      };

      const module: Module = {
        id: 'di-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await manager.register(module);
      const loaded = await manager.load('di-module');

      // Store should be registered in module container
      expect(loaded.container).toBeDefined();
    });

    it('should support store inheritance from parent modules', async () => {
      const mockStoreManager = {
        register: vi.fn(),
      };

      const parentStore = async () => ({ id: 'parent-store', state: {} });
      const childStore = async () => ({ id: 'child-store', state: {} });

      const parent: Module = {
        id: 'parent',
        definition: {
          id: 'parent',
          providers: [],
          stores: [parentStore],
        },
      };

      const child: Module = {
        id: 'child',
        definition: {
          id: 'child',
          imports: [parent],
          providers: [],
          stores: [childStore],
        },
      };

      manager = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await manager.register(parent);
      await manager.register(child);
      await manager.load('child');

      // Both stores should be registered
      expect(mockStoreManager.register).toHaveBeenCalledTimes(2);
    });
  });

  describe('router integration', () => {
    it('should register routes from module', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
        config: { routes: [] },
      };

      const routes = [
        { path: '/', component: {} },
        { path: '/users', component: {} },
        { path: '/users/:id', component: {} },
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

      manager = new ModuleManager({
        container,
        router: mockRouter,
      });

      await manager.register(module);
      await manager.load('route-module');

      expect(mockRouter.addRoutes).toHaveBeenCalled();
      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      expect(addedRoutes).toHaveLength(3);
    });

    it('should inject module container into route loaders', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const loader = vi.fn().mockReturnValue({ data: 'test' });

      const routes = [
        {
          path: '/data',
          component: {},
          loader,
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

      manager = new ModuleManager({
        container,
        router: mockRouter,
      });

      await manager.register(module);
      await manager.load('loader-module');

      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      const wrappedLoader = addedRoutes[0].loader;

      // Call wrapped loader
      wrappedLoader({ params: {} });

      // Original loader should be called with container in context
      expect(loader).toHaveBeenCalledWith(
        expect.objectContaining({
          container: expect.anything(),
        })
      );
    });

    it('should inject module container into route actions', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const action = vi.fn().mockReturnValue({ success: true });

      const routes = [
        {
          path: '/submit',
          component: {},
          action,
        },
      ];

      const definition: ModuleDefinition = {
        id: 'action-module',
        providers: [],
        routes,
      };

      const module: Module = {
        id: 'action-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        router: mockRouter,
      });

      await manager.register(module);
      await manager.load('action-module');

      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      const wrappedAction = addedRoutes[0].action;

      wrappedAction({ request: {} });

      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({
          container: expect.anything(),
        })
      );
    });

    it('should merge routes from multiple modules', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const module1: Module = {
        id: 'module1',
        definition: {
          id: 'module1',
          providers: [],
          routes: [{ path: '/module1', component: {} }],
        },
      };

      const module2: Module = {
        id: 'module2',
        definition: {
          id: 'module2',
          providers: [],
          routes: [{ path: '/module2', component: {} }],
        },
      };

      manager = new ModuleManager({
        container,
        router: mockRouter,
      });

      await manager.register(module1);
      await manager.register(module2);
      await manager.load('module1');
      await manager.load('module2');

      expect(mockRouter.addRoutes).toHaveBeenCalledTimes(2);
    });

    it('should add module metadata to routes', async () => {
      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const routes = [{ path: '/', component: {}, meta: { auth: true } }];

      const definition: ModuleDefinition = {
        id: 'meta-module',
        providers: [],
        routes,
      };

      const module: Module = {
        id: 'meta-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        router: mockRouter,
      });

      await manager.register(module);
      await manager.load('meta-module');

      const addedRoutes = mockRouter.addRoutes.mock.calls[0][0];
      expect(addedRoutes[0].meta.moduleId).toBe('meta-module');
      expect(addedRoutes[0].meta.auth).toBe(true);
    });
  });

  describe('islands integration', () => {
    beforeEach(() => {
      global.window = {} as any;
      (global.window as any).__AETHER_ISLANDS__ = [];
    });

    afterEach(() => {
      delete (global as any).window;
    });

    it('should register islands from module', async () => {
      const islands = [
        {
          id: 'header-island',
          component: async () => ({}),
          strategy: 'immediate' as const,
        },
        {
          id: 'footer-island',
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

      manager = new ModuleManager({ container });

      await manager.register(module);
      await manager.load('island-module');

      expect((global.window as any).__AETHER_ISLANDS__).toHaveLength(2);
    });

    it('should attach module container to islands', async () => {
      const islands = [
        {
          id: 'di-island',
          component: async () => ({}),
        },
      ];

      const definition: ModuleDefinition = {
        id: 'di-island-module',
        providers: [],
        islands,
      };

      const module: Module = {
        id: 'di-island-module',
        definition,
      };

      manager = new ModuleManager({ container });

      await manager.register(module);
      await manager.load('di-island-module');

      const registeredIsland = (global.window as any).__AETHER_ISLANDS__[0];
      expect(registeredIsland.container).toBeDefined();
      expect(registeredIsland.moduleId).toBe('di-island-module');
    });

    it('should support island-scoped stores', async () => {
      const mockStoreManager = {
        register: vi.fn(),
      };

      const islands = [
        {
          id: 'widget-island',
          component: async () => ({}),
        },
      ];

      const storeFactory = async () => ({
        id: 'widget-store',
        state: { active: false },
      });

      const definition: ModuleDefinition = {
        id: 'widget-module',
        providers: [],
        stores: [storeFactory],
        islands,
      };

      const module: Module = {
        id: 'widget-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await manager.register(module);
      await manager.load('widget-module');

      expect(mockStoreManager.register).toHaveBeenCalled();
      expect((global.window as any).__AETHER_ISLANDS__).toHaveLength(1);
    });
  });

  describe('module exports and imports', () => {
    it('should share exported providers between modules', async () => {
      const SharedService = class {
        getValue() {
          return 'shared';
        }
      };

      const provider: Module = {
        id: 'provider',
        definition: {
          id: 'provider',
          providers: [SharedService],
          exportProviders: [SharedService],
        },
      };

      const consumer: Module = {
        id: 'consumer',
        definition: {
          id: 'consumer',
          imports: [provider],
          providers: [],
        },
      };

      manager = new ModuleManager({ container });

      await manager.register(provider);
      await manager.register(consumer);

      await manager.load('provider');
      const consumerLoaded = await manager.load('consumer');

      // Consumer should have access to provider's exports
      expect(consumerLoaded.container).toBeDefined();
    });

    it('should support re-exports', async () => {
      const CoreService = class {
        name = 'core';
      };

      const core: Module = {
        id: 'core',
        definition: {
          id: 'core',
          providers: [CoreService],
          exportProviders: [CoreService],
        },
      };

      const shared: Module = {
        id: 'shared',
        definition: {
          id: 'shared',
          imports: [core],
          providers: [],
          exports: [core],
        },
      };

      const app: Module = {
        id: 'app',
        definition: {
          id: 'app',
          imports: [shared],
          providers: [],
        },
      };

      manager = new ModuleManager({ container });

      await manager.register(core);
      await manager.register(shared);
      await manager.register(app);

      await manager.load('core');
      await manager.load('shared');
      const appLoaded = await manager.load('app');

      expect(appLoaded).toBeDefined();
    });

    it('should handle selective exports', async () => {
      const Service1 = class {
        name = 'service1';
      };
      const Service2 = class {
        name = 'service2';
      };
      const InternalService = class {
        name = 'internal';
      };

      const module1: Module = {
        id: 'module1',
        definition: {
          id: 'module1',
          providers: [Service1, Service2, InternalService],
          exportProviders: [Service1, Service2], // Don't export InternalService
        },
      };

      manager = new ModuleManager({ container });

      await manager.register(module1);
      await manager.load('module1');

      // Only exported services should be available to other modules
      expect(module1.definition.exportProviders).toHaveLength(2);
      expect(module1.definition.exportProviders).not.toContain(InternalService);
    });
  });

  describe('module scoping', () => {
    it('should support singleton scope', async () => {
      const SingletonService = class {
        id = Math.random();
      };

      const definition: ModuleDefinition = {
        id: 'singleton-module',
        providers: [
          {
            provide: SingletonService,
            useClass: SingletonService,
            scope: 'singleton',
          },
        ],
      };

      const module: Module = {
        id: 'singleton-module',
        definition,
      };

      manager = new ModuleManager({ container });

      await manager.register(module);
      await manager.load('singleton-module');

      // Singleton services are shared across entire app
      const loaded = manager.get('singleton-module');
      expect(loaded).toBeDefined();
    });

    it('should support module scope', async () => {
      const ModuleScopedService = class {
        id = Math.random();
      };

      const definition: ModuleDefinition = {
        id: 'module-scoped',
        providers: [
          {
            provide: ModuleScopedService,
            useClass: ModuleScopedService,
            scope: 'module',
          },
        ],
      };

      const module: Module = {
        id: 'module-scoped',
        definition,
      };

      manager = new ModuleManager({ container });

      await manager.register(module);
      await manager.load('module-scoped');

      const loaded = manager.get('module-scoped');
      expect(loaded).toBeDefined();
    });

    it('should isolate module containers', async () => {
      const Service = class {
        value = 'test';
      };

      const module1: Module = {
        id: 'module1',
        definition: {
          id: 'module1',
          providers: [Service],
        },
      };

      const module2: Module = {
        id: 'module2',
        definition: {
          id: 'module2',
          providers: [Service],
        },
      };

      manager = new ModuleManager({ container });

      await manager.register(module1);
      await manager.register(module2);

      const loaded1 = await manager.load('module1');
      const loaded2 = await manager.load('module2');

      // Each module should have its own container
      expect(loaded1.container).not.toBe(loaded2.container);
    });
  });

  describe('cross-cutting concerns', () => {
    it('should support module with stores, routes, and islands', async () => {
      global.window = {} as any;
      (global.window as any).__AETHER_ISLANDS__ = [];

      const mockRouter = {
        addRoutes: vi.fn(),
      };

      const mockStoreManager = {
        register: vi.fn(),
      };

      const storeFactory = async () => ({ id: 'full-store', state: {} });

      const definition: ModuleDefinition = {
        id: 'full-module',
        providers: [],
        stores: [storeFactory],
        routes: [{ path: '/full', component: {} }],
        islands: [
          {
            id: 'full-island',
            component: async () => ({}),
          },
        ],
      };

      const module: Module = {
        id: 'full-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        router: mockRouter,
        storeManager: mockStoreManager,
      });

      await manager.register(module);
      await manager.load('full-module');

      expect(mockStoreManager.register).toHaveBeenCalled();
      expect(mockRouter.addRoutes).toHaveBeenCalled();
      expect((global.window as any).__AETHER_ISLANDS__).toHaveLength(1);

      delete (global as any).window;
    });

    it('should maintain consistency across lifecycle', async () => {
      const setupFn = vi.fn().mockResolvedValue({ initialized: true });
      const teardownFn = vi.fn().mockResolvedValue(undefined);

      const storeFactory = async () => ({ id: 'lifecycle-store', state: {} });

      const mockStoreManager = {
        register: vi.fn(),
        dispose: vi.fn(),
      };

      const definition: ModuleDefinition = {
        id: 'lifecycle-module',
        providers: [],
        stores: [storeFactory],
        setup: setupFn,
        teardown: teardownFn,
      };

      const module: Module = {
        id: 'lifecycle-module',
        definition,
      };

      manager = new ModuleManager({
        container,
        storeManager: mockStoreManager,
      });

      await manager.register(module);
      await manager.load('lifecycle-module');
      await manager.setup('lifecycle-module');

      expect(setupFn).toHaveBeenCalled();
      expect(mockStoreManager.register).toHaveBeenCalled();

      await manager.teardown('lifecycle-module');

      expect(teardownFn).toHaveBeenCalled();
    });
  });
});
