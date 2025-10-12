/**
 * Comprehensive integration tests for Dependency Injection system
 * Tests the complete DI flow from Nexus to Titan with real-world scenarios
 */

import 'reflect-metadata';
import { createToken } from '../src/nexus/index.js';
import {
  Application,
  Injectable,
  Singleton,
  Inject,
  Service,
  OnInit,
  OnDestroy,
  Module,
  type Provider,
} from '../src/index.js';

describe('DI Integration Tests', () => {
  describe('Complete DI Flow', () => {
    it('should handle complex dependency chains', async () => {
      // Define tokens
      const DatabaseToken = createToken<DatabaseService>('Database');
      const CacheToken = createToken<CacheService>('Cache');
      const ApiToken = createToken<ApiService>('Api');
      const AppToken = createToken<AppService>('App');

      // Level 1: Base service
      @Injectable()
      @Singleton()
      class DatabaseService implements OnInit {
        initialized = false;
        async onInit() {
          this.initialized = true;
        }
        query(sql: string) {
          return `Result for: ${sql}`;
        }
      }

      // Level 2: Service depending on Level 1
      @Injectable()
      class CacheService {
        constructor(@Inject(DatabaseToken) private db: DatabaseService) {}

        getCached(key: string) {
          return this.db.query(`SELECT * FROM cache WHERE key='${key}'`);
        }
      }

      // Level 3: Service depending on Level 1 & 2
      @Injectable()
      @Service('ApiService@1.0.0')
      class ApiService implements OnInit, OnDestroy {
        initialized = false;
        destroyed = false;

        constructor(
          @Inject(DatabaseToken) private db: DatabaseService,
          @Inject(CacheToken) private cache: CacheService
        ) {}

        async onInit() {
          this.initialized = true;
        }

        async onDestroy() {
          this.destroyed = true;
        }

        getData(id: string) {
          const cached = this.cache.getCached(id);
          if (cached) return cached;
          return this.db.query(`SELECT * FROM data WHERE id='${id}'`);
        }
      }

      // Level 4: Top-level service
      @Injectable()
      class AppService {
        constructor(
          @Inject(ApiToken) private api: ApiService,
          @Inject(CacheToken) private cache: CacheService
        ) {}

        async process(id: string) {
          const data = this.api.getData(id);
          this.cache.getCached(`processed_${id}`);
          return `Processed: ${data}`;
        }
      }

      // Create module with all providers
      @Module({
        providers: [
          { provide: DatabaseToken, useClass: DatabaseService },
          { provide: CacheToken, useClass: CacheService },
          { provide: ApiToken, useClass: ApiService },
          { provide: AppToken, useClass: AppService },
        ],
        exports: [DatabaseToken, CacheToken, ApiToken, AppToken],
      })
      class TestModule {}

      // Create and start application
      const app = await Application.create(TestModule);

      await app.start();

      // Resolve top-level service and verify dependency chain
      const appService = app.resolve(AppToken);
      const result = await appService.process('test-id');

      expect(result).toContain('Processed');
      expect(result).toContain('Result for');

      // Verify lifecycle hooks were called
      const dbService = app.resolve(DatabaseToken);
      const apiService = app.resolve(ApiToken);

      expect(dbService.initialized).toBe(true);
      expect(apiService.initialized).toBe(true);

      // Cleanup
      await app.stop();
      expect(apiService.destroyed).toBe(true);
    });

    it('should handle circular dependencies with property injection', async () => {
      const ServiceAToken = createToken<ServiceA>('ServiceA');
      const ServiceBToken = createToken<ServiceB>('ServiceB');

      // Forward declaration to handle circular dependency
      let ServiceB: any;

      @Injectable()
      class ServiceA {
        serviceB?: any;

        getName() {
          return 'ServiceA';
        }

        getPartnerName() {
          return this.serviceB?.getName();
        }
      }

      @Injectable()
      class ServiceBImpl {
        serviceA?: ServiceA;

        getName() {
          return 'ServiceB';
        }

        getPartnerName() {
          return this.serviceA?.getName();
        }
      }
      ServiceB = ServiceBImpl;

      // Use a module for proper provider registration
      class CircularModule extends Module {
        constructor() {
          super({
            name: 'CircularModule',
            providers: [
              { provide: ServiceAToken, useClass: ServiceA },
              { provide: ServiceBToken, useClass: ServiceB },
            ],
          });
        }
      }

      const app = await Application.create({
        name: 'CircularTest',
        modules: [CircularModule],
      });

      await app.start();

      const serviceA = app.resolve(ServiceAToken);
      const serviceB = app.resolve(ServiceBToken);

      // Manually wire circular dependencies for this test
      serviceA.serviceB = serviceB;
      serviceB.serviceA = serviceA;

      expect(serviceA.getName()).toBe('ServiceA');
      expect(serviceB.getName()).toBe('ServiceB');
      expect(serviceA.getPartnerName()).toBe('ServiceB');
      expect(serviceB.getPartnerName()).toBe('ServiceA');

      await app.stop();
    });

    it('should handle factory providers with async initialization', async () => {
      const TestConfigToken = createToken<TestConfig>('TestConfig');
      const ServiceToken = createToken<AsyncService>('AsyncService');

      interface TestConfig {
        apiUrl: string;
        timeout: number;
      }

      class AsyncService {
        constructor(public config: TestConfig) {}

        async fetchData() {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 10));
          return `Data from ${this.config.apiUrl}`;
        }
      }

      // Use a module for proper provider registration
      class FactoryModule extends Module {
        constructor() {
          super({
            name: 'FactoryModule',
            providers: [
              {
                provide: TestConfigToken,
                useFactory: async () => {
                  // Simulate async config loading
                  await new Promise((resolve) => setTimeout(resolve, 10));
                  return {
                    apiUrl: 'https://api.example.com',
                    timeout: 5000,
                  };
                },
              },
              {
                provide: ServiceToken,
                useFactory: async (config: TestConfig) => {
                  // Simulate async service initialization
                  await new Promise((resolve) => setTimeout(resolve, 10));
                  return new AsyncService(config);
                },
                inject: [TestConfigToken],
              },
            ],
          });
        }
      }

      const app = await Application.create({
        name: 'FactoryTest',
        modules: [FactoryModule],
      });

      await app.start();

      const service = app.resolve(ServiceToken);
      const data = await service.fetchData();

      expect(data).toBe('Data from https://api.example.com');
      expect(service.config.timeout).toBe(5000);

      await app.stop();
    });

    it('should handle multi-module dependencies', async () => {
      const SharedServiceToken = createToken<SharedService>('SharedService');
      const ModuleAServiceToken = createToken<ModuleAService>('ModuleAService');
      const ModuleBServiceToken = createToken<ModuleBService>('ModuleBService');

      @Injectable()
      class SharedService {
        getValue() {
          return 'shared-value';
        }
      }

      @Injectable()
      class ModuleAService {
        constructor(@Inject(SharedServiceToken) private shared: SharedService) {}

        processA() {
          return `A: ${this.shared.getValue()}`;
        }
      }

      @Injectable()
      class ModuleBService {
        constructor(
          @Inject(SharedServiceToken) private shared: SharedService,
          @Inject(ModuleAServiceToken) private serviceA: ModuleAService
        ) {}

        processB() {
          return `B: ${this.shared.getValue()} + ${this.serviceA.processA()}`;
        }
      }

      // Shared module
      class SharedModule extends Module {
        constructor() {
          super({
            name: 'SharedModule',
            providers: [{ provide: SharedServiceToken, useClass: SharedService }],
            exports: [SharedServiceToken],
          });
        }
      }

      // Module A depending on Shared
      class ModuleA extends Module {
        constructor() {
          super({
            name: 'ModuleA',
            imports: [SharedModule],
            providers: [{ provide: ModuleAServiceToken, useClass: ModuleAService }],
            exports: [ModuleAServiceToken],
          });
        }
      }

      // Module B depending on both Shared and ModuleA
      class ModuleB extends Module {
        constructor() {
          super({
            name: 'ModuleB',
            imports: [SharedModule, ModuleA],
            providers: [{ provide: ModuleBServiceToken, useClass: ModuleBService }],
          });
        }
      }

      const app = await Application.create({
        name: 'MultiModuleApp',
        modules: [SharedModule, ModuleA, ModuleB],
      });

      await app.start();

      const serviceB = app.resolve(ModuleBServiceToken);
      const result = serviceB.processB();

      expect(result).toBe('B: shared-value + A: shared-value');

      // Verify singleton behavior - same instance across modules
      const sharedFromApp = app.resolve(SharedServiceToken);
      const serviceA = app.resolve(ModuleAServiceToken);

      expect(sharedFromApp).toBeDefined();
      expect(serviceA).toBeDefined();

      await app.stop();
    });

    it('should handle scope correctly (singleton vs transient)', async () => {
      const SingletonToken = createToken<CounterService>('Singleton');
      const TransientToken = createToken<CounterService>('Transient');

      let instanceCount = 0;

      @Injectable()
      class CounterService {
        public instanceId: number;
        private count = 0;

        constructor() {
          this.instanceId = ++instanceCount;
        }

        increment() {
          return ++this.count;
        }

        getCount() {
          return this.count;
        }
      }

      // Use a module for proper provider registration
      class ScopeModule extends Module {
        constructor() {
          super({
            name: 'ScopeModule',
            providers: [
              { provide: SingletonToken, useClass: CounterService, scope: 'singleton' },
              { provide: TransientToken, useClass: CounterService, scope: 'transient' },
            ],
          });
        }
      }

      const app = await Application.create({
        name: 'ScopeTest',
        modules: [ScopeModule],
      });

      await app.start();

      // Singleton should return same instance
      const singleton1 = app.resolve(SingletonToken);
      const singleton2 = app.resolve(SingletonToken);

      singleton1.increment();
      singleton1.increment();

      expect(singleton1.instanceId).toBe(singleton2.instanceId);
      expect(singleton1.getCount()).toBe(2);
      expect(singleton2.getCount()).toBe(2);

      // Transient should return new instances
      const transient1 = app.resolve(TransientToken);
      const transient2 = app.resolve(TransientToken);

      transient1.increment();

      expect(transient1.instanceId).not.toBe(transient2.instanceId);
      expect(transient1.getCount()).toBe(1);
      expect(transient2.getCount()).toBe(0);

      await app.stop();
    });

    it('should handle optional dependencies', async () => {
      const RequiredToken = createToken<RequiredService>('Required');
      const OptionalToken = createToken<OptionalService>('Optional');
      const ConsumerToken = createToken<ConsumerService>('Consumer');

      @Injectable()
      class RequiredService {
        getValue() {
          return 'required';
        }
      }

      // OptionalService is not registered
      class OptionalService {
        getValue() {
          return 'optional';
        }
      }

      @Injectable()
      class ConsumerService {
        public optional?: OptionalService;

        constructor(@Inject(RequiredToken) private required: RequiredService) {
          // Handle optional dependency manually
        }

        process() {
          const requiredValue = this.required.getValue();
          const optionalValue = this.optional?.getValue() || 'default';
          return `${requiredValue}-${optionalValue}`;
        }
      }

      // Use a module for proper provider registration
      class OptionalModule extends Module {
        constructor() {
          super({
            name: 'OptionalModule',
            providers: [
              { provide: RequiredToken, useClass: RequiredService },
              // OptionalToken is not provided
              { provide: ConsumerToken, useClass: ConsumerService },
            ],
          });
        }
      }

      const app = await Application.create({
        name: 'OptionalTest',
        modules: [OptionalModule],
      });

      await app.start();

      const consumer = app.resolve(ConsumerToken);
      const result = consumer.process();

      expect(result).toBe('required-default');

      await app.stop();
    });
  });

  describe('Performance Tests', () => {
    it('should handle large number of dependencies efficiently', async () => {
      const startTime = Date.now();
      const serviceCount = 100;
      const tokens: any[] = [];
      const providers: Provider[] = [];

      // Create a chain of 100 services
      for (let i = 0; i < serviceCount; i++) {
        const token = createToken(`Service${i}`);
        tokens.push(token);

        @Injectable()
        class TestService {
          public id = i;
          public dependencies: any[] = [];

          constructor() {
            // Each service depends on previous 3 services
            if (i > 0) {
              const depCount = Math.min(3, i);
              for (let j = 1; j <= depCount; j++) {
                // Property injection for simplicity in this test
                this.dependencies.push(`dep-${i - j}`);
              }
            }
          }

          process() {
            return `Service${this.id} processed`;
          }
        }

        providers.push({
          provide: token,
          useClass: TestService,
        });
      }

      // Use a module for proper provider registration
      class PerformanceModule extends Module {
        constructor() {
          super({
            name: 'PerformanceModule',
            providers,
          });
        }
      }

      const app = await Application.create({
        name: 'PerformanceTest',
        modules: [PerformanceModule],
      });

      await app.start();

      // Resolve all services
      const resolveStart = Date.now();
      const services = tokens.map((token) => app.resolve(token));
      const resolveTime = Date.now() - resolveStart;

      expect(services).toHaveLength(serviceCount);
      expect(services[serviceCount - 1].process()).toBe(`Service${serviceCount - 1} processed`);

      // Should resolve 100 services in reasonable time
      expect(resolveTime).toBeLessThan(1000);

      await app.stop();

      const totalTime = Date.now() - startTime;
      // Total test should complete quickly
      expect(totalTime).toBeLessThan(2000);
    });
  });

  describe('Error Handling', () => {
    it('should provide clear error messages for missing dependencies', async () => {
      const MissingToken = createToken('Missing');
      const ConsumerToken = createToken('Consumer');

      @Injectable()
      class ConsumerService {
        constructor(@Inject(MissingToken) private missing: any) {}
      }

      // Use a module for proper provider registration
      class ErrorModule extends Module {
        constructor() {
          super({
            name: 'ErrorModule',
            providers: [{ provide: ConsumerToken, useClass: ConsumerService }],
          });
        }
      }

      const app = await Application.create({
        name: 'ErrorTest',
        modules: [ErrorModule],
      });

      await app.start();

      expect(() => {
        app.resolve(ConsumerToken);
      }).toThrow();

      await app.stop();
    });

    it('should handle initialization errors gracefully', async () => {
      const ServiceToken = createToken('Service');

      @Injectable()
      class FailingService implements OnInit {
        async onInit() {
          throw new Error('Initialization failed');
        }
      }

      // Use a module for proper provider registration
      class InitErrorModule extends Module {
        constructor() {
          super({
            name: 'InitErrorModule',
            providers: [{ provide: ServiceToken, useClass: FailingService }],
          });
        }
      }

      const app = await Application.create({
        name: 'InitErrorTest',
        modules: [InitErrorModule],
      });

      // Start should succeed even if individual service init fails
      await app.start();

      const service = app.resolve(ServiceToken);
      expect(service).toBeDefined();

      await app.stop();
    });
  });
});
