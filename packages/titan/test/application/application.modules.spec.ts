/**
 * Application Module Management Tests
 *
 * Tests for module-related functionality:
 * - Module registration
 * - Module lifecycle
 * - Module dependencies
 * - Module configuration
 * - Module health checks
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { Application, createApp } from '../../src/application.js';
import { createToken } from '../../src/nexus/index.js';
import {
  ApplicationState,
  ApplicationEvent,
  IModule,
  IHealthStatus
} from '../../src/types.js';
import {
  SimpleModule,
  DatabaseModule,
  CacheModule,
  HttpServerModule,
  MessageQueueModule,
  DependentModule,
  ApplicationModule,
  createTrackedModule,
  createCustomModule,
  createApplicationWithDependencies,
  createApplicationWithCircularDeps,
  createFullStackApplication
} from '../fixtures/test-modules.js';
import { Module, Injectable } from '../../src/decorators/index.js';

describe('Application Module Management', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop();
    }
  });

  describe('Module Registration', () => {
    it('should register and use modules', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();

      app.use(module);
      expect(app.modules.size).toBe(1);
      expect(app.modules.has('simple')).toBe(true);
    });

    it('should register multiple modules', () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.use(new DatabaseModule());
      app.use(new CacheModule());
      app.use(new HttpServerModule());

      expect(app.modules.size).toBe(3);
      expect(app.modules.has('database')).toBe(true);
      expect(app.modules.has('cache')).toBe(true);
      expect(app.modules.has('http')).toBe(true);
    });

    it('should get modules by token', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new DatabaseModule();
      const token = createToken<DatabaseModule>('database');

      app.use(module);
      // No need to manually register - app.use already registers it

      const retrieved = app.get(token);
      expect(retrieved).toBe(module);
    });

    it('should throw when getting non-existent module', () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const token = createToken('NonExistent');

      expect(() => app.get(token)).toThrow('not found');
    });

    it('should handle module registration with class constructor', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      @Module({
        providers: [{ provide: 'test', useValue: 'value' }]
      })
      class TestModule extends SimpleModule {
        override readonly name = 'test-module';
      }

      await app.registerModule(TestModule);
      expect(app.modules.has('test-module')).toBe(true);
    });

    it('should handle module registration with instance', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();

      await app.registerModule(module);
      expect(app.modules.has('simple')).toBe(true);
    });

    it('should handle module registration with plain object', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module: IModule = {
        name: 'plain-module',
        version: '1.0.0',
        onStart: jest.fn(),
        onStop: jest.fn()
      };

      await app.registerModule(module);
      expect(app.modules.has('plain-module')).toBe(true);

      await app.start();
      expect(module.onStart).toHaveBeenCalled();

      await app.stop();
      expect(module.onStop).toHaveBeenCalled();
    });

    it('should prevent duplicate module registration', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module1 = new SimpleModule();
      const module2 = new SimpleModule();

      app.use(module1);
      app.use(module2); // Should replace

      expect(app.modules.size).toBe(1);
    });

    it('should handle circular module registration', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();

      app.use(module);
      app.use(module); // Register same instance again

      expect(app.modules.size).toBe(1);
    });
  });

  describe('Module Lifecycle', () => {
    it('should call module lifecycle methods in order', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = createTrackedModule('tracked');

      app.use(module);

      await app.start();
      expect(module.calls).toEqual(['register', 'start']);

      await app.stop();
      expect(module.calls).toEqual(['register', 'start', 'stop', 'destroy']);
    });

    it('should handle module with partial lifecycle methods', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module: IModule = {
        name: 'partial',
        version: '1.0.0',
        onStart: jest.fn()
        // No onStop, onRegister, onDestroy
      };

      app.use(module);

      await app.start();
      expect(module.onStart).toHaveBeenCalled();

      await app.stop(); // Should not throw
    });

    it('should handle module with undefined lifecycle methods', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module: IModule = {
        name: 'empty',
        version: '1.0.0'
        // No lifecycle methods at all
      };

      app.use(module);

      await app.start(); // Should not throw
      await app.stop(); // Should not throw
    });

    it('should pass application instance to lifecycle methods', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let registerApp: any, startApp: any, stopApp: any;

      const module: IModule = {
        name: 'check-app',
        version: '1.0.0',
        onRegister: async (a) => { registerApp = a; },
        onStart: async (a) => { startApp = a; },
        onStop: async (a) => { stopApp = a; }
      };

      app.use(module);

      await app.start();
      expect(registerApp).toBe(app);
      expect(startApp).toBe(app);

      await app.stop();
      expect(stopApp).toBe(app);
    });

    it('should emit module events', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const events: any[] = [];

      app.on(ApplicationEvent.ModuleRegistered, (e) => events.push({ type: 'registered', module: e.module }));
      app.on(ApplicationEvent.ModuleStarted, (e) => events.push({ type: 'started', module: e.module }));
      app.on(ApplicationEvent.ModuleStopped, (e) => events.push({ type: 'stopped', module: e.module }));

      const module = new SimpleModule();
      app.use(module);

      await app.start();
      await app.stop();

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: 'registered', module: 'simple' });
      expect(events[1]).toEqual({ type: 'started', module: 'simple' });
      expect(events[2]).toEqual({ type: 'stopped', module: 'simple' });
    });
  });

  describe('Module Dependencies', () => {
    it('should handle module dependencies correctly', async () => {
      app = createApplicationWithDependencies();
      const startOrder: string[] = [];
      const stopOrder: string[] = [];

      // Track module start/stop order
      app.on(ApplicationEvent.ModuleStarted, (e) => startOrder.push(e.module));
      app.on(ApplicationEvent.ModuleStopped, (e) => stopOrder.push(e.module));

      await app.start();
      await app.stop();

      // Should start in dependency order
      expect(startOrder).toEqual(['module-c', 'module-b', 'module-a']);

      // Should stop in reverse order
      expect(stopOrder).toEqual(['module-a', 'module-b', 'module-c']);
    });

    it('should detect circular dependencies', async () => {
      app = createApplicationWithCircularDeps();

      await expect(app.start()).rejects.toThrow('Circular dependency detected');
    });

    it('should handle missing dependencies gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module: IModule = {
        name: 'dependent',
        version: '1.0.0',
        dependencies: ['missing-module']
      };

      app.use(module);

      // Should start despite missing dependency
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });

    it('should handle complex dependency chains', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      // Create dependency chain: A -> B -> C -> D
      const moduleD: IModule = { name: 'd', version: '1.0.0' };
      const moduleC: IModule = { name: 'c', version: '1.0.0', dependencies: ['d'] };
      const moduleB: IModule = { name: 'b', version: '1.0.0', dependencies: ['c'] };
      const moduleA: IModule = { name: 'a', version: '1.0.0', dependencies: ['b'] };

      // Register in random order
      app.use(moduleB);
      app.use(moduleD);
      app.use(moduleA);
      app.use(moduleC);

      const order: string[] = [];
      app.on(ApplicationEvent.ModuleStarted, (e) => order.push(e.module));

      await app.start();
      expect(order).toEqual(['d', 'c', 'b', 'a']);

      await app.stop();
    });

    it('should handle module with empty dependencies array', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module: IModule = {
        name: 'no-deps',
        version: '1.0.0',
        dependencies: []
      };

      app.use(module);

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });
  });

  describe('Module Configuration', () => {
    it('should configure modules with config', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          simple: { key: 'value', nested: { prop: 'data' } }
        }
      });

      const module = new SimpleModule();
      app.use(module);

      expect(module.configureCalled).toBe(true);
      expect(module.configValue).toEqual({ key: 'value', nested: { prop: 'data' } });
    });

    it('should handle module-specific configuration', async () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'db-server', port: 5432 },
          cache: { ttl: 30000 },
          http: { port: 8080 }
        }
      });

      const dbModule = new DatabaseModule();
      const cacheModule = new CacheModule();
      const httpModule = new HttpServerModule();

      app.use(dbModule);
      app.use(cacheModule);
      app.use(httpModule);

      await app.start();

      // Modules should be configured correctly
      expect(httpModule.port).toBe(8080);

      await app.stop();
    });

    it('should handle configuration with no module-specific config', async () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          global: { setting: 'value' }
          // No module-specific config
        }
      });

      const module = new SimpleModule();
      app.use(module);

      expect(module.configureCalled).toBe(false);
      expect(module.configValue).toBe(null);

      await app.start();
      await app.stop();
    });

    it('should allow runtime configuration updates', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();
      app.use(module);

      app.configure({
        simple: { initial: 'value' }
      });

      expect(module.configValue).toEqual({ initial: 'value' });

      app.configure({
        simple: { updated: 'new-value' }
      });

      // Configuration should be deep merged
      expect(module.configValue).toEqual({ initial: 'value', updated: 'new-value' });
    });
  });

  describe('Module Health Checks', () => {
    it('should perform module health checks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = new SimpleModule();
      app.use(module);

      await app.start();

      const health = await app.health();
      expect(health.status).toBe('healthy');
      expect(health.modules).toBeDefined();
      expect(health.modules.simple).toEqual({
        status: 'healthy',
        message: 'Simple module health check',
        details: {
          started: true,
          config: null
        }
      });

      await app.stop();
    });

    it('should handle unhealthy modules', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const unhealthyModule = createCustomModule({
        name: 'unhealthy',
        health: async () => ({
          status: 'unhealthy',
          message: 'Service is down',
          details: { error: 'Connection refused' }
        })
      });

      app.use(unhealthyModule);

      await app.start();

      const health = await app.health();
      expect(health.status).toBe('unhealthy');
      expect(health.modules.unhealthy.status).toBe('unhealthy');

      await app.stop();
    });

    it('should handle modules without health check', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module: IModule = {
        name: 'no-health',
        version: '1.0.0'
        // No health method
      };

      app.use(module);

      await app.start();

      const health = await app.health();
      expect(health.status).toBe('healthy');
      expect(health.modules['no-health']).toBeUndefined();

      await app.stop();
    });

    it('should aggregate health status correctly', async () => {
      app = createFullStackApplication();

      await app.start();

      const health = await app.health();
      expect(health.status).toBe('healthy');
      expect(Object.keys(health.modules).length).toBeGreaterThan(0);

      // All modules should be healthy
      for (const [moduleName, moduleHealth] of Object.entries(health.modules)) {
        expect(moduleHealth.status).toBe('healthy');
      }

      await app.stop();
    });

    it('should handle health check errors gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const errorModule = createCustomModule({
        name: 'error-health',
        health: async () => {
          throw new Error('Health check failed');
        }
      });

      app.use(errorModule);

      await app.start();

      const health = await app.health();
      // Should still return a result, not throw
      expect(health.status).toBeDefined();

      await app.stop();
    });
  });

  describe('Module Stop Behavior', () => {
    it('should stop modules in reverse order', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const stopOrder: string[] = [];

      const module1 = createCustomModule({
        name: 'module1',
        onStop: async () => { stopOrder.push('module1'); }
      });

      const module2 = createCustomModule({
        name: 'module2',
        onStop: async () => { stopOrder.push('module2'); }
      });

      const module3 = createCustomModule({
        name: 'module3',
        onStop: async () => { stopOrder.push('module3'); }
      });

      app.use(module1);
      app.use(module2);
      app.use(module3);

      await app.start();
      await app.stop();

      expect(stopOrder).toEqual(['module3', 'module2', 'module1']);
    });

    it('should handle module stop timeout', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const slowModule = createCustomModule({
        name: 'slow-stop',
        onStop: async () => {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      });

      app.use(slowModule);

      await app.start();

      // Should timeout
      await expect(app.stop({ timeout: 100 })).rejects.toThrow('timed out');
    });

    it('should handle module onStop without timeout option', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module = createCustomModule({
        name: 'normal-stop',
        onStop: jest.fn()
      });

      app.use(module);

      await app.start();
      await app.stop(); // No timeout option

      expect(module.onStop).toHaveBeenCalled();
    });

    it('should call onDestroy after onStop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const calls: string[] = [];

      const module = createCustomModule({
        name: 'lifecycle',
        onStop: async () => { calls.push('stop'); },
        onStart: async () => { calls.push('start'); }
      });

      // Add destroy separately since it's not in the options
      (module as any).onDestroy = async () => { calls.push('destroy'); };

      app.use(module);

      await app.start();
      expect(calls).toEqual(['start']);

      await app.stop();
      expect(calls).toEqual(['start', 'stop', 'destroy']);
    });
  });
});
