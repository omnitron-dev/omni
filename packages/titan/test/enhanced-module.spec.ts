/**
 * Tests for Enhanced Module System
 */

import { Container, createToken } from '@omnitron-dev/nexus';
import {
  EnhancedApplicationModule,
  Module,
  createModuleWithProviders
} from '../src/enhanced-module';
import {
  IApplication,
  ApplicationState,
  Provider,
  HealthStatus
} from '../src/types';

// Mock implementations
class MockLogger {
  info = jest.fn();
  debug = jest.fn();
  error = jest.fn();
  child = jest.fn(() => this);
}

class MockConfigModule {
  get = jest.fn((path: string, defaultValue?: any) => defaultValue);
}

// Test services
interface TestService {
  onInit?(): Promise<void>;
  onDestroy?(): Promise<void>;
  health?(): Promise<HealthStatus>;
  doWork(): string;
}

class TestServiceImpl implements TestService {
  initialized = false;
  destroyed = false;

  async onInit(): Promise<void> {
    this.initialized = true;
  }

  async onDestroy(): Promise<void> {
    this.destroyed = true;
  }

  async health(): Promise<HealthStatus> {
    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      message: 'Test service health'
    };
  }

  doWork(): string {
    return 'work done';
  }
}

// Tokens
const TestServiceToken = createToken<TestService>('TestService');
const DependentServiceToken = createToken<DependentService>('DependentService');
const LoggerModuleToken = createToken<any>('LoggerModule');
const ConfigModuleToken = createToken<any>('ConfigModule');

// Dependent service
class DependentService {
  constructor(private testService: TestService) {}

  async onInit(): Promise<void> {
    // Should be called after TestService.onInit
  }

  useTestService(): string {
    return `Using: ${this.testService.doWork()}`;
  }
}

// Mock Application
class MockApplication implements IApplication {
  container = new Container();
  private modules = new Map<any, any>();
  private eventHandlers = new Map<string, Function[]>();
  state: ApplicationState = ApplicationState.Created;
  uptime = 0;
  environment = {} as any;
  metrics = {} as any;

  constructor() {
    // Register mock modules
    this.container.register(LoggerModuleToken, {
      useValue: new MockLogger()
    });
    this.container.register(ConfigModuleToken, {
      useValue: new MockConfigModule()
    });
  }

  async start(): Promise<void> {
    this.state = ApplicationState.Started;
  }

  async stop(): Promise<void> {
    this.state = ApplicationState.Stopped;
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  use<T>(module: T | any): this {
    this.modules.set(module, module);
    return this;
  }

  get<T>(token: any): T {
    return this.modules.get(token) || this.container.resolve(token);
  }

  has(token: any): boolean {
    return this.modules.has(token) || this.container.has(token);
  }

  replaceModule<T>(token: any, module: T): this {
    this.modules.set(token, module);
    return this;
  }

  configure<T = any>(config: T): this {
    return this;
  }

  config<K extends string>(key: K): any {
    return undefined;
  }

  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler?: Function): void {
    if (handler) {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    } else {
      this.eventHandlers.delete(event);
    }
  }

  once(event: string, handler: Function): void {
    const wrapper = (...args: any[]) => {
      handler(...args);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  onStart(hook: Function): this {
    return this;
  }

  onStop(hook: Function): this {
    return this;
  }

  onError(handler: Function): this {
    return this;
  }

  resolve<T>(token: any): T {
    return this.container.resolve(token);
  }

  async health(): Promise<HealthStatus> {
    return { status: 'healthy', message: 'App healthy' };
  }
}

describe('EnhancedApplicationModule', () => {
  let app: MockApplication;

  beforeEach(() => {
    app = new MockApplication();
    jest.clearAllMocks();
  });

  describe('Basic Module Creation', () => {
    it('should create module with metadata', () => {
      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({
            name: 'TestModule',
            version: '1.0.0'
          });
        }
      })();

      expect(module.name).toBe('TestModule');
      expect(module.version).toBe('1.0.0');
    });

    it('should use class name if no name provided', () => {
      class CustomModule extends EnhancedApplicationModule {
        constructor() {
          super({});
        }
      }

      const module = new CustomModule();
      expect(module.name).toBe('CustomModule');
    });
  });

  describe('Provider Registration', () => {
    it('should register class providers', async () => {
      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useClass: TestServiceImpl, scope: 'singleton' }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);

      // Provider should be registered in app container if exported
      expect(module['_providers']).toHaveLength(1);
      expect(module['_providers'][0]!.token).toBe(TestServiceToken);
    });

