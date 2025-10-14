/**
 * @fileoverview Application Tests
 *
 * Tests Aether application functionality:
 * - createApp function
 * - App bootstrap process
 * - Module hierarchy loading
 * - Global error handling
 * - App unmount and cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createApp,
  mount,
  quickStart,
  createTestApp,
  setApp,
  getApp,
} from '../../src/core/application.js';
import type { Module } from '../../src/di/types.js';

// Mock dependencies
vi.mock('../../src/router/module-integration.js', () => ({
  createModuleAwareRouter: vi.fn().mockReturnValue({
    ready: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  }),
  RouterLifecycleManager: vi.fn().mockImplementation(() => ({
    initializeModule: vi.fn().mockResolvedValue(undefined),
    cleanupModule: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/store/module-integration.js', () => ({
  ModuleScopedStoreManager: vi.fn().mockImplementation(() => ({
    dispose: vi.fn(),
  })),
  StoreLifecycleManager: vi.fn().mockImplementation(() => ({
    initializeStores: vi.fn().mockResolvedValue(undefined),
    cleanupStores: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/islands/module-integration.js', () => ({
  ModuleIslandManager: vi.fn().mockImplementation(() => ({
    discoverIslands: vi.fn(),
    dispose: vi.fn(),
  })),
  IslandLifecycleManager: vi.fn().mockImplementation(() => ({
    initializeModule: vi.fn().mockResolvedValue(undefined),
    cleanupModule: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('Application', () => {
  afterEach(() => {
    setApp(null as any);
  });

  describe('createApp()', () => {
    it('should create an application instance', () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });

      expect(app).toBeDefined();
      expect(app.container).toBeDefined();
      expect(app.modules).toBeDefined();
      expect(app.router).toBeDefined();
      expect(app.stores).toBeDefined();
      expect(app.islands).toBeDefined();
    });

    it('should accept router configuration', () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({
        rootModule,
        router: {
          mode: 'history',
          base: '/app',
        },
      });

      expect(app.router).toBeDefined();
    });

    it('should accept error handler', () => {
      const onError = vi.fn();
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({
        rootModule,
        onError,
      });

      expect(app).toBeDefined();
    });

    it('should accept islands configuration', () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({
        rootModule,
        islands: true,
      });

      expect(app.islands).toBeDefined();
    });
  });

  describe('bootstrap()', () => {
    it('should bootstrap application', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });

      await expect(app.bootstrap()).resolves.not.toThrow();
    });

    it('should register and load root module', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      expect(app.modules.has('root')).toBe(true);
    });

    it('should load module hierarchy', async () => {
      const child1: Module = {
        id: 'child1',
        definition: { id: 'child1', providers: [] },
      };

      const child2: Module = {
        id: 'child2',
        definition: { id: 'child2', providers: [] },
      };

      const rootModule: Module = {
        id: 'root',
        definition: {
          id: 'root',
          imports: [child1, child2],
          providers: [],
        },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      expect(app.modules.has('root')).toBe(true);
      expect(app.modules.has('child1')).toBe(true);
      expect(app.modules.has('child2')).toBe(true);
    });

    it('should execute module setup hooks', async () => {
      const setupFn = vi.fn().mockResolvedValue({ initialized: true });

      const rootModule: Module = {
        id: 'root',
        definition: {
          id: 'root',
          providers: [],
          setup: setupFn,
        },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      expect(setupFn).toHaveBeenCalled();
    });

    it('should throw error on double bootstrap', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      await expect(app.bootstrap()).rejects.toThrow(/cannot bootstrap/i);
    });

    it('should handle bootstrap errors', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: {
          id: 'root',
          providers: [],
          setup: () => {
            throw new Error('Bootstrap failed');
          },
        },
      };

      const app = createApp({ rootModule });

      await expect(app.bootstrap()).rejects.toThrow('Bootstrap failed');
    });

    it('should discover islands in browser environment', async () => {
      global.document = {} as any;

      const rootModule: Module = {
        id: 'root',
        definition: {
          id: 'root',
          providers: [],
          islands: [
            {
              id: 'test-island',
              component: async () => ({}),
            },
          ],
        },
      };

      const app = createApp({
        rootModule,
        islands: true,
      });

      await app.bootstrap();

      expect(app.islands.discoverIslands).toHaveBeenCalled();

      delete (global as any).document;
    });

    it('should call router ready', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      expect(app.router.ready).toHaveBeenCalled();
    });
  });

  describe('unmount()', () => {
    it('should unmount application', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      await expect(app.unmount()).resolves.not.toThrow();
    });

    it('should execute module teardown hooks', async () => {
      const teardownFn = vi.fn().mockResolvedValue(undefined);

      const rootModule: Module = {
        id: 'root',
        definition: {
          id: 'root',
          providers: [],
          teardown: teardownFn,
        },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();
      await app.unmount();

      expect(teardownFn).toHaveBeenCalled();
    });

    it('should dispose router', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();
      await app.unmount();

      expect(app.router.dispose).toHaveBeenCalled();
    });

    it('should dispose stores', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();
      await app.unmount();

      expect(app.stores.dispose).toHaveBeenCalled();
    });

    it('should dispose islands', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();
      await app.unmount();

      expect(app.islands.dispose).toHaveBeenCalled();
    });

    it('should clear container', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      const clearSpy = vi.spyOn(app.container, 'clear');

      await app.unmount();

      expect(clearSpy).toHaveBeenCalled();
    });

    it('should handle unmount without bootstrap', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });

      await expect(app.unmount()).resolves.not.toThrow();
    });

    it('should not throw on double unmount', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();
      await app.unmount();

      await expect(app.unmount()).resolves.not.toThrow();
    });
  });

  describe('getModuleContext()', () => {
    it('should get module context', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: {
          id: 'root',
          providers: [],
          setup: () => ({ initialized: true }),
        },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      const context = app.getModuleContext('root');

      expect(context).toBeDefined();
      expect(context?.initialized).toBe(true);
    });

    it('should return undefined for non-existent module', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      await app.bootstrap();

      const context = app.getModuleContext('non-existent');

      expect(context).toBeUndefined();
    });
  });

  describe('global error handling', () => {
    beforeEach(() => {
      global.window = {
        addEventListener: vi.fn(),
      } as any;
    });

    afterEach(() => {
      delete (global as any).window;
    });

    it('should setup global error handlers', () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      createApp({ rootModule });

      expect(global.window.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
      expect(global.window.addEventListener).toHaveBeenCalledWith(
        'unhandledrejection',
        expect.any(Function)
      );
    });

    it('should call custom error handler', () => {
      const onError = vi.fn();
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      createApp({ rootModule, onError });

      // Manually trigger the error handler
      const errorHandler = (global.window.addEventListener as any).mock.calls.find(
        (call: any) => call[0] === 'error'
      )[1];

      const error = new Error('Test error');
      errorHandler({ error });

      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  describe('mount()', () => {
    beforeEach(() => {
      global.document = {
        querySelector: vi.fn().mockReturnValue({
          innerHTML: '',
        }),
      } as any;
    });

    afterEach(() => {
      delete (global as any).document;
    });

    it('should mount application to DOM element', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      const unmount = await mount(app, '#app');

      expect(global.document.querySelector).toHaveBeenCalledWith('#app');
      expect(unmount).toBeDefined();
      expect(typeof unmount).toBe('function');
    });

    it('should bootstrap app during mount', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      const bootstrapSpy = vi.spyOn(app, 'bootstrap');

      await mount(app, '#app');

      expect(bootstrapSpy).toHaveBeenCalled();
    });

    it('should return unmount function', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      const unmount = await mount(app, '#app');

      await expect(unmount()).resolves.not.toThrow();
    });

    it('should throw error for non-existent element', async () => {
      (global.document.querySelector as any).mockReturnValue(null);

      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });

      await expect(mount(app, '#non-existent')).rejects.toThrow(/cannot find element/i);
    });

    it('should accept HTMLElement directly', async () => {
      const element = { innerHTML: '' } as any;

      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      const unmount = await mount(app, element);

      expect(unmount).toBeDefined();
    });

    it('should clear element on unmount', async () => {
      const element = { innerHTML: 'content' };

      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      const unmount = await mount(app, element as any);

      await unmount();

      expect(element.innerHTML).toBe('');
    });
  });

  describe('quickStart()', () => {
    beforeEach(() => {
      global.document = {
        querySelector: vi.fn().mockReturnValue({
          innerHTML: '',
        }),
      } as any;
    });

    afterEach(() => {
      delete (global as any).document;
    });

    it('should quick start application', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = await quickStart(rootModule);

      expect(app).toBeDefined();
    });

    it('should mount if selector provided', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = await quickStart(rootModule, { mount: '#app' });

      expect(global.document.querySelector).toHaveBeenCalledWith('#app');
      expect(app).toBeDefined();
    });

    it('should accept router configuration', async () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = await quickStart(rootModule, {
        router: { mode: 'history' },
      });

      expect(app.router).toBeDefined();
    });

    it('should accept error handler', async () => {
      const onError = vi.fn();
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = await quickStart(rootModule, { onError });

      expect(app).toBeDefined();
    });
  });

  describe('createTestApp()', () => {
    it('should create test application', () => {
      const rootModule: Module = {
        id: 'test-root',
        definition: { id: 'test-root', providers: [] },
      };

      const app = createTestApp({ rootModule });

      expect(app).toBeDefined();
    });

    it('should register mock providers', () => {
      const rootModule: Module = {
        id: 'test-root',
        definition: { id: 'test-root', providers: [] },
      };

      const mockProviders = [
        { provide: 'ApiService', useClass: class {} },
        { provide: 'AuthService', useValue: {} },
      ];

      const app = createTestApp({ rootModule, mockProviders });

      expect(app.container).toBeDefined();
    });

    it('should disable islands in test mode', () => {
      const rootModule: Module = {
        id: 'test-root',
        definition: {
          id: 'test-root',
          providers: [],
          islands: [
            {
              id: 'test-island',
              component: async () => ({}),
            },
          ],
        },
      };

      const app = createTestApp({ rootModule });

      expect(app).toBeDefined();
    });
  });

  describe('global app instance', () => {
    beforeEach(() => {
      global.window = {
        addEventListener: vi.fn(),
      } as any;
    });

    afterEach(() => {
      setApp(null as any);
      delete (global as any).window;
    });

    it('should set global app instance', () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      setApp(app);

      expect(getApp()).toBe(app);
    });

    it('should expose app to window for dev tools', () => {
      const rootModule: Module = {
        id: 'root',
        definition: { id: 'root', providers: [] },
      };

      const app = createApp({ rootModule });
      setApp(app);

      expect((global.window as any).__AETHER_APP__).toBe(app);
    });

    it('should return null if no app set', () => {
      expect(getApp()).toBeNull();
    });
  });
});
