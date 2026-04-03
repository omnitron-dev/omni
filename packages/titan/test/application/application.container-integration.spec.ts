/**
 * Container Integration Tests for Titan Application
 *
 * Tests for DI container integration, service resolution, scope isolation,
 * global modules, and complex dependency scenarios.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application, APPLICATION_TOKEN } from '../../src/application.js';
import { ApplicationState, IModule } from '../../src/types.js';
import { Module, Injectable } from '../../src/decorators/index.js';
import { createToken, Container } from '../../src/nexus/index.js';

describe('Titan Application Container Integration', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop({ force: true });
    }
  });

  describe('Service Resolution', () => {
    it('should resolve services from container', async () => {
      const SERVICE_TOKEN = createToken<{ value: string }>('TestService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[SERVICE_TOKEN, { useValue: { value: 'test' } }]],
      });

      await app.start();

      const service = app.resolve(SERVICE_TOKEN);
      expect(service).toEqual({ value: 'test' });
    });

    it('should resolve application instance via token', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      const resolvedApp = app.resolve(APPLICATION_TOKEN);
      expect(resolvedApp).toBe(app);
    });

    it('should resolve services using get() method', async () => {
      const TOKEN = createToken<string>('SimpleToken');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[TOKEN, { useValue: 'simple-value' }]],
      });

      await app.start();

      const value = app.get(TOKEN);
      expect(value).toBe('simple-value');
    });

    it('should throw when resolving non-existent service', async () => {
      const MISSING_TOKEN = createToken<any>('MissingService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      expect(() => app.get(MISSING_TOKEN)).toThrow('not found');
    });

    it('should check if service exists using has()', async () => {
      const EXISTING_TOKEN = createToken<string>('ExistingService');
      const MISSING_TOKEN = createToken<string>('MissingService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[EXISTING_TOKEN, { useValue: 'exists' }]],
      });

      await app.start();

      expect(app.has(EXISTING_TOKEN)).toBe(true);
      expect(app.has(MISSING_TOKEN)).toBe(false);
    });
  });

  describe('Singleton Services', () => {
    it('should return same instance for singleton scope', async () => {
      let instanceCount = 0;

      @Injectable({ scope: 'singleton' })
      class SingletonService {
        id: number;
        constructor() {
          instanceCount++;
          this.id = instanceCount;
        }
      }

      const TOKEN = createToken<SingletonService>('SingletonService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[TOKEN, { useClass: SingletonService }]],
      });

      await app.start();

      const instance1 = app.resolve(TOKEN);
      const instance2 = app.resolve(TOKEN);

      expect(instance1).toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instanceCount).toBe(1);
    });
  });

  describe('Transient Services', () => {
    it('should return new instance for transient scope', async () => {
      let instanceCount = 0;

      @Injectable({ scope: 'transient' })
      class TransientService {
        id: number;
        constructor() {
          instanceCount++;
          this.id = instanceCount;
        }
      }

      const TOKEN = createToken<TransientService>('TransientService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[TOKEN, { useClass: TransientService, scope: 'transient' }]],
      });

      await app.start();

      const instance1 = app.resolve(TOKEN);
      const instance2 = app.resolve(TOKEN);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
    });
  });

  describe('Service Dependencies', () => {
    it('should resolve service with dependencies', async () => {
      const LOGGER_TOKEN = createToken<{ log: (msg: string) => void }>('Logger');
      const SERVICE_TOKEN = createToken<{ doWork: () => string }>('WorkService');

      const logs: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [LOGGER_TOKEN, { useValue: { log: (msg: string) => logs.push(msg) } }],
          [
            SERVICE_TOKEN,
            {
              useFactory: (logger: { log: (msg: string) => void }) => ({
                doWork: () => {
                  logger.log('working');
                  return 'done';
                },
              }),
              inject: [LOGGER_TOKEN],
            },
          ],
        ],
      });

      await app.start();

      const service = app.resolve(SERVICE_TOKEN);
      const result = service.doWork();

      expect(result).toBe('done');
      expect(logs).toContain('working');
    });

    it('should resolve chained dependencies', async () => {
      const A_TOKEN = createToken<{ value: string }>('A');
      const B_TOKEN = createToken<{ getValue: () => string }>('B');
      const C_TOKEN = createToken<{ getFullValue: () => string }>('C');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [A_TOKEN, { useValue: { value: 'base' } }],
          [
            B_TOKEN,
            {
              useFactory: (a: { value: string }) => ({
                getValue: () => a.value + '-extended',
              }),
              inject: [A_TOKEN],
            },
          ],
          [
            C_TOKEN,
            {
              useFactory: (b: { getValue: () => string }) => ({
                getFullValue: () => b.getValue() + '-final',
              }),
              inject: [B_TOKEN],
            },
          ],
        ],
      });

      await app.start();

      const c = app.resolve(C_TOKEN);
      expect(c.getFullValue()).toBe('base-extended-final');
    });
  });

  describe('Module-level Providers', () => {
    it('should register providers from module', async () => {
      const MODULE_SERVICE = createToken<{ name: string }>('ModuleService');

      @Module({
        providers: [{ provide: MODULE_SERVICE, useValue: { name: 'from-module' } }],
        exports: [MODULE_SERVICE],
      })
      class ServiceModule implements IModule {
        name = 'service-module';
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ServiceModule],
      });

      await app.start();

      const service = app.resolve(MODULE_SERVICE);
      expect(service.name).toBe('from-module');
    });

    it('should support multiple modules with providers', async () => {
      const USER_SERVICE = createToken<{ type: string }>('UserService');
      const PRODUCT_SERVICE = createToken<{ type: string }>('ProductService');

      @Module({
        providers: [{ provide: USER_SERVICE, useValue: { type: 'user' } }],
        exports: [USER_SERVICE],
      })
      class UserModule implements IModule {
        name = 'user-module';
      }

      @Module({
        providers: [{ provide: PRODUCT_SERVICE, useValue: { type: 'product' } }],
        exports: [PRODUCT_SERVICE],
      })
      class ProductModule implements IModule {
        name = 'product-module';
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [UserModule, ProductModule],
      });

      await app.start();

      expect(app.resolve(USER_SERVICE).type).toBe('user');
      expect(app.resolve(PRODUCT_SERVICE).type).toBe('product');
    });
  });

  describe('Custom Container', () => {
    it('should accept custom container in options', async () => {
      const customContainer = new Container();
      const CUSTOM_TOKEN = createToken<string>('CustomToken');

      customContainer.register(CUSTOM_TOKEN, { useValue: 'custom-value' });

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        container: customContainer,
      });

      await app.start();

      expect(app.container).toBe(customContainer);
      expect(app.resolve(CUSTOM_TOKEN)).toBe('custom-value');
    });
  });

  describe('Container Access', () => {
    it('should expose container property', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      expect(app.container).toBeDefined();
      expect(app.container).toBeInstanceOf(Container);
    });

    it('should allow direct container registration', async () => {
      const DIRECT_TOKEN = createToken<number>('DirectToken');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.container.register(DIRECT_TOKEN, { useValue: 42 });

      await app.start();

      expect(app.resolve(DIRECT_TOKEN)).toBe(42);
    });
  });

  describe('Service Replacement', () => {
    it('should allow replacing services before start', async () => {
      const SERVICE_TOKEN = createToken<{ value: string }>('ServiceReplace');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[SERVICE_TOKEN, { useValue: { value: 'original' } }]],
      });

      // Replace before start using override option
      app.container.register(SERVICE_TOKEN, { useValue: { value: 'replaced' } }, { override: true });

      await app.start();

      expect(app.resolve(SERVICE_TOKEN).value).toBe('replaced');
    });
  });

  describe('Module Integration with Container', () => {
    it('should resolve module by name token', async () => {
      @Module()
      class TestModule implements IModule {
        name = 'test-module';
        initialized = false;

        async onStart() {
          this.initialized = true;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [TestModule],
      });

      await app.start();

      const moduleToken = createToken<TestModule>('test-module');
      const module = app.get(moduleToken);

      expect(module).toBeDefined();
      expect(module.initialized).toBe(true);
    });
  });

  describe('Async Resolution', () => {
    it('should resolve async providers', async () => {
      const ASYNC_TOKEN = createToken<{ data: string }>('AsyncService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            ASYNC_TOKEN,
            {
              useFactory: async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { data: 'async-loaded' };
              },
            },
          ],
        ],
      });

      await app.start();

      const service = await app.container.resolveAsync(ASYNC_TOKEN);
      expect(service.data).toBe('async-loaded');
    });
  });

  describe('Container Lifecycle', () => {
    it('should initialize container on start', async () => {
      let initialized = false;

      @Injectable()
      class LifecycleService {
        constructor() {
          initialized = true;
        }
      }

      const TOKEN = createToken<LifecycleService>('LifecycleService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[TOKEN, { useClass: LifecycleService }]],
      });

      // Force eager initialization by resolving
      await app.start();
      app.resolve(TOKEN);

      expect(initialized).toBe(true);
    });
  });
});
