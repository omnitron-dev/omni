/**
 * Comprehensive DI System Tests
 *
 * This test suite ensures the robustness and reliability of the dependency injection system
 * in Nexus and Titan, covering edge cases, performance, and best practices.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import 'reflect-metadata';
import {
  Container,
  createToken,
  Injectable,
  Inject,
  Optional,
  Singleton,
  Transient,
  Scope,
  CircularDependencyError
} from '@nexus';
import {
  Service,
  OnInit,
  OnDestroy,
  TitanApplication,
  EnhancedApplicationModule
} from '../src/index.js';
import { ConfigModule } from '../src/modules/config/config.module.js';
const CONFIG_SERVICE_TOKEN = createToken('ConfigModule');

// Test utilities
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Comprehensive DI System Tests', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(() => {
    container.dispose();
  });

  describe('Basic Dependency Injection', () => {
    it('should resolve simple dependencies', () => {
      const token = createToken<string>('test');
      container.register(token, { useValue: 'hello' });

      const value = container.resolve(token);
      expect(value).toBe('hello');
    });

    it('should resolve class dependencies with constructor injection', () => {
      const ConfigToken = createToken<{ apiUrl: string }>('Config');

      @Injectable()
      class ApiService {
        constructor(
          @Inject(ConfigToken) public config: { apiUrl: string }
        ) { }
      }

      container.register(ConfigToken, { useValue: { apiUrl: 'http://api.test' } });
      container.register(ApiService, { useClass: ApiService });

      const service = container.resolve(ApiService);
      expect(service.config.apiUrl).toBe('http://api.test');
    });

    it('should handle property injection', () => {
      const LoggerToken = createToken<{ log: (msg: string) => void }>('Logger');

      @Injectable()
      class ServiceWithPropertyInjection {
        @Inject(LoggerToken)
        public logger!: { log: (msg: string) => void };

        logMessage(msg: string) {
          this.logger.log(msg);
        }
      }

      const mockLogger = { log: jest.fn() };
      container.register(LoggerToken, { useValue: mockLogger });
      container.register(ServiceWithPropertyInjection, { useClass: ServiceWithPropertyInjection });

      const service = container.resolve(ServiceWithPropertyInjection);
      service.logMessage('test');

      expect(mockLogger.log).toHaveBeenCalledWith('test');
    });
  });

  describe('Dependency Scopes', () => {
    it('should handle singleton scope correctly', () => {
      @Injectable()
      @Singleton()
      class SingletonService {
        public id = Math.random();
      }

      container.register(SingletonService, { useClass: SingletonService, scope: 'singleton' });

      const instance1 = container.resolve(SingletonService);
      const instance2 = container.resolve(SingletonService);

      expect(instance1).toBe(instance2);
      expect(instance1.id).toBe(instance2.id);
    });

    it('should handle transient scope correctly', () => {
      @Injectable()
      @Transient()
      class TransientService {
        public id = Math.random();
      }

      container.register(TransientService, { useClass: TransientService, scope: 'transient' });

      const instance1 = container.resolve(TransientService);
      const instance2 = container.resolve(TransientService);

      expect(instance1).not.toBe(instance2);
      expect(instance1.id).not.toBe(instance2.id);
    });

    it('should handle scoped instances in child containers', () => {
      @Injectable()
      class ScopedService {
        public id = Math.random();
      }

      container.register(ScopedService, { useClass: ScopedService, scope: 'scoped' });

      const childContainer1 = container.createChildContainer();
      const childContainer2 = container.createChildContainer();

      const instance1a = childContainer1.resolve(ScopedService);
      const instance1b = childContainer1.resolve(ScopedService);
      const instance2 = childContainer2.resolve(ScopedService);

      expect(instance1a).toBe(instance1b); // Same instance in same child container
      expect(instance1a).not.toBe(instance2); // Different instances in different child containers
    });
  });

  describe('Circular Dependencies', () => {
    it('should detect direct circular dependencies', () => {
      const AToken = createToken<any>('A');
      const BToken = createToken<any>('B');

      @Injectable()
      class A {
        constructor(@Inject(BToken) public b: any) { }
      }

      @Injectable()
      class B {
        constructor(@Inject(AToken) public a: any) { }
      }

      container.register(AToken, { useClass: A });
      container.register(BToken, { useClass: B });

      expect(() => container.resolve(AToken)).toThrow(CircularDependencyError);
    });

    it('should detect indirect circular dependencies', () => {
      const AToken = createToken<any>('A');
      const BToken = createToken<any>('B');
      const CToken = createToken<any>('C');

      @Injectable()
      class A {
        constructor(@Inject(BToken) public b: any) { }
      }

      @Injectable()
      class B {
        constructor(@Inject(CToken) public c: any) { }
      }

      @Injectable()
      class C {
        constructor(@Inject(AToken) public a: any) { }
      }

      container.register(AToken, { useClass: A });
      container.register(BToken, { useClass: B });
      container.register(CToken, { useClass: C });

      expect(() => container.resolve(AToken)).toThrow(CircularDependencyError);
    });
  });

  describe('Optional Dependencies', () => {
    it('should handle optional dependencies that are not registered', () => {
      const RequiredToken = createToken<string>('Required');
      const OptionalToken = createToken<string>('Optional');

      @Injectable()
      class ServiceWithOptional {
        constructor(
          @Inject(RequiredToken) public required: string,
          @Optional() @Inject(OptionalToken) public optional?: string
        ) { }
      }

      container.register(RequiredToken, { useValue: 'required' });
      container.register(ServiceWithOptional, { useClass: ServiceWithOptional });

      const service = container.resolve(ServiceWithOptional);
      expect(service.required).toBe('required');
      expect(service.optional).toBeUndefined();
    });

    it('should inject optional dependencies when they are registered', () => {
      const RequiredToken = createToken<string>('Required');
      const OptionalToken = createToken<string>('Optional');

      @Injectable()
      class ServiceWithOptional {
        constructor(
          @Inject(RequiredToken) public required: string,
          @Optional() @Inject(OptionalToken) public optional?: string
        ) { }
      }

      container.register(RequiredToken, { useValue: 'required' });
      container.register(OptionalToken, { useValue: 'optional' });
      container.register(ServiceWithOptional, { useClass: ServiceWithOptional });

      const service = container.resolve(ServiceWithOptional);
      expect(service.required).toBe('required');
      expect(service.optional).toBe('optional');
    });
  });

  describe('Factory Providers', () => {
    it('should resolve dependencies using factory functions', () => {
      const ConfigToken = createToken<{ env: string }>('Config');
      const ApiToken = createToken<{ getUrl: () => string }>('Api');

      container.register(ConfigToken, { useValue: { env: 'production' } });
      container.register(ApiToken, {
        useFactory: (config: { env: string }) => ({
          getUrl: () => config.env === 'production' ? 'https://api.prod' : 'https://api.dev'
        }),
        inject: [ConfigToken]
      });

      const api = container.resolve(ApiToken);
      expect(api.getUrl()).toBe('https://api.prod');
    });

    it('should handle async factory providers', async () => {
      const DbToken = createToken<{ query: (sql: string) => Promise<any> }>('Database');

      container.register(DbToken, {
        useFactory: async () => {
          await delay(10); // Simulate async connection
          return {
            query: async (sql: string) => ({ sql, result: 'mock' })
          };
        }
      });

      const db = await container.resolveAsync(DbToken);
      const result = await db.query('SELECT * FROM users');
      expect(result).toEqual({ sql: 'SELECT * FROM users', result: 'mock' });
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should call OnInit when service is created', async () => {
      const onInitSpy = jest.fn();

      @Injectable()
      class ServiceWithInit implements OnInit {
        async onInit(): Promise<void> {
          onInitSpy();
        }
      }

      container.register(ServiceWithInit, { useClass: ServiceWithInit });
      const service = container.resolve(ServiceWithInit);

      // Initialize the service
      await container.initialize();

      expect(onInitSpy).toHaveBeenCalled();
    });

    it('should call OnDestroy when container is disposed', async () => {
      const onDestroySpy = jest.fn();

      @Injectable()
      class ServiceWithDestroy implements OnDestroy {
        async onDestroy(): Promise<void> {
          onDestroySpy();
        }
      }

      container.register(ServiceWithDestroy, { useClass: ServiceWithDestroy, scope: Scope.Singleton });
      const service = container.resolve(ServiceWithDestroy);

      await container.dispose();

      expect(onDestroySpy).toHaveBeenCalled();
    });

    it('should handle initialization order based on dependencies', async () => {
      const initOrder: string[] = [];

      const AToken = createToken<any>('A');
      const BToken = createToken<any>('B');

      @Injectable()
      class A implements OnInit {
        async onInit() {
          initOrder.push('A');
        }
      }

      @Injectable()
      class B implements OnInit {
        constructor(@Inject(AToken) private a: any) { }

        async onInit() {
          initOrder.push('B');
        }
      }

      container.register(AToken, { useClass: A });
      container.register(BToken, { useClass: B });

      container.resolve(BToken);
      await container.initialize();

      expect(initOrder).toEqual(['A', 'B']);
    });
  });

  describe('Module System Integration', () => {
    it('should handle module dependencies correctly', async () => {
      // Create a custom module with dependencies
      class DatabaseModule extends EnhancedApplicationModule {
        constructor() {
          super({
            name: 'database',
            version: '1.0.0',
            dependencies: [CONFIG_SERVICE_TOKEN],
            providers: [
              ['DB_CONNECTION', {
                useFactory: (config: ConfigModule) => ({
                  host: config.get('db.host', 'localhost'),
                  port: config.get('db.port', 5432)
                }),
                inject: [CONFIG_SERVICE_TOKEN]
              }]
            ],
            exports: ['DB_CONNECTION']
          });
        }
      }

      const app = await TitanApplication.create({
        name: 'TestApp',
        config: {
          db: {
            host: 'test-db',
            port: 3306
          }
        },
        modules: [DatabaseModule]
      });

      await app.start();

      const dbConnection = app.get('DB_CONNECTION');
      expect(dbConnection).toEqual({
        host: 'test-db',
        port: 3306
      });

      await app.stop();
    });

    it('should handle async module initialization', async () => {
      const initOrder: string[] = [];

      class AsyncModule1 extends EnhancedApplicationModule {
        constructor() {
          super({
            name: 'async1',
            version: '1.0.0'
          });
        }

        protected async onModuleStart() {
          await delay(20);
          initOrder.push('async1');
        }
      }

      class AsyncModule2 extends EnhancedApplicationModule {
        constructor() {
          super({
            name: 'async2',
            version: '1.0.0',
            dependencies: ['async1']  // Use string dependency
          });
        }

        protected async onModuleStart() {
          await delay(10);
          initOrder.push('async2');
        }
      }

      const app = await TitanApplication.create({
        name: 'TestApp',
        modules: [AsyncModule2, AsyncModule1] // Order shouldn't matter
      });

      await app.start();

      // async1 should initialize before async2 due to dependency
      expect(initOrder).toEqual(['async1', 'async2']);

      await app.stop();
    });
  });

  describe('Error Handling', () => {
    it('should provide clear error messages for missing dependencies', () => {
      const MissingToken = createToken<any>('Missing');

      @Injectable()
      class ServiceWithMissingDep {
        constructor(@Inject(MissingToken) private missing: any) { }
      }

      container.register(ServiceWithMissingDep, { useClass: ServiceWithMissingDep });

      // ResolutionError is thrown with detailed error message
      expect(() => container.resolve(ServiceWithMissingDep))
        .toThrow(/Failed to resolve|Token not registered/);
    });

    it('should handle errors in factory providers gracefully', () => {
      const ErrorToken = createToken<any>('Error');

      container.register(ErrorToken, {
        useFactory: () => {
          throw new Error('Factory error');
        }
      });

      expect(() => container.resolve(ErrorToken))
        .toThrow('Factory error');
    });

    it('should handle errors in OnInit gracefully', async () => {
      @Injectable()
      class ServiceWithFailingInit implements OnInit {
        async onInit() {
          throw new Error('Init failed');
        }
      }

      container.register(ServiceWithFailingInit, { useClass: ServiceWithFailingInit });
      container.resolve(ServiceWithFailingInit);

      await expect(container.initialize())
        .rejects.toThrow('Init failed');
    });
  });

  describe('Performance and Memory', () => {
    it('should handle large number of dependencies efficiently', () => {
      const startTime = Date.now();
      const tokens: any[] = [];

      // Register 1000 services
      for (let i = 0; i < 1000; i++) {
        const token = createToken(`Service${i}`);
        tokens.push(token);
        container.register(token, { useValue: `value${i}` });
      }

      // Resolve all services
      for (const token of tokens) {
        container.resolve(token);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete within reasonable time (< 1 second)
      expect(duration).toBeLessThan(1000);
    });

    it('should properly dispose and free memory', async () => {
      const disposeSpy = jest.fn();

      @Injectable()
      class DisposableService implements OnDestroy {
        private largeData = new Array(1000).fill('data');

        async onDestroy() {
          disposeSpy();
          // Clear large data
          this.largeData = [];
        }
      }

      // Create multiple instances
      for (let i = 0; i < 100; i++) {
        const token = createToken(`Disposable${i}`);
        container.register(token, { useClass: DisposableService, scope: Scope.Singleton });
        container.resolve(token);
      }

      await container.dispose();

      expect(disposeSpy).toHaveBeenCalledTimes(100);
    });
  });

  describe('Advanced Patterns', () => {
    it('should support decorator composition', () => {
      const metadata: string[] = [];

      function TestDecorator1() {
        return function (target: any) {
          metadata.push('TestDecorator1');
        };
      }

      function TestDecorator2() {
        return function (target: any) {
          metadata.push('TestDecorator2');
        };
      }

      @Singleton()
      @Service('ComposedService')
      @TestDecorator1()
      @TestDecorator2()
      class ComposedService {
        public value = 'composed';
      }

      expect(metadata).toContain('TestDecorator1');
      expect(metadata).toContain('TestDecorator2');

      const serviceMetadata = Reflect.getMetadata('nexus:injectable', ComposedService);
      expect(serviceMetadata).toBe(true);

      const scopeMetadata = Reflect.getMetadata('nexus:scope', ComposedService);
      expect(scopeMetadata).toBe('singleton');
    });

    it('should support conditional provider registration', () => {
      const isProd = false;

      const ApiToken = createToken<{ url: string }>('Api');

      if (isProd) {
        container.register(ApiToken, { useValue: { url: 'https://api.prod' } });
      } else {
        container.register(ApiToken, { useValue: { url: 'https://api.dev' } });
      }

      const api = container.resolve(ApiToken);
      expect(api.url).toBe('https://api.dev');
    });

    it('should support multi-injection of services', () => {
      const PluginToken = createToken<{ name: string }>('Plugin');

      // Register multiple providers for the same token with multi option
      container.register(PluginToken, { useValue: { name: 'Plugin1' } }, { multi: true });
      container.register(PluginToken, { useValue: { name: 'Plugin2' } }, { multi: true });
      container.register(PluginToken, { useValue: { name: 'Plugin3' } }, { multi: true });

      // Resolve all instances
      const plugins = container.resolveAll(PluginToken);
      expect(plugins).toHaveLength(3);
      expect(plugins[0].name).toBe('Plugin1');
      expect(plugins[1].name).toBe('Plugin2');
      expect(plugins[2].name).toBe('Plugin3');
    });
  });
});
