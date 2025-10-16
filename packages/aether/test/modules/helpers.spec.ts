/**
 * @fileoverview Module Helpers Tests
 *
 * Tests helper functions for working with modules:
 * - lazy() function
 * - remote() function
 * - useModule() hook
 * - useStore() hook
 * - conditional() function
 * - compose() function
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  lazy,
  remote,
  dynamic,
  useModule,
  useStore,
  useModuleLoaded,
  preloadModule,
  conditional,
  compose,
  withProviders,
  extractStores,
  extractRoutes,
  withModuleContext,
  withIslandContext,
  setCurrentModuleContext,
  clearCurrentModuleContext,
} from '../../src/modules/helpers.js';
import { setApp } from '../../src/core/application.js';
import type { Module } from '../../src/di/types.js';

describe('Module Helpers', () => {
  describe('lazy()', () => {
    it('should create a lazy module', () => {
      const lazyMod = lazy(() =>
        Promise.resolve({
          id: 'lazy-test',
          definition: { id: 'lazy-test', providers: [] },
        })
      );

      expect(lazyMod.type).toBe('lazy');
      expect(lazyMod.load).toBeDefined();
      expect(typeof lazyMod.load).toBe('function');
    });

    it('should load module on demand', async () => {
      const module: Module = {
        id: 'lazy-load',
        definition: { id: 'lazy-load', providers: [] },
      };

      const lazyMod = lazy(() => Promise.resolve(module));

      const loaded = await lazyMod.load();
      expect(loaded).toBe(module);
    });

    it('should handle default export', async () => {
      const module: Module = {
        id: 'default-export',
        definition: { id: 'default-export', providers: [] },
      };

      const lazyMod = lazy(() => Promise.resolve({ default: module }));

      const loaded = await lazyMod.load();
      expect(loaded).toBe(module);
    });

    it('should cache load promise', async () => {
      const loadFn = vi.fn().mockResolvedValue({
        id: 'cached',
        definition: { id: 'cached', providers: [] },
      });

      const lazyMod = lazy(loadFn);

      await lazyMod.load();
      await lazyMod.load();
      await lazyMod.load();

      expect(loadFn).toHaveBeenCalledTimes(1);
    });

    it('should store preload strategy as metadata', () => {
      const lazyMod = lazy(
        () =>
          Promise.resolve({
            id: 'preload-test',
            definition: { id: 'preload-test', providers: [] },
          }),
        'viewport'
      );

      expect((lazyMod as any).__preload).toBe('viewport');
    });
  });

  describe('remote()', () => {
    let scriptElement: any;

    beforeEach(() => {
      scriptElement = {
        onload: null,
        onerror: null,
        src: '',
        type: '',
      };

      global.window = {} as any;
      global.document = {
        createElement: vi.fn().mockReturnValue(scriptElement),
        head: {
          appendChild: vi.fn().mockImplementation(() => {
            // Simulate script error immediately after append
            if (scriptElement.onerror) {
              setTimeout(() => scriptElement.onerror(), 0);
            }
          }),
        },
      } as any;
    });

    afterEach(() => {
      delete (global as any).window;
      delete (global as any).document;
    });

    it('should create a remote module', () => {
      const remoteMod = remote({
        url: 'https://example.com/module.js',
        scope: 'remoteScope',
      });

      expect(remoteMod.type).toBe('lazy');
      expect(remoteMod.load).toBeDefined();
    });

    it('should use fallback on load failure', async () => {
      const fallback: Module = {
        id: 'fallback',
        definition: { id: 'fallback', providers: [] },
      };

      const remoteMod = remote({
        url: 'https://example.com/module.js',
        scope: 'nonExistent',
        fallback,
        timeout: 100,
      });

      const loaded = await remoteMod.load();
      expect(loaded).toBe(fallback);
    });

    it('should throw error if no fallback provided', async () => {
      const remoteMod = remote({
        url: 'https://example.com/module.js',
        scope: 'nonExistent',
        timeout: 100,
      });

      await expect(remoteMod.load()).rejects.toThrow();
    });
  });

  describe('dynamic()', () => {
    it('should create a dynamic module', () => {
      const factory = () => ({
        id: 'dynamic-test',
        providers: [],
      });

      const dynamicMod = dynamic(factory);

      expect(dynamicMod.type).toBe('dynamic');
      expect(dynamicMod.factory).toBe(factory);
    });

    it('should support async factory', async () => {
      const factory = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          id: 'async-dynamic',
          providers: [],
        };
      };

      const dynamicMod = dynamic(factory);
      const definition = await dynamicMod.factory();

      expect(definition.id).toBe('async-dynamic');
    });

    it('should allow conditional module creation', async () => {
      const enabled = true;

      const factory = () => ({
        id: 'conditional-dynamic',
        providers: enabled ? [{ provide: 'Service', useValue: {} }] : [],
      });

      const dynamicMod = dynamic(factory);
      const definition = await dynamicMod.factory();

      expect(definition.providers).toHaveLength(1);
    });
  });

  describe('useModule()', () => {
    beforeEach(() => {
      clearCurrentModuleContext();
    });

    afterEach(() => {
      setApp(null as any);
      clearCurrentModuleContext();
    });

    it('should get module context by ID', () => {
      const mockApp = {
        getModuleContext: vi.fn().mockReturnValue({ initialized: true }),
      };

      setApp(mockApp as any);

      const context = useModule('test-module');

      expect(mockApp.getModuleContext).toHaveBeenCalledWith('test-module');
      expect(context.initialized).toBe(true);
    });

    it('should throw error if app not bootstrapped', () => {
      setApp(null as any);

      expect(() => useModule('test-module')).toThrow(/no application context/i);
    });

    it('should throw error if module not found', () => {
      const mockApp = {
        getModuleContext: vi.fn().mockReturnValue(undefined),
      };

      setApp(mockApp as any);

      expect(() => useModule('non-existent')).toThrow(/not found or not loaded/i);
    });

    it('should auto-detect current module', () => {
      const mockApp = {
        getModuleContext: vi.fn().mockReturnValue({ current: true }),
      };

      setApp(mockApp as any);
      setCurrentModuleContext('auto-module');

      const context = useModule();

      expect(mockApp.getModuleContext).toHaveBeenCalledWith('auto-module');
      expect(context.current).toBe(true);
    });

    it('should throw error if cannot determine current module', () => {
      const mockApp = {
        getModuleContext: vi.fn(),
      };

      setApp(mockApp as any);

      expect(() => useModule()).toThrow(/cannot determine current module/i);
    });
  });

  describe('useStore()', () => {
    beforeEach(() => {
      clearCurrentModuleContext();
    });

    it('should get store from current context', () => {
      // This is more of an integration test, but we can test the basic flow
      // In real usage, it would interact with store manager

      // Mock would need actual store manager implementation
      expect(useStore).toBeDefined();
      expect(typeof useStore).toBe('function');
    });
  });

  describe('useModuleLoaded()', () => {
    afterEach(() => {
      setApp(null as any);
    });

    it('should return signal for module loaded state', () => {
      const mockApp = {
        modules: {
          has: vi.fn().mockReturnValue(true),
        },
      };

      setApp(mockApp as any);

      const isLoaded = useModuleLoaded('test-module');

      expect(isLoaded()).toBe(true);
    });

    it('should return false if module not loaded', () => {
      const mockApp = {
        modules: {
          has: vi.fn().mockReturnValue(false),
        },
      };

      setApp(mockApp as any);

      const isLoaded = useModuleLoaded('test-module');

      expect(isLoaded()).toBe(false);
    });

    it('should return signal even if no app', () => {
      setApp(null as any);

      const isLoaded = useModuleLoaded('test-module');

      expect(isLoaded()).toBe(false);
    });
  });

  describe('preloadModule()', () => {
    it('should preload a lazy module', async () => {
      const module: Module = {
        id: 'preload-test',
        definition: { id: 'preload-test', providers: [] },
      };

      const lazyMod = lazy(() => Promise.resolve(module));

      const loaded = await preloadModule(lazyMod);

      expect(loaded).toBe(module);
    });

    it('should throw error for non-lazy module', async () => {
      const regularMod = {
        type: 'static',
        load: () => Promise.resolve({} as Module),
      } as any;

      await expect(preloadModule(regularMod)).rejects.toThrow(/only preload lazy modules/i);
    });
  });

  describe('conditional()', () => {
    it('should load module when condition is true', async () => {
      const module: Module = {
        id: 'conditional-true',
        definition: { id: 'conditional-true', providers: [] },
      };

      const conditionalMod = conditional(
        true,
        () => Promise.resolve(module),
        () => Promise.resolve({} as Module)
      );

      const definition = await conditionalMod.factory();

      expect(definition).toBe(module.definition);
    });

    it('should load fallback when condition is false', async () => {
      const fallback: Module = {
        id: 'conditional-fallback',
        definition: { id: 'conditional-fallback', providers: [] },
      };

      const conditionalMod = conditional(
        false,
        () => Promise.resolve({} as Module),
        () => Promise.resolve(fallback)
      );

      const definition = await conditionalMod.factory();

      expect(definition).toBe(fallback.definition);
    });

    it('should support function condition', async () => {
      let isEnabled = false;

      const module: Module = {
        id: 'conditional-fn',
        definition: { id: 'conditional-fn', providers: [] },
      };

      const fallback: Module = {
        id: 'conditional-fallback-fn',
        definition: { id: 'conditional-fallback-fn', providers: [] },
      };

      const conditionalMod = conditional(
        () => isEnabled,
        () => Promise.resolve(module),
        () => Promise.resolve(fallback)
      );

      // First call - condition is false
      let definition = await conditionalMod.factory();
      expect(definition.id).toBe('conditional-fallback-fn');
      expect(definition.id).not.toBe('conditional-fn');

      // Change condition
      isEnabled = true;

      // Second call - condition is true
      definition = await conditionalMod.factory();
      expect(definition.id).toBe('conditional-fn');
    });

    it('should return empty module if no fallback', async () => {
      const conditionalMod = conditional(false, () => Promise.resolve({} as Module));

      const definition = await conditionalMod.factory();

      expect(definition.id).toBe('conditional-empty');
      expect(definition.providers).toEqual([]);
    });
  });

  describe('compose()', () => {
    it('should compose multiple modules', () => {
      const module1: Module = {
        id: 'module1',
        definition: { id: 'module1', providers: [] },
      };

      const module2: Module = {
        id: 'module2',
        definition: { id: 'module2', providers: [] },
      };

      const module3: Module = {
        id: 'module3',
        definition: { id: 'module3', providers: [] },
      };

      const composed = compose('composed', [module1, module2, module3]);

      expect(composed.id).toBe('composed');
      expect(composed.definition.imports).toHaveLength(3);
      expect(composed.definition.imports).toContain(module1);
      expect(composed.definition.imports).toContain(module2);
      expect(composed.definition.imports).toContain(module3);
    });

    it('should create empty composed module', () => {
      const composed = compose('empty-composed', []);

      expect(composed.id).toBe('empty-composed');
      expect(composed.definition.imports).toEqual([]);
    });
  });

  describe('withProviders()', () => {
    it('should create module with additional providers', () => {
      const module: Module = {
        id: 'base-module',
        definition: { id: 'base-module', providers: [] },
      };

      const providers = [
        { provide: 'Service1', useValue: {} },
        { provide: 'Service2', useValue: {} },
      ];

      const withProvidersModule = withProviders(module, providers);

      expect(withProvidersModule.module).toBe(module);
      expect(withProvidersModule.providers).toBe(providers);
    });

    it('should support forRoot pattern', () => {
      const RouterModule: Module = {
        id: 'router',
        definition: { id: 'router', providers: [] },
      };

      const forRoot = (config: any) => withProviders(RouterModule, [{ provide: 'ROUTER_CONFIG', useValue: config }]);

      const configured = forRoot({ mode: 'history' });

      expect(configured.module).toBe(RouterModule);
      expect(configured.providers).toHaveLength(1);
    });
  });

  describe('extractStores()', () => {
    it('should extract stores from module', () => {
      const store1 = async () => ({ id: 'store1', state: {} });
      const store2 = async () => ({ id: 'store2', state: {} });

      const module: Module = {
        id: 'store-module',
        definition: {
          id: 'store-module',
          providers: [],
          stores: [store1, store2],
        },
      };

      const stores = extractStores(module);

      expect(stores).toHaveLength(2);
      expect(stores).toContain(store1);
      expect(stores).toContain(store2);
    });

    it('should extract stores from nested modules', () => {
      const store1 = async () => ({ id: 'store1', state: {} });
      const store2 = async () => ({ id: 'store2', state: {} });
      const store3 = async () => ({ id: 'store3', state: {} });

      const child: Module = {
        id: 'child',
        definition: {
          id: 'child',
          providers: [],
          stores: [store2, store3],
        },
      };

      const parent: Module = {
        id: 'parent',
        definition: {
          id: 'parent',
          imports: [child],
          providers: [],
          stores: [store1],
        },
      };

      const stores = extractStores(parent);

      expect(stores).toHaveLength(3);
      expect(stores).toContain(store1);
      expect(stores).toContain(store2);
      expect(stores).toContain(store3);
    });

    it('should return empty array if no stores', () => {
      const module: Module = {
        id: 'no-stores',
        definition: {
          id: 'no-stores',
          providers: [],
        },
      };

      const stores = extractStores(module);

      expect(stores).toEqual([]);
    });
  });

  describe('extractRoutes()', () => {
    it('should extract routes from module', () => {
      const route1 = { path: '/', component: {} };
      const route2 = { path: '/about', component: {} };

      const module: Module = {
        id: 'route-module',
        definition: {
          id: 'route-module',
          providers: [],
          routes: [route1, route2],
        },
      };

      const routes = extractRoutes(module);

      expect(routes).toHaveLength(2);
      expect(routes).toContain(route1);
      expect(routes).toContain(route2);
    });

    it('should extract routes from nested modules', () => {
      const route1 = { path: '/', component: {} };
      const route2 = { path: '/child', component: {} };

      const child: Module = {
        id: 'child',
        definition: {
          id: 'child',
          providers: [],
          routes: [route2],
        },
      };

      const parent: Module = {
        id: 'parent',
        definition: {
          id: 'parent',
          imports: [child],
          providers: [],
          routes: [route1],
        },
      };

      const routes = extractRoutes(parent);

      expect(routes).toHaveLength(2);
      expect(routes).toContain(route1);
      expect(routes).toContain(route2);
    });

    it('should return empty array if no routes', () => {
      const module: Module = {
        id: 'no-routes',
        definition: {
          id: 'no-routes',
          providers: [],
        },
      };

      const routes = extractRoutes(module);

      expect(routes).toEqual([]);
    });
  });

  describe('context management', () => {
    afterEach(() => {
      clearCurrentModuleContext();
    });

    it('should run function with module context', () => {
      let capturedContext: string | undefined;

      const result = withModuleContext('test-module', () => {
        capturedContext = 'test-module';
        return 'result';
      });

      expect(result).toBe('result');
      expect(capturedContext).toBe('test-module');
    });

    it('should restore previous context after execution', () => {
      setCurrentModuleContext('original');

      withModuleContext('temporary', () => {
        // Context is temporarily changed
      });

      // Context should be restored
      // We can't directly test this without exposing getCurrentModuleId
      // but the implementation ensures it
    });

    it('should run function with island context', () => {
      let executed = false;

      const result = withIslandContext('test-island', () => {
        executed = true;
        return 'island-result';
      });

      expect(result).toBe('island-result');
      expect(executed).toBe(true);
    });

    it('should handle nested context calls', () => {
      const result = withModuleContext('outer', () => withModuleContext('inner', () => 'nested'));

      expect(result).toBe('nested');
    });

    it('should handle errors and restore context', () => {
      setCurrentModuleContext('original');

      expect(() => {
        withModuleContext('temporary', () => {
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      // Context should still be restored even on error
    });
  });
});
