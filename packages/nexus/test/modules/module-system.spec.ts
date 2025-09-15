/**
 * Module System Tests
 * Tests for module creation, composition, and lifecycle
 */

import {
  Container,
  createToken,
  createModule,
  createDynamicModule,
  moduleBuilder,
  createConfigModule,
  IModule,
  DynamicModule,
  ModuleMetadata,
  ForwardRef,
  forwardRef
} from '../../src';

describe('Module System', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Basic Module Creation', () => {
    it('should create a simple module', () => {
      const module = createModule({
        name: 'TestModule',
        providers: [
          {
            provide: createToken('TestService'),
            useValue: 'test-value'
          }
        ]
      });

      expect(module.name).toBe('TestModule');
      expect(module.providers).toHaveLength(1);
    });

    it('should load module into container', async () => {
      const serviceToken = createToken<string>('Service');
      
      const module = createModule({
        name: 'AppModule',
        providers: [
          {
            provide: serviceToken,
            useValue: 'module-service'
          }
        ],
        exports: [serviceToken]
      });

      await container.loadModule(module);
      const service = container.resolve(serviceToken);
      
      expect(service).toBe('module-service');
    });

    it('should handle module imports', async () => {
      const sharedToken = createToken<string>('Shared');
      const appToken = createToken<string>('App');

      const sharedModule = createModule({
        name: 'SharedModule',
        providers: [
          {
            provide: sharedToken,
            useValue: 'shared-value'
          }
        ],
        exports: [sharedToken]
      });

      const appModule = createModule({
        name: 'AppModule',
        imports: [sharedModule],
        providers: [
          {
            provide: appToken,
            useFactory: (shared: string) => `app-${shared}`,
            inject: [sharedToken]
          }
        ]
      });

      await container.loadModule(appModule);
      const appService = container.resolve(appToken);
      
      expect(appService).toBe('app-shared-value');
    });

    it('should respect module exports', async () => {
      const privateToken = createToken<string>('Private');
      const publicToken = createToken<string>('Public');

      const module = createModule({
        name: 'RestrictedModule',
        providers: [
          { provide: privateToken, useValue: 'private' },
          { provide: publicToken, useValue: 'public' }
        ],
        exports: [publicToken] // Only export public
      });

      await container.loadModule(module);
      
      expect(container.resolve(publicToken)).toBe('public');
      expect(() => container.resolve(privateToken)).toThrow();
    });
  });

  describe('Dynamic Modules', () => {
    it('should create dynamic module with forRoot', async () => {
      interface DatabaseConfig {
        host: string;
        port: number;
      }

      const DatabaseToken = createToken<{ config: DatabaseConfig }>('Database');

      const DatabaseModule = {
        forRoot(config: DatabaseConfig): DynamicModule {
          return createDynamicModule({
            name: 'DatabaseModule',
            providers: [
              {
                provide: DatabaseToken,
                useValue: { config }
              }
            ],
            exports: [DatabaseToken]
          });
        }
      };

      const module = DatabaseModule.forRoot({
        host: 'localhost',
        port: 5432
      });

      await container.loadModule(module);
      const db = container.resolve(DatabaseToken);
      
      expect(db.config.host).toBe('localhost');
      expect(db.config.port).toBe(5432);
    });

    it('should create dynamic module with forFeature', async () => {
      const RepositoryToken = createToken<{ entity: string }>('Repository');

      const RepositoryModule = {
        forFeature(entities: string[]): DynamicModule {
          return createDynamicModule({
            name: 'RepositoryModule',
            providers: entities.map(entity => ({
              provide: createToken(`${entity}Repository`),
              useValue: { entity }
            })),
            exports: entities.map(entity => createToken(`${entity}Repository`))
          });
        }
      };

      const module = RepositoryModule.forFeature(['User', 'Post', 'Comment']);
      await container.loadModule(module);
      
      const userRepo = container.resolve(createToken('UserRepository'));
      expect(userRepo).toEqual({ entity: 'User' });
    });

    it('should support async configuration', async () => {
      const ConfigToken = createToken<{ apiKey: string }>('Config');

      const ConfigModule = {
        forRootAsync(options: {
          useFactory: () => Promise<{ apiKey: string }>;
        }): DynamicModule {
          return createDynamicModule({
            name: 'ConfigModule',
            providers: [
              {
                provide: ConfigToken,
                useFactory: options.useFactory,
                async: true
              }
            ],
            exports: [ConfigToken]
          });
        }
      };

      const module = ConfigModule.forRootAsync({
        useFactory: async () => {
          // Simulate async config loading
          await new Promise(resolve => setTimeout(resolve, 10));
          return { apiKey: 'secret-key' };
        }
      });

      await container.loadModule(module);
      const config = await container.resolveAsync(ConfigToken);
      
      expect(config.apiKey).toBe('secret-key');
    });
  });

  describe('Module Builder', () => {
    it('should build module with fluent API', async () => {
      const serviceToken = createToken<string>('Service');
      const configToken = createToken<{ enabled: boolean }>('Config');

      const module = moduleBuilder('FluentModule')
        .provide(configToken, { useValue: { enabled: true } })
        .provide(serviceToken, {
          useFactory: (config) => config.enabled ? 'enabled' : 'disabled',
          inject: [configToken]
        })
        .exports([serviceToken])
        .build();

      await container.loadModule(module);
      const service = container.resolve(serviceToken);
      
      expect(service).toBe('enabled');
    });

    it('should support conditional providers', async () => {
      const envToken = createToken<string>('Environment');
      const serviceToken = createToken<string>('Service');

      const module = moduleBuilder('ConditionalModule')
        .provide(envToken, { useValue: 'production' })
        .provideIf(
          (container) => container.resolve(envToken) === 'production',
          serviceToken,
          { useValue: 'prod-service' }
        )
        .exports([serviceToken])
        .build();

      await container.loadModule(module);
      const service = container.resolve(serviceToken);
      
      expect(service).toBe('prod-service');
    });

    it('should support module composition', async () => {
      const loggerToken = createToken<{ log: (msg: string) => void }>('Logger');
      const serviceToken = createToken<{ name: string }>('Service');

      const LoggerModule = moduleBuilder('LoggerModule')
        .provide(loggerToken, {
          useValue: { log: jest.fn() }
        })
        .exports([loggerToken])
        .build();

      const ServiceModule = moduleBuilder('ServiceModule')
        .imports(LoggerModule)
        .provide(serviceToken, {
          useFactory: (logger) => {
            logger.log('Service created');
            return { name: 'TestService' };
          },
          inject: [loggerToken]
        })
        .exports([serviceToken, loggerToken])  // Export both for external access
        .build();

      await container.loadModule(ServiceModule);
      const service = container.resolve(serviceToken);
      const logger = container.resolve(loggerToken);
      
      expect(service.name).toBe('TestService');
      expect(logger.log).toHaveBeenCalledWith('Service created');
    });
  });

  describe('Config Module', () => {
    it('should create config module with validation', async () => {
      interface AppConfig {
        port: number;
        host: string;
        ssl: boolean;
      }

      const configModule = createConfigModule<AppConfig>({
        name: 'AppConfigModule',
        load: async () => ({
          port: 3000,
          host: 'localhost',
          ssl: false
        }),
        validate: (config) => {
          if (config.port < 1 || config.port > 65535) {
            throw new Error('Invalid port');
          }
          return true;
        }
      });

      await container.loadModule(configModule);
      const ConfigToken = createToken<AppConfig>('AppConfig');
      
      // Register the config token
      container.register(ConfigToken, {
        useFactory: () => configModule.config!
      });

      const config = container.resolve(ConfigToken);
      expect(config.port).toBe(3000);
      expect(config.host).toBe('localhost');
    });

    it('should support environment-based config', async () => {
      process.env.NODE_ENV = 'test';
      process.env.API_KEY = 'test-key';

      interface EnvConfig {
        env: string;
        apiKey: string;
      }

      const configModule = createConfigModule<EnvConfig>({
        name: 'EnvConfigModule',
        load: async () => ({
          env: process.env.NODE_ENV || 'development',
          apiKey: process.env.API_KEY || ''
        })
      });

      await container.loadModule(configModule);
      expect(configModule.config?.env).toBe('test');
      expect(configModule.config?.apiKey).toBe('test-key');
    });
  });

  describe('Module Lifecycle', () => {
    it('should call onModuleInit lifecycle hook', async () => {
      const onInit = jest.fn();

      const module = createModule({
        name: 'LifecycleModule',
        providers: [],
        onModuleInit: onInit
      });

      await container.loadModule(module);
      expect(onInit).toHaveBeenCalled();
    });

    it('should call onModuleDestroy lifecycle hook', async () => {
      const onDestroy = jest.fn();

      const module = createModule({
        name: 'LifecycleModule',
        providers: [],
        onModuleDestroy: onDestroy
      });

      await container.loadModule(module);
      await container.dispose();
      
      expect(onDestroy).toHaveBeenCalled();
    });

    it('should initialize modules in dependency order', async () => {
      const initOrder: string[] = [];

      const moduleA = createModule({
        name: 'ModuleA',
        onModuleInit: async () => {
          initOrder.push('A');
        }
      });

      const moduleB = createModule({
        name: 'ModuleB',
        imports: [moduleA],
        onModuleInit: async () => {
          initOrder.push('B');
        }
      });

      const moduleC = createModule({
        name: 'ModuleC',
        imports: [moduleB],
        onModuleInit: async () => {
          initOrder.push('C');
        }
      });

      await container.loadModule(moduleC);
      expect(initOrder).toEqual(['A', 'B', 'C']);
    });

    it('should destroy modules in reverse dependency order', async () => {
      const destroyOrder: string[] = [];

      const moduleA = createModule({
        name: 'ModuleA',
        onModuleDestroy: async () => {
          destroyOrder.push('A');
        }
      });

      const moduleB = createModule({
        name: 'ModuleB',
        imports: [moduleA],
        onModuleDestroy: async () => {
          destroyOrder.push('B');
        }
      });

      const moduleC = createModule({
        name: 'ModuleC',
        imports: [moduleB],
        onModuleDestroy: async () => {
          destroyOrder.push('C');
        }
      });

      await container.loadModule(moduleC);
      await container.dispose();
      
      expect(destroyOrder).toEqual(['C', 'B', 'A']);
    });
  });

  describe('Circular Dependencies', () => {
    it('should handle forward references', async () => {
      const tokenA = createToken<{ name: string }>('A');
      const tokenB = createToken<{ name: string }>('B');

      const moduleA: ForwardRef<IModule> = forwardRef(() => createModule({
        name: 'ModuleA',
        imports: [moduleB],
        providers: [
          {
            provide: tokenA,
            useValue: { name: 'A' }
          }
        ],
        exports: [tokenA]
      }));

      const moduleB = createModule({
        name: 'ModuleB',
        imports: [moduleA],
        providers: [
          {
            provide: tokenB,
            useValue: { name: 'B' }
          }
        ],
        exports: [tokenB]
      });

      await container.loadModule(moduleB);
      
      const a = container.resolve(tokenA);
      const b = container.resolve(tokenB);
      
      expect(a.name).toBe('A');
      expect(b.name).toBe('B');
    });

    it('should detect circular module imports', async () => {
      const moduleA: any = createModule({
        name: 'ModuleA',
        imports: [] // Will be set to moduleB
      });

      const moduleB = createModule({
        name: 'ModuleB',
        imports: [moduleA]
      });

      // Create circular dependency
      moduleA.imports = [moduleB];

      expect(() => container.loadModule(moduleA)).toThrow('Circular module dependency');
    });
  });

  describe('Global Modules', () => {
    it('should make module providers globally available', async () => {
      const globalToken = createToken<string>('GlobalService');

      const globalModule = createModule({
        name: 'GlobalModule',
        providers: [
          {
            provide: globalToken,
            useValue: 'global-service'
          }
        ],
        exports: [globalToken],
        global: true
      });

      const consumerModule = createModule({
        name: 'ConsumerModule',
        // No need to import global module
        providers: [
          {
            provide: createToken('Consumer'),
            useFactory: (global: string) => `consumer-${global}`,
            inject: [globalToken]
          }
        ]
      });

      await container.loadModule(globalModule);
      await container.loadModule(consumerModule);
      
      const consumer = container.resolve(createToken('Consumer'));
      expect(consumer).toBe('consumer-global-service');
    });
  });

  describe('Module Metadata', () => {
    it('should store and retrieve module metadata', () => {
      const metadata: ModuleMetadata = {
        name: 'MetadataModule',
        version: '1.0.0',
        description: 'Test module with metadata',
        author: 'Test Author',
        tags: ['test', 'example']
      };

      const module = createModule({
        ...metadata,
        providers: []
      });

      expect(module.name).toBe('MetadataModule');
      expect(module.metadata?.version).toBe('1.0.0');
      expect(module.metadata?.description).toBe('Test module with metadata');
      expect(module.metadata?.tags).toContain('test');
    });

    it('should validate module dependencies', async () => {
      const module = createModule({
        name: 'DependentModule',
        requires: ['DatabaseModule', 'CacheModule'],
        providers: []
      });

      // Should throw when required modules are not loaded
      expect(() => container.loadModule(module)).toThrow('Required module not found: DatabaseModule');
    });
  });
});