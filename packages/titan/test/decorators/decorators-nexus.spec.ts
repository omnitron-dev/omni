/**
 * Decorator Support Tests
 * Tests for optional decorator-based dependency injection
 * Note: These tests require reflect-metadata to be installed
 */

import 'reflect-metadata'; // Required for decorator support
import {
  Container,
  createToken
} from '../../src/nexus/index.js';
import {
  Injectable,
  Inject,
  Optional,
  Module,
  Service,
  Singleton,
  Transient,
  Scoped,
  Factory,
  Value,
  InjectAll,
  PostConstruct,
  PreDestroy,
  Lazy,
} from '../../src/decorators/index.js';

describe('Decorator Support', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('@Injectable Decorator', () => {
    it('should mark class as injectable', () => {
      @Injectable()
      class TestService {
        getValue() {
          return 'test-value';
        }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, { useClass: TestService });

      const service = container.resolve(token);
      expect(service.getValue()).toBe('test-value');
    });

    it('should handle constructor injection', () => {
      const depToken = createToken<string>('Dependency');

      @Injectable()
      class ServiceWithDep {
        constructor(@Inject(depToken) public dep: string) { }
      }

      container.register(depToken, { useValue: 'injected-value' });

      const token = createToken<ServiceWithDep>('ServiceWithDep');
      container.register(token, { useClass: ServiceWithDep });

      const service = container.resolve(token);
      expect(service.dep).toBe('injected-value');
    });

    it('should handle multiple injections', () => {
      const token1 = createToken<string>('Dep1');
      const token2 = createToken<number>('Dep2');
      const token3 = createToken<boolean>('Dep3');

      @Injectable()
      class MultiDepService {
        constructor(
          @Inject(token1) public dep1: string,
          @Inject(token2) public dep2: number,
          @Inject(token3) public dep3: boolean
        ) { }
      }

      container.register(token1, { useValue: 'string' });
      container.register(token2, { useValue: 42 });
      container.register(token3, { useValue: true });

      const serviceToken = createToken<MultiDepService>('MultiDepService');
      container.register(serviceToken, { useClass: MultiDepService });

      const service = container.resolve(serviceToken);
      expect(service.dep1).toBe('string');
      expect(service.dep2).toBe(42);
      expect(service.dep3).toBe(true);
    });
  });

  describe('@Optional Decorator', () => {
    it('should handle optional dependencies', () => {
      const requiredToken = createToken<string>('Required');
      const optionalToken = createToken<string>('Optional');

      @Injectable()
      class ServiceWithOptional {
        constructor(
          @Inject(requiredToken) public required: string,
          @Optional() @Inject(optionalToken) public optional?: string
        ) { }
      }

      container.register(requiredToken, { useValue: 'required' });
      // Don't register optional

      const token = createToken<ServiceWithOptional>('ServiceWithOptional');
      container.register(token, { useClass: ServiceWithOptional });

      const service = container.resolve(token);
      expect(service.required).toBe('required');
      expect(service.optional).toBeUndefined();
    });

    it('should inject optional dependency when available', () => {
      const optionalToken = createToken<string>('Optional');

      @Injectable()
      class ServiceWithOptional {
        constructor(
          @Optional() @Inject(optionalToken) public optional?: string
        ) { }
      }

      container.register(optionalToken, { useValue: 'optional-value' });

      const token = createToken<ServiceWithOptional>('ServiceWithOptional');
      container.register(token, { useClass: ServiceWithOptional });

      const service = container.resolve(token);
      expect(service.optional).toBe('optional-value');
    });
  });

  describe('Scope Decorators', () => {
    it('should apply @Singleton scope', () => {
      let instanceCount = 0;

      @Singleton()
      class SingletonService {
        instanceId = ++instanceCount;
      }

      const token = createToken<SingletonService>('SingletonService');
      container.register(token, { useClass: SingletonService });

      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);

      expect(instance1.instanceId).toBe(1);
      expect(instance2.instanceId).toBe(1);
      expect(instance1).toBe(instance2);
    });

    it('should apply @Transient scope', () => {
      let instanceCount = 0;

      @Transient()
      class TransientService {
        instanceId = ++instanceCount;
      }

      const token = createToken<TransientService>('TransientService');
      container.register(token, { useClass: TransientService });

      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);

      expect(instance1.instanceId).toBe(1);
      expect(instance2.instanceId).toBe(2);
      expect(instance1).not.toBe(instance2);
    });

    it('should apply @Scoped scope', () => {
      let instanceCount = 0;

      @Scoped()
      class ScopedService {
        instanceId = ++instanceCount;
      }

      const token = createToken<ScopedService>('ScopedService');
      container.register(token, { useClass: ScopedService });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const instance1 = scope1.resolve(token);
      const instance2 = scope1.resolve(token);
      const instance3 = scope2.resolve(token);

      expect(instance1.instanceId).toBe(1);
      expect(instance2.instanceId).toBe(1);
      expect(instance3.instanceId).toBe(2);
    });
  });

  describe('@Service Decorator', () => {
    it('should auto-register service with name', () => {
      @Service('UserService')
      class UserService {
        getUser() {
          return { id: 1, name: 'John' };
        }
      }

      container.autoRegister(UserService);

      const token = createToken<UserService>('UserService');
      const service = container.resolve(token);

      expect(service.getUser()).toEqual({ id: 1, name: 'John' });
    });

    it('should handle service with dependencies', () => {
      const dbToken = createToken<{ query: () => string }>('Database');

      @Service('UserRepository')
      class UserRepository {
        constructor(@Inject(dbToken) private db: any) { }

        findAll() {
          return this.db.query();
        }
      }

      container.register(dbToken, {
        useValue: { query: () => 'users-from-db' }
      });
      container.autoRegister(UserRepository);

      const token = createToken<UserRepository>('UserRepository');
      const repo = container.resolve(token);

      expect(repo.findAll()).toBe('users-from-db');
    });
  });

  describe('@InjectAll Decorator', () => {
    it('should inject all services for multi-token', () => {
      const handlerToken = createToken<{ handle: () => string }>('Handler');

      @Injectable()
      class HandlerA {
        handle() { return 'A'; }
      }

      @Injectable()
      class HandlerB {
        handle() { return 'B'; }
      }

      @Injectable()
      class HandlerC {
        handle() { return 'C'; }
      }

      @Injectable()
      class HandlerManager {
        constructor(
          @InjectAll(handlerToken) public handlers: Array<{ handle: () => string }>
        ) { }

        handleAll() {
          return this.handlers.map(h => h.handle()).join(',');
        }
      }

      container.register(handlerToken, { useClass: HandlerA }, { multi: true });
      container.register(handlerToken, { useClass: HandlerB }, { multi: true });
      container.register(handlerToken, { useClass: HandlerC }, { multi: true });

      const managerToken = createToken<HandlerManager>('HandlerManager');
      container.register(managerToken, { useClass: HandlerManager });

      const manager = container.resolve(managerToken);
      expect(manager.handleAll()).toBe('A,B,C');
    });
  });

  describe('Lifecycle Decorators', () => {
    it('should call @PostConstruct after creation', async () => {
      const initCalled = jest.fn();

      @Injectable()
      class ServiceWithInit {
        initialized = false;

        @PostConstruct()
        async init() {
          this.initialized = true;
          initCalled();
        }
      }

      const token = createToken<ServiceWithInit>('ServiceWithInit');
      container.register(token, { useClass: ServiceWithInit });

      const service = container.resolve(token);
      await container.initialize();

      expect(service.initialized).toBe(true);
      expect(initCalled).toHaveBeenCalled();
    });

    it('should call @PreDestroy before disposal', async () => {
      const destroyCalled = jest.fn();

      @Singleton()
      class ServiceWithDestroy {
        @PreDestroy()
        async cleanup() {
          destroyCalled();
        }
      }

      const token = createToken<ServiceWithDestroy>('ServiceWithDestroy');
      container.register(token, { useClass: ServiceWithDestroy });

      container.resolve(token);
      await container.dispose();

      expect(destroyCalled).toHaveBeenCalled();
    });

    it('should handle multiple lifecycle methods', async () => {
      const callOrder: string[] = [];

      @Singleton()
      class ComplexService {
        @PostConstruct()
        async init1() {
          callOrder.push('init1');
        }

        @PostConstruct()
        async init2() {
          callOrder.push('init2');
        }

        @PreDestroy()
        async cleanup1() {
          callOrder.push('cleanup1');
        }

        @PreDestroy()
        async cleanup2() {
          callOrder.push('cleanup2');
        }
      }

      const token = createToken<ComplexService>('ComplexService');
      container.register(token, { useClass: ComplexService });

      container.resolve(token);
      await container.initialize();

      expect(callOrder).toEqual(['init1', 'init2']);

      await container.dispose();

      expect(callOrder).toEqual(['init1', 'init2', 'cleanup1', 'cleanup2']);
    });
  });

  describe('@Factory Decorator', () => {
    it('should register factory method', () => {
      @Injectable()
      class FactoryClass {
        @Factory('ConfigFactory')
        createConfig() {
          return { apiUrl: 'https://api.example.com' };
        }

        @Factory('LoggerFactory')
        createLogger(prefix: string) {
          return {
            log: (msg: string) => `[${prefix}] ${msg}`
          };
        }
      }

      const factory = new FactoryClass();
      container.registerFactory('ConfigFactory', factory.createConfig.bind(factory));
      container.registerFactory('LoggerFactory', factory.createLogger.bind(factory));

      const configToken = createToken<{ apiUrl: string }>('Config');
      const loggerToken = createToken<{ log: (msg: string) => string }>('Logger');

      container.register(configToken, {
        useFactory: () => container.resolveFactory('ConfigFactory')
      });

      container.register(loggerToken, {
        useFactory: () => container.resolveFactory('LoggerFactory', 'APP')
      });

      const config = container.resolve(configToken);
      const logger = container.resolve(loggerToken);

      expect(config.apiUrl).toBe('https://api.example.com');
      expect(logger.log('test')).toBe('[APP] test');
    });
  });

  describe('@Value Decorator', () => {
    it('should inject configuration values', () => {
      // Set configuration
      container.setConfig({
        app: {
          name: 'TestApp',
          version: '1.0.0',
          port: 3000
        },
        database: {
          host: 'localhost',
          port: 5432
        }
      });

      @Injectable()
      class ConfigurableService {
        constructor(
          @Value('app.name') public appName: string,
          @Value('app.port') public appPort: number,
          @Value('database.host') public dbHost: string
        ) { }
      }

      const token = createToken<ConfigurableService>('ConfigurableService');
      container.register(token, { useClass: ConfigurableService });

      const service = container.resolve(token);

      expect(service.appName).toBe('TestApp');
      expect(service.appPort).toBe(3000);
      expect(service.dbHost).toBe('localhost');
    });

    it('should handle default values', () => {
      container.setConfig({
        app: { name: 'TestApp' }
      });

      @Injectable()
      class ServiceWithDefaults {
        constructor(
          @Value('app.name') public appName: string,
          @Value('app.description', 'No description') public description: string,
          @Value('app.port', 3000) public port: number
        ) { }
      }

      const token = createToken<ServiceWithDefaults>('ServiceWithDefaults');
      container.register(token, { useClass: ServiceWithDefaults });

      const service = container.resolve(token);

      expect(service.appName).toBe('TestApp');
      expect(service.description).toBe('No description');
      expect(service.port).toBe(3000);
    });
  });

  describe('@Module Decorator', () => {
    it('should create module with decorator', () => {
      const serviceToken = createToken<{ name: string }>('Service');

      @Module({
        name: 'TestModule',
        providers: [
          {
            provide: serviceToken,
            useValue: { name: 'test-service' }
          }
        ],
        exports: [serviceToken]
      })
      class TestModule { }

      const module = TestModule.getModule();
      container.loadModule(module);

      const service = container.resolve(serviceToken);
      expect(service.name).toBe('test-service');
    });

    it('should handle module with imports', () => {
      const sharedToken = createToken<string>('Shared');

      @Module({
        name: 'SharedModule',
        providers: [
          {
            provide: sharedToken,
            useValue: 'shared-value'
          }
        ],
        exports: [sharedToken]
      })
      class SharedModule { }

      @Module({
        name: 'AppModule',
        imports: [SharedModule],
        providers: []
      })
      class AppModule { }

      const module = AppModule.getModule();
      container.loadModule(module);

      const shared = container.resolve(sharedToken);
      expect(shared).toBe('shared-value');
    });
  });

  describe('Property Injection', () => {
    it('should inject into properties', () => {
      const loggerToken = createToken<{ log: (msg: string) => void }>('Logger');
      const configToken = createToken<{ apiUrl: string }>('Config');

      @Injectable()
      class ServiceWithPropertyInjection {
        @Inject(loggerToken)
        logger!: { log: (msg: string) => void };

        @Inject(configToken)
        config!: { apiUrl: string };

        doSomething() {
          this.logger.log(`Using API: ${this.config.apiUrl}`);
        }
      }

      const logged: string[] = [];
      container.register(loggerToken, {
        useValue: { log: (msg: string) => logged.push(msg) }
      });
      container.register(configToken, {
        useValue: { apiUrl: 'https://api.example.com' }
      });

      const token = createToken<ServiceWithPropertyInjection>('Service');
      container.register(token, { useClass: ServiceWithPropertyInjection });

      const service = container.resolve(token);
      service.doSomething();

      expect(logged).toContain('Using API: https://api.example.com');
    });
  });

  describe('Circular Dependency Handling', () => {
    it('should handle circular dependencies with @Lazy', () => {
      const tokenA = createToken<any>('ServiceA');
      const tokenB = createToken<any>('ServiceB');

      @Injectable()
      class ServiceA {
        constructor(@Lazy(() => tokenB) private getB: () => any) { }

        callB() {
          return this.getB().getName();
        }
      }

      @Injectable()
      class ServiceB {
        constructor(@Lazy(() => tokenA) private getA: () => any) { }

        getName() {
          return 'ServiceB';
        }
      }

      container.register(tokenA, { useClass: ServiceA });
      container.register(tokenB, { useClass: ServiceB });

      const serviceA = container.resolve(tokenA);
      expect(serviceA.callB()).toBe('ServiceB');
    });
  });
});