    it('should register value providers', async () => {
      const testValue = { test: 'value' };
      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useValue: testValue }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);

      expect(module['_providers']).toHaveLength(1);
      expect(module['_providers'][0]!.instance).toBe(testValue);
    });

    it('should register factory providers', async () => {
      const providers: Array<[any, Provider]> = [
        [TestServiceToken, {
          useFactory: () => new TestServiceImpl()
        }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);

      expect(module['_providers']).toHaveLength(1);
      expect(module['_providers'][0]!.instance).toBeInstanceOf(TestServiceImpl);
    });

    it('should inject dependencies into factory providers', async () => {
      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useClass: TestServiceImpl }],
        [DependentServiceToken, {
          useFactory: (testService: TestService) => new DependentService(testService),
          inject: [TestServiceToken]
        }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);

      const dependentService = module['_providers'].find(
        p => p.token === DependentServiceToken
      )?.instance as DependentService;

      expect(dependentService).toBeInstanceOf(DependentService);
      expect(dependentService.useTestService()).toBe('Using: work done');
    });
  });

  describe('Lifecycle Management', () => {
    it('should call onInit for all providers', async () => {
      const service1 = new TestServiceImpl();
      const service2 = new TestServiceImpl();

      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useValue: service1 }],
        [createToken('Service2'), { useValue: service2 }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);
      await module.onStart(app);

      expect(service1.initialized).toBe(true);
      expect(service2.initialized).toBe(true);
    });

    it('should call onDestroy in reverse order', async () => {
      const destroyOrder: string[] = [];

      class OrderedService {
        constructor(public name: string) {}
        async onDestroy(): Promise<void> {
          destroyOrder.push(this.name);
        }
      }

      const service1 = new OrderedService('first');
      const service2 = new OrderedService('second');
      const service3 = new OrderedService('third');

      const providers: Array<[any, Provider]> = [
        [createToken('Service1'), { useValue: service1 }],
        [createToken('Service2'), { useValue: service2 }],
        [createToken('Service3'), { useValue: service3 }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);
      await module.onStart(app);
      await module.onStop(app);

      expect(destroyOrder).toEqual(['third', 'second', 'first']);
    });

    it('should call module lifecycle hooks', async () => {
      const hooks = {
        onModuleRegister: jest.fn(),
        onModuleStart: jest.fn(),
        onModuleStop: jest.fn()
      };

      class TestModule extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule' });
        }

        protected async onModuleRegister(app: IApplication): Promise<void> {
          hooks.onModuleRegister(app);
        }

        protected async onModuleStart(app: IApplication): Promise<void> {
          hooks.onModuleStart(app);
        }

        protected async onModuleStop(app: IApplication): Promise<void> {
          hooks.onModuleStop(app);
        }
      }

      const module = new TestModule();

      await module.onRegister(app);
      expect(hooks.onModuleRegister).toHaveBeenCalledWith(app);

      await module.onStart(app);
      expect(hooks.onModuleStart).toHaveBeenCalledWith(app);

      await module.onStop(app);
      expect(hooks.onModuleStop).toHaveBeenCalledWith(app);
    });
  });

  describe('Module Exports', () => {
    it('should export specified providers to parent container', async () => {
      const service = new TestServiceImpl();
      const privateService = { private: true };

      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useValue: service }],
        [createToken('PrivateService'), { useValue: privateService }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({
            name: 'TestModule',
            providers,
            exports: [TestServiceToken] // Only export TestServiceToken
          });
        }
      })();

      await module.onRegister(app);

      // Exported service should be available in app container
      expect(app.container.has(TestServiceToken)).toBe(true);
      expect(app.container.resolve(TestServiceToken)).toBe(service);

      // Note: After architectural changes, we use parent container directly
      // All providers are registered in the parent container for simplicity
      // Export configuration is for documentation and future module isolation
      expect(app.container.has(createToken('PrivateService'))).toBe(true);
    });
  });

  describe('Health Checks', () => {
    it('should check health of all providers', async () => {
      const healthyService = new TestServiceImpl();
      healthyService.initialized = true;

      const unhealthyService = new TestServiceImpl();
      unhealthyService.destroyed = true;

      const providers: Array<[any, Provider]> = [
        [createToken('HealthyService'), { useValue: healthyService }],
        [createToken('UnhealthyService'), { useValue: unhealthyService }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);
      await module.onStart(app);

      const health = await module.health();

      expect(health.status).toBe('unhealthy');
      expect(health.message).toContain('unhealthy providers');
    });

    it('should report degraded if any provider is degraded', async () => {
      class HealthyService {
        async health(): Promise<HealthStatus> {
          return { status: 'healthy', message: 'Service healthy' };
        }
      }

      class DegradedService {
        async health(): Promise<HealthStatus> {
          return { status: 'degraded', message: 'Service degraded' };
        }
      }

      const providers: Array<[any, Provider]> = [
        [createToken('Service1'), { useValue: new HealthyService() }],
        [createToken('Service2'), { useValue: new DegradedService() }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);
      const health = await module.health();

      expect(health.status).toBe('degraded');
    });

    it('should handle provider health check errors', async () => {
      class ErrorService {
        async health(): Promise<HealthStatus> {
          throw new Error('Health check failed');
        }
      }

      const providers: Array<[any, Provider]> = [
        [createToken('ErrorService'), { useValue: new ErrorService() }]
      ];

      const module = new (class extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }
      })();

      await module.onRegister(app);
      const health = await module.health();

      expect(health.status).toBe('unhealthy');
      expect(health.details).toBeDefined();
    });
  });

  describe('Module Decorator', () => {
    it('should create module with decorator', () => {
      @Module({
        name: 'DecoratedModule',
        version: '1.0.0',
        providers: [
          [TestServiceToken, { useClass: TestServiceImpl }]
        ]
      })
      class DecoratedModule {
        customMethod(): string {
          return 'custom';
        }
      }

      const ModuleClass = DecoratedModule as any;
      const module = new ModuleClass();

      expect(module.name).toBe('DecoratedModule');
      expect(module.metadata.version).toBe('1.0.0');
      expect(module.metadata.providers).toHaveLength(1);
    });

    it('should delegate lifecycle methods to decorated class', async () => {
      const hooks = {
        onRegister: jest.fn(),
        onStart: jest.fn(),
        onStop: jest.fn()
      };

      @Module({
        name: 'DecoratedModule',
        providers: []
      })
      class DecoratedModule {
        async onRegister(app: IApplication): Promise<void> {
          hooks.onRegister(app);
        }

        async onStart(app: IApplication): Promise<void> {
          hooks.onStart(app);
        }

        async onStop(app: IApplication): Promise<void> {
          hooks.onStop(app);
        }
      }

      const ModuleClass = DecoratedModule as any;
      const module = new ModuleClass();

      await module.onRegister(app);
      await module.onStart(app);
      await module.onStop(app);

      expect(hooks.onRegister).toHaveBeenCalledWith(app);
      expect(hooks.onStart).toHaveBeenCalledWith(app);
      expect(hooks.onStop).toHaveBeenCalledWith(app);
    });
  });

  describe('Helper Functions', () => {
    it('should create module with providers using helper', async () => {
      const module = createModuleWithProviders(
        'HelperModule',
        [
          [TestServiceToken, { useClass: TestServiceImpl }]
        ],
        {
          version: '1.0.0',
          exports: [TestServiceToken]
        }
      );

      expect(module.name).toBe('HelperModule');
      expect(module.version).toBe('1.0.0');

      await module.onRegister(app);
      expect(app.container.has(TestServiceToken)).toBe(true);
    });
  });

  describe('Protected Methods', () => {
    it('should provide getProvider method', async () => {
      const service = new TestServiceImpl();
      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useValue: service }]
      ];

      class TestModule extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }

        testGetProvider(): TestService | undefined {
          return this.getProvider(TestServiceToken);
        }
      }

      const module = new TestModule();
      await module.onRegister(app);

      expect(module.testGetProvider()).toBe(service);
    });

    it('should provide hasProvider method', async () => {
      const providers: Array<[any, Provider]> = [
        [TestServiceToken, { useClass: TestServiceImpl }]
      ];

      class TestModule extends EnhancedApplicationModule {
        constructor() {
          super({ name: 'TestModule', providers });
        }

        testHasProvider(token: any): boolean {
          return this.hasProvider(token);
        }
      }

      const module = new TestModule();
      await module.onRegister(app);

      expect(module.testHasProvider(TestServiceToken)).toBe(true);
      expect(module.testHasProvider(createToken('NonExistent'))).toBe(false);
    });
  });
});