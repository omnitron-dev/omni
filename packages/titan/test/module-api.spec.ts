/**
 * Tests for the improved Titan module API
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createToken } from '@nexus';
import {
  TitanApplication,
  Injectable,
  Singleton,
  Inject,
  OnInit,
  OnDestroy,
  type DynamicModule,
  type Provider
} from '../src/index';
import { LOGGER_SERVICE_TOKEN } from '../src/modules/logger.module';
const CONFIG_SERVICE_TOKEN = createToken('ConfigModule');

// Test service tokens
const TestServiceToken = createToken<TestService>('TestService');
const TestConfigToken = createToken<TestConfig>('TestConfig');
const DependentServiceToken = createToken<DependentService>('DependentService');

// Test types
interface TestConfig {
  enabled: boolean;
  value: string;
  count: number;
}

// Test services
@Injectable()
@Singleton()
class TestService implements OnInit, OnDestroy {
  private initialized = false;
  private destroyed = false;

  constructor(@Inject(TestConfigToken) private config: TestConfig) { }

  async onInit(): Promise<void> {
    this.initialized = true;
  }

  async onDestroy(): Promise<void> {
    this.destroyed = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  getConfig(): TestConfig {
    return this.config;
  }

  doSomething(): string {
    return `Service running with value: ${this.config.value}`;
  }
}

@Injectable()
@Singleton()
class DependentService implements OnInit {
  private initialized = false;

  constructor(
    @Inject(TestServiceToken) private testService: TestService,
    @Inject(TestConfigToken) private config: TestConfig
  ) { }

  async onInit(): Promise<void> {
    this.initialized = true;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getMessage(): string {
    return `Dependent: ${this.testService.doSomething()}`;
  }
}

// Test module with forRoot pattern
class TestModule implements IModule {
  readonly name = 'test-module';
  readonly version = '1.0.0';

  /**
   * Static forRoot method for dynamic module configuration
   */
  static forRoot(config?: TestConfig): DynamicModule {
    const providers: Provider[] = [
      {
        provide: TestConfigToken,
        useValue: config || {
          enabled: true,
          value: 'default',
          count: 0
        }
      },
      {
        provide: TestServiceToken,
        useClass: TestService
      },
      {
        provide: DependentServiceToken,
        useClass: DependentService
      }
    ];

    return {
      module: TestModule,
      name: 'test-module',
      version: '1.0.0',
      providers,
      exports: [TestServiceToken, DependentServiceToken],
      global: false
    };
  }

  /**
   * Async configuration pattern
   */
  static forRootAsync(options: {
    useFactory: (...args: any[]) => TestConfig | Promise<TestConfig>;
    inject?: any[];
  }): DynamicModule {
    const providers: Provider[] = [
      {
        provide: TestConfigToken,
        useFactory: options.useFactory,
        inject: options.inject || []
      },
      {
        provide: TestServiceToken,
        useClass: TestService
      },
      {
        provide: DependentServiceToken,
        useClass: DependentService
      }
    ];

    return {
      module: TestModule,
      name: 'test-module',
      version: '1.0.0',
      providers,
      exports: [TestServiceToken]
    };
  }

  async onStart(app: any): Promise<void> {
    // Services are automatically registered via providers
    // Just initialize them if they exist
    if (app.hasProvider(TestServiceToken)) {
      const testService = app.resolve(TestServiceToken);
      if (testService.onInit) {
        await testService.onInit();
      }
    }

    if (app.hasProvider(DependentServiceToken)) {
      const dependentService = app.resolve(DependentServiceToken);
      if (dependentService.onInit) {
        await dependentService.onInit();
      }
    }
  }

  async onStop(app: any): Promise<void> {
    // Cleanup
    if (app.hasProvider(TestServiceToken)) {
      const testService = app.resolve(TestServiceToken);
      if (testService.onDestroy) {
        await testService.onDestroy();
      }
    }
  }
}

// Simple module without forRoot
class SimpleModule implements IModule {
  readonly name = 'simple-module';
  readonly version = '1.0.0';

