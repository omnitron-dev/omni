/**
 * Application Module Management Tests
 *
 * Tests for module registration, dependencies, health checks,
 * and module-specific functionality.
 */

import { Application, createApp } from '../../src/application.js';
import { createToken } from '@nexus';
import {
  SimpleModule,
  DatabaseModule,
  HttpServerModule,
  CacheModule,
  DependentModule
} from '../fixtures/test-modules.js';
import { Module, Injectable, Inject } from '../../src/decorators/index.js';
import { IModule, AbstractModule, IHealthStatus, IApplication } from '../../src/types.js';

describe('Application Module Management', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp({
      name: 'module-test',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });
  });

  afterEach(async () => {
    if (app && app.state !== 'stopped') {
      await app.stop({ force: true });
    }
  });

  describe('Module Registration', () => {
    it('should register and retrieve modules', () => {
      const module1 = new SimpleModule();
      const module2 = new DatabaseModule();

      app.use(module1);
      app.use(module2);

      expect(app.hasModule('simple')).toBe(true);
      expect(app.hasModule('database')).toBe(true);
      expect(app.hasModule('nonexistent')).toBe(false);
    });

    it('should prevent duplicate module registration', () => {
      const module = new SimpleModule();
      app.use(module);

      expect(() => app.use(module)).toThrow(/already registered/i);
    });

    it('should get module by name', async () => {
      const module = new SimpleModule();
      app.use(module);
      await app.start();

      const retrieved = app.getModule('simple');
      expect(retrieved).toBe(module);
    });

    it('should get all modules', () => {
      const module1 = new SimpleModule();
      const module2 = new DatabaseModule();
      const module3 = new CacheModule();

      app.use(module1);
      app.use(module2);
      app.use(module3);

      const modules = app.getModules();
      expect(modules).toHaveLength(3);
      expect(modules).toContain(module1);
      expect(modules).toContain(module2);
      expect(modules).toContain(module3);
    });

    it('should replace existing module', async () => {
      const original = new SimpleModule();
      app.use(original);

      class NewSimpleModule extends SimpleModule {
        newMethod() {
          return 'new';
        }
      }

      const replacement = new NewSimpleModule();
      app.replaceModule('simple', replacement);

      await app.start();

      const retrieved = app.getModule('simple') as NewSimpleModule;
      expect(retrieved).toBe(replacement);
      expect(retrieved.newMethod()).toBe('new');
    });
  });

  describe('Module Dependencies', () => {
    it('should sort modules by dependencies', async () => {
      class ModuleA extends SimpleModule {
        override readonly name = 'module-a';
        override readonly dependencies = ['module-b'];
      }

      class ModuleB extends SimpleModule {
        override readonly name = 'module-b';
        override readonly dependencies = ['module-c'];
      }

      class ModuleC extends SimpleModule {
        override readonly name = 'module-c';
      }

      // Register in wrong order
      app.use(new ModuleA());
      app.use(new ModuleC());
      app.use(new ModuleB());

      await app.start();

      const modules = app.getModules();
      const names = modules.map(m => m.name);

      // Should be sorted: C -> B -> A
      const cIndex = names.indexOf('module-c');
      const bIndex = names.indexOf('module-b');
      const aIndex = names.indexOf('module-a');

      expect(cIndex).toBeLessThan(bIndex);
      expect(bIndex).toBeLessThan(aIndex);
    });

    it('should detect circular dependencies', async () => {
      class CircularA extends SimpleModule {
        override readonly name = 'circular-a';
        override readonly dependencies = ['circular-b'];
      }

      class CircularB extends SimpleModule {
        override readonly name = 'circular-b';
        override readonly dependencies = ['circular-a'];
      }

      app.use(new CircularA());
      app.use(new CircularB());

      // Starting the app should detect circular dependency
      await expect(app.start()).rejects.toThrow(/circular/i);
    });

    it('should handle missing dependencies gracefully', async () => {
      class ModuleWithMissingDep extends SimpleModule {
        override readonly name = 'missing-dep';
        override readonly dependencies = ['nonexistent'];
      }

      app.use(new ModuleWithMissingDep());

      // Should not throw, just warn (dependencies are optional)
      await expect(app.start()).resolves.not.toThrow();
    });

    it('should handle complex dependency chains', async () => {
      const modules: IModule[] = [];

      // Create a complex dependency tree
      for (let i = 0; i < 5; i++) {
        class TestModule extends SimpleModule {
          override readonly name = `module-${i}`;
          override readonly dependencies = i > 0 ? [`module-${i - 1}`] : [];
        }
        modules.push(new TestModule());
      }

      // Register in reverse order
      modules.reverse().forEach(m => app.use(m));

      await app.start();

      const registered = app.getModules();
      for (let i = 0; i < 4; i++) {
        const current = registered.findIndex(m => m.name === `module-${i}`);
        const next = registered.findIndex(m => m.name === `module-${i + 1}`);
        expect(current).toBeLessThan(next);
      }
    });
  });

  describe('Module Configuration', () => {
    it('should configure modules', async () => {
      // Create a module without dependencies for testing configuration
      class TestConfigurableModule extends DatabaseModule {
        override readonly dependencies = [];
      }

      const module = new TestConfigurableModule();
      app.use(module);

      app.configure('database', {
        host: 'custom-host',
        port: 3306,
        poolSize: 20
      });

      await app.start();

      const health = await module.health();
      expect(health.details?.config).toMatchObject({
        host: 'custom-host',
        port: 3306
      });
    });

    it('should configure module via global config', async () => {
      const app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: {
            host: 'global-host',
            port: 5432
          }
        }
      });

      // Create a module without dependencies for testing configuration
      class TestConfigurableModule extends DatabaseModule {
        override readonly dependencies = [];
      }

      const module = new TestConfigurableModule();
      app.use(module);
      await app.start();

      const health = await module.health();
      expect(health.details?.config.host).toBe('global-host');
    });

    it('should merge module configurations', async () => {
      const app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'initial' }
        }
      });

      // Create a module without dependencies for testing configuration
      class TestConfigurableModule extends DatabaseModule {
        override readonly dependencies = [];
      }

      const module = new TestConfigurableModule();
      app.use(module);

      app.configure('database', {
        port: 3306,
        poolSize: 10
      });

      await app.start();

      const health = await module.health();
      expect(health.details?.config).toMatchObject({
        host: 'initial',
        port: 3306
      });
    });
  });

  describe('Module Health Checks', () => {
    it('should check individual module health', async () => {
      const module = new SimpleModule();
      app.use(module);

      await app.start();

      const health = await app.checkHealth('simple');
      expect(health.status).toBe('healthy');
      expect(health.details?.started).toBe(true);
    });

    it('should check all modules health', async () => {
      const simple = new SimpleModule();

      // Create a module without dependencies for testing health
      class TestDatabaseModule extends DatabaseModule {
        override readonly dependencies = [];
      }
      const database = new TestDatabaseModule();

      app.use(simple);
      app.use(database);

      await app.start();

      const health = await app.health();
      expect(health.status).toBe('healthy');
      expect(health.modules).toHaveProperty('simple');
      expect(health.modules).toHaveProperty('database');
      expect(health.modules.simple.status).toBe('healthy');
      expect(health.modules.database.status).toBe('healthy');
    });

    it('should handle unhealthy modules', async () => {
      class UnhealthyModule extends SimpleModule {
        override readonly name = 'unhealthy';

        override async health(): Promise<IHealthStatus> {
          return {
            status: 'unhealthy',
            message: 'Module is not healthy',
            error: 'Database connection lost'
          };
        }
      }

      app.use(new UnhealthyModule());
      await app.start();

      const health = await app.health();
      expect(health.status).toBe('unhealthy');
      expect(health.modules.unhealthy.status).toBe('unhealthy');
    });

    it('should handle module health check errors', async () => {
      class ErrorModule extends SimpleModule {
        override readonly name = 'error-module';

        override async health(): Promise<IHealthStatus> {
          throw new Error('Health check failed');
        }
      }

      app.use(new ErrorModule());
      await app.start();

      const health = await app.health();
      expect(health.status).toBe('unhealthy');
      expect(health.modules['error-module'].status).toBe('unhealthy');
      expect(health.modules['error-module'].details?.error).toContain('Health check failed');
    });
  });

  describe('Decorator-based Modules', () => {
    it.skip('should register module with @Module decorator', async () => {
      @Injectable()
      class TestService {
        getValue() {
          return 'test-value';
        }
      }

      @Module({
        providers: [TestService],
        exports: [TestService]
      })
      class TestModule extends AbstractModule {
        override readonly name = 'decorated-module';

        constructor(private testService: TestService) {
          super();
        }

        getService() {
          return this.testService;
        }
      }

      // Register the module class and its dependencies first
      app.container.register(TestService);
      app.container.register(TestModule);

      const module = app.container.resolve(TestModule);
      app.use(module);
      await app.start();

      const retrieved = app.getModule('decorated-module') as TestModule;
      expect(retrieved.getService().getValue()).toBe('test-value');
    });

    it.skip('should handle module with complex DI', async () => {
      const LoggerToken = createToken<{ log: (msg: string) => void }>('Logger');
      const ConfigToken = createToken<{ get: (key: string) => any }>('Config');

      @Injectable()
      class ComplexService {
        constructor(
          @Inject(LoggerToken) private logger: any,
          @Inject(ConfigToken) private config: any
        ) { }

        doSomething() {
          this.logger.log('Doing something');
          return this.config.get('value');
        }
      }

      @Module({
        providers: [
          { provide: LoggerToken, useValue: { log: jest.fn() } },
          { provide: ConfigToken, useValue: { get: () => 'config-value' } },
          ComplexService
        ],
        exports: [ComplexService]
      })
      class ComplexModule extends AbstractModule {
        override readonly name = 'complex-module';

        constructor(private service: ComplexService) {
          super();
        }

        execute() {
          return this.service.doSomething();
        }
      }

      // Register all dependencies
      app.container.register(LoggerToken, { useValue: { log: jest.fn() } });
      app.container.register(ConfigToken, { useValue: { get: () => 'config-value' } });
      app.container.register(ComplexService);
      app.container.register(ComplexModule);

      const module = app.container.resolve(ComplexModule);
      app.use(module);
      await app.start();

      const retrieved = app.getModule('complex-module') as ComplexModule;
      expect(retrieved.execute()).toBe('config-value');
    });
  });

  describe('Module Access Patterns', () => {
    it('should access module via token', async () => {
      // Create a module without dependencies for testing
      class TestDatabaseModule extends DatabaseModule {
        override readonly dependencies = [];
      }

      const ModuleToken = createToken<TestDatabaseModule>('DatabaseModule');

      const module = new TestDatabaseModule();
      app.use(module);
      app.container.register(ModuleToken, { useValue: module });

      await app.start();

      const retrieved = app.container.resolve(ModuleToken);
      expect(retrieved).toBe(module);
    });

    it('should provide inter-module communication', async () => {
      // Create modules without dependencies for testing
      class TestDatabaseModule extends DatabaseModule {
        override readonly dependencies = [];
      }
      class TestCacheModule extends CacheModule {
        override readonly dependencies = [];
      }
      class TestDependentModule extends DependentModule {
        override readonly dependencies = ['database', 'cache'];
      }

      const database = new TestDatabaseModule();
      const cache = new TestCacheModule();
      const dependent = new TestDependentModule();

      app.use(database);
      app.use(cache);
      app.use(dependent);

      await app.start();

      // DependentModule should be registered and started
      const retrievedDependent = app.getModule('dependent');
      expect(retrievedDependent).toBeDefined();
      expect(retrievedDependent).toBe(dependent);
    });
  });
});