  async onStart(app: any): Promise<void> {
    // Register providers manually only if not already registered
    if (!app.hasProvider(TestConfigToken)) {
      app.register(TestConfigToken, {
        useValue: {
          enabled: false,
          value: 'simple',
          count: 42
        }
      });
    }

    if (!app.hasProvider(TestServiceToken)) {
      app.register(TestServiceToken, {
        useClass: TestService
      });

      const service = app.resolve(TestServiceToken);
      await service.onInit?.();
    }
  }
}

describe('Improved Titan Module API', () => {
  let app: any;

  afterEach(async () => {
    if (app && app.state === 'started') {
      await app.stop();
    }
  });

  describe('Module Registration Patterns', () => {
    it('should support module class reference without instantiation', async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [SimpleModule] // Pass class, not instance
      });

      await app.start();

      // Module should be registered and started
      expect(app.state).toBe('started');
    });

    it('should support forRoot pattern with configuration', async () => {
      const config: TestConfig = {
        enabled: true,
        value: 'test-value',
        count: 123
      };

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [TestModule.forRoot(config)]
      });

      await app.start();

      // Services should be available with the provided config
      const testService = app.resolve(TestServiceToken);
      expect(testService).toBeDefined();
      expect(testService.getConfig()).toEqual(config);
      expect(testService.isInitialized()).toBe(true);
    });

    it('should support forRootAsync pattern with factory', async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [
          TestModule.forRootAsync({
            useFactory: async () => {
              // Simulate async config loading
              await new Promise(resolve => setTimeout(resolve, 10));
              return {
                enabled: true,
                value: 'async-loaded',
                count: 999
              };
            }
          })
        ]
      });

      await app.start();

      const testService = app.resolve(TestServiceToken);
      expect(testService).toBeDefined();
      expect(testService.getConfig().value).toBe('async-loaded');
      expect(testService.getConfig().count).toBe(999);
    });

    it('should support module instance (backward compatibility)', async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [new SimpleModule()]
      });

      await app.start();

      expect(app.state).toBe('started');
    });

    it('should support factory function returning module', async () => {
      const moduleFactory = () => TestModule.forRoot({
        enabled: true,
        value: 'factory',
        count: 777
      });

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [moduleFactory]
      });

      await app.start();

      const testService = app.resolve(TestServiceToken);
      expect(testService.getConfig().value).toBe('factory');
      expect(testService.getConfig().count).toBe(777);
    });

    it('should support async factory function', async () => {
      const asyncModuleFactory = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return TestModule.forRoot({
          enabled: true,
          value: 'async-factory',
          count: 555
        });
      };

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [asyncModuleFactory]
      });

      await app.start();

      const testService = app.resolve(TestServiceToken);
      expect(testService.getConfig().value).toBe('async-factory');
    });
  });

  describe('Public Container API', () => {
    beforeEach(async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true
      });
    });

    it('should provide public container access', () => {
      expect(app.container).toBeDefined();
      expect(typeof app.container.register).toBe('function');
      expect(typeof app.container.resolve).toBe('function');
    });

    it('should support register method on application', () => {
      const testToken = createToken<{ value: string }>('TestValue');

      app.register(testToken, {
        useValue: { value: 'registered' }
      });

      const resolved = app.resolve(testToken);
      expect(resolved.value).toBe('registered');
    });

    it('should support resolve method on application', async () => {
      await app.start();

      // Core modules should be resolvable
      const logger = app.resolve(LOGGER_SERVICE_TOKEN);
      expect(logger).toBeDefined();
      expect(logger.name).toBe('logger');
    });

    it('should support hasProvider method', () => {
      const testToken = createToken('TestToken');

      expect(app.hasProvider(testToken)).toBe(false);

      app.register(testToken, {
        useValue: 'test'
      });

      expect(app.hasProvider(testToken)).toBe(true);
    });

    it('should support option in register', () => {
      const testToken = createToken('TestToken');

      app.register(testToken, {
        useValue: 'first'
      });

      app.register(testToken, {
        useValue: 'second'
      }, { override: true });

      expect(app.resolve(testToken)).toBe('second');
    });
  });

  describe('Dynamic Module Features', () => {
    it('should handle module providers correctly', async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [
          TestModule.forRoot({
            enabled: true,
            value: 'provider-test',
            count: 100
          })
        ]
      });

      await app.start();

      // All providers should be registered
      expect(app.hasProvider(TestConfigToken)).toBe(true);
      expect(app.hasProvider(TestServiceToken)).toBe(true);
      expect(app.hasProvider(DependentServiceToken)).toBe(true);

      // Services should be properly injected
      const dependentService = app.resolve(DependentServiceToken);
      expect(dependentService.getMessage()).toContain('provider-test');
    });

    it('should support factory providers', async () => {
      const factoryToken = createToken<string>('FactoryValue');

      const dynamicModule: DynamicModule = {
        module: TestModule,
        name: 'factory-test',
        version: '1.0.0',
        providers: [
          {
            provide: factoryToken,
            useFactory: () => 'factory-created-value'
          }
        ]
      };

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [dynamicModule]
      });

      await app.start();

      expect(app.resolve(factoryToken)).toBe('factory-created-value');
    });

    it('should support factory providers with dependencies', async () => {
      const derivedToken = createToken<string>('DerivedValue');

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [
          TestModule.forRoot({
            enabled: true,
            value: 'base',
            count: 50
          })
        ]
      });

      // Add a factory provider that depends on other services
      app.register(derivedToken, {
        useFactory: (testService: TestService) => {
          return `Derived from: ${testService.doSomething()}`;
        },
        inject: [TestServiceToken]
      });

      await app.start();

      const derivedValue = app.resolve(derivedToken);
      expect(derivedValue).toContain('base');
    });

    it('should handle module imports', async () => {
      const importedModule = TestModule.forRoot({
        enabled: true,
        value: 'imported',
        count: 10
      });

      const mainModule: DynamicModule = {
        module: class MainModule implements IModule {
          readonly name = 'main-module';
        },
        name: 'main-module',
        imports: [importedModule],
        providers: []
      };

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [mainModule]
      });

      await app.start();

      // Services from imported module should be available
      const testService = app.resolve(TestServiceToken);
      expect(testService.getConfig().value).toBe('imported');
    });
  });

  describe('Lifecycle Management', () => {
    it('should call onInit for services registered via dynamic module', async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [
          TestModule.forRoot({
            enabled: true,
            value: 'lifecycle',
            count: 1
          })
        ]
      });

      await app.start();

      const testService = app.resolve(TestServiceToken);
      const dependentService = app.resolve(DependentServiceToken);

      expect(testService.isInitialized()).toBe(true);
      expect(dependentService.isInitialized()).toBe(true);
    });

    it('should call onDestroy for services on shutdown', async () => {
      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [
          TestModule.forRoot({
            enabled: true,
            value: 'destroy-test',
            count: 1
          })
        ]
      });

      await app.start();

      const testService = app.resolve(TestServiceToken);
      expect(testService.isDestroyed()).toBe(false);

      await app.stop();

      expect(testService.isDestroyed()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when resolving non-existent provider', () => {
      app = new TitanApplication({
        name: 'test-app',
        disableGracefulShutdown: true
      });

      const unknownToken = createToken('UnknownService');

      expect(() => app.resolve(unknownToken)).toThrow();
    });

    it('should handle module registration errors gracefully', async () => {
      const errorModule = {
        name: 'error-module',
        onStart: async () => {
          throw new Error('Module startup failed');
        }
      };

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [errorModule]
      });

      await expect(app.start()).rejects.toThrow('Module startup failed');
    });
  });

  describe('Mixed Module Registration', () => {
    it('should support mixing different module patterns', async () => {
      const config1: TestConfig = {
        enabled: true,
        value: 'module1',
        count: 1
      };

      app = await TitanApplication.create({
        name: 'test-app',
        disableGracefulShutdown: true,
        modules: [
          TestModule.forRoot(config1),  // Dynamic module with forRoot
          SimpleModule,                   // Class reference
          new (class InlineModule implements IModule {  // Anonymous class instance
            readonly name = 'inline-module';
            readonly version = '1.0.0';
          })()
        ]
      });

      await app.start();

      expect(app.state).toBe('started');

      // TestModule services should be available
      const testService = app.resolve(TestServiceToken);
      expect(testService.getConfig().value).toBe('module1');
    });
  });
});