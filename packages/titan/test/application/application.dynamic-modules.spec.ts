/**
 * Dynamic Module Tests for Titan Application
 *
 * Tests for dynamic module imports including forRoot, forRootAsync, forFeature
 * patterns and complex module configuration scenarios.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, IApplication, IDynamicModule } from '../../src/types.js';
import { Module, Injectable } from '../../src/decorators/index.js';
import { createToken, Token } from '../../src/nexus/index.js';

// Test service tokens
const DB_SERVICE_TOKEN = createToken<DatabaseService>('DatabaseService');
const CONFIG_TOKEN = createToken<DatabaseConfig>('DatabaseConfig');

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
}

@Injectable()
class DatabaseService {
  constructor(public config: DatabaseConfig) {}

  async connect(): Promise<void> {
    // Simulated connection
  }

  async query(sql: string): Promise<any[]> {
    return [];
  }
}

describe('Titan Application Dynamic Modules', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop({ force: true });
    }
  });

  describe('forRoot Pattern', () => {
    it('should handle static forRoot configuration', async () => {
      const config: DatabaseConfig = {
        host: 'localhost',
        port: 5432,
        database: 'test_db',
      };

      @Module({
        providers: [
          { provide: CONFIG_TOKEN, useValue: config },
          {
            provide: DB_SERVICE_TOKEN,
            useFactory: (cfg: DatabaseConfig) => new DatabaseService(cfg),
            inject: [CONFIG_TOKEN],
          },
        ],
        exports: [DB_SERVICE_TOKEN],
      })
      class DatabaseModule implements IModule {
        name = 'database';

        static forRoot(config: DatabaseConfig): IDynamicModule {
          return {
            module: DatabaseModule,
            providers: [
              { provide: CONFIG_TOKEN, useValue: config },
              {
                provide: DB_SERVICE_TOKEN,
                useFactory: (cfg: DatabaseConfig) => new DatabaseService(cfg),
                inject: [CONFIG_TOKEN],
              },
            ],
            exports: [DB_SERVICE_TOKEN],
          };
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [DatabaseModule.forRoot(config)],
      });

      await app.start();

      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle forRoot with options object', async () => {
      interface HttpOptions {
        port: number;
        timeout: number;
        cors: boolean;
      }

      @Module()
      class HttpModule implements IModule {
        name = 'http';
        private options?: HttpOptions;

        static forRoot(options: HttpOptions): IDynamicModule {
          return {
            module: HttpModule,
            providers: [{ provide: 'HTTP_OPTIONS', useValue: options }],
          };
        }

        configure(config: any): void {
          this.options = config;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [
          HttpModule.forRoot({
            port: 3000,
            timeout: 5000,
            cors: true,
          }),
        ],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('forRootAsync Pattern', () => {
    it('should handle async factory configuration', async () => {
      @Module()
      class AsyncConfigModule implements IModule {
        name = 'async-config';

        static forRootAsync(options: { useFactory: () => Promise<any> }): IDynamicModule {
          return {
            module: AsyncConfigModule,
            providers: [
              {
                provide: 'ASYNC_CONFIG',
                useFactory: options.useFactory,
              },
            ],
          };
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [
          AsyncConfigModule.forRootAsync({
            useFactory: async () => {
              // Simulate async config loading
              await new Promise((resolve) => setTimeout(resolve, 10));
              return { setting: 'async-value' };
            },
          }),
        ],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle forRootAsync with dependencies', async () => {
      const ConfigService = createToken<{ get: (key: string) => string }>('ConfigService');

      @Module({
        providers: [
          {
            provide: ConfigService,
            useValue: {
              get: (key: string) => (key === 'redis.host' ? 'redis-server' : '6379'),
            },
          },
        ],
      })
      class ConfigModule implements IModule {
        name = 'config-deps-test';
      }

      @Module()
      class RedisModule implements IModule {
        name = 'redis-deps-test';

        static forRootAsync(options: {
          useFactory: (config: { get: (key: string) => string }) => Promise<any>;
          inject: Token<any>[];
        }): IDynamicModule {
          return {
            module: RedisModule,
            providers: [
              {
                provide: 'REDIS_OPTIONS',
                useFactory: options.useFactory,
                inject: options.inject,
              },
            ],
          };
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [
          new ConfigModule(),
          RedisModule.forRootAsync({
            useFactory: async (config) => ({
              host: config.get('redis.host'),
              port: parseInt(config.get('redis.port')),
            }),
            inject: [ConfigService],
          }),
        ],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('forFeature Pattern', () => {
    it('should handle feature module registration', async () => {
      @Module()
      class DatabaseModule implements IModule {
        name = 'database-feature';
        private registeredEntities: any[] = [];

        static forRoot(): IDynamicModule {
          return {
            module: DatabaseModule,
            providers: [],
          };
        }

        static forFeature(entities: { entityName: string }[]): IDynamicModule {
          return {
            module: DatabaseModule,
            providers: entities.map((entity) => ({
              provide: `ENTITY_${entity.entityName}`,
              useValue: entity,
            })),
          };
        }
      }

      const UserEntity = { entityName: 'User' };
      const ProductEntity = { entityName: 'Product' };

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [DatabaseModule.forRoot(), DatabaseModule.forFeature([UserEntity, ProductEntity])],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Complex Module Composition', () => {
    it('should handle nested dynamic modules', async () => {
      @Module()
      class InnerModule implements IModule {
        name = 'inner';
        static forRoot(config: { value: string }): IDynamicModule {
          return {
            module: InnerModule,
            providers: [{ provide: 'INNER_VALUE', useValue: config.value }],
          };
        }
      }

      @Module()
      class OuterModule implements IModule {
        name = 'outer';
        static forRoot(config: { inner: { value: string } }): IDynamicModule {
          return {
            module: OuterModule,
            imports: [InnerModule.forRoot(config.inner)],
            providers: [{ provide: 'OUTER_CONFIG', useValue: config }],
          };
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [
          OuterModule.forRoot({
            inner: { value: 'nested-value' },
          }),
        ],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle dynamic modules with shared dependencies', async () => {
      const SHARED_SERVICE = createToken<{ data: string }>('SharedServiceUnique');

      @Module({
        providers: [{ provide: SHARED_SERVICE, useValue: { data: 'shared' } }],
        exports: [SHARED_SERVICE],
      })
      class SharedModule implements IModule {
        name = 'shared-unique';
      }

      @Module()
      class ConsumerA implements IModule {
        name = 'consumer-a-unique';
      }

      @Module()
      class ConsumerB implements IModule {
        name = 'consumer-b-unique';
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [new SharedModule(), new ConsumerA(), new ConsumerB()],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Module Factory Functions', () => {
    it('should handle factory function returning module instance', async () => {
      const createModule = (): IModule => ({
        name: 'factory-module',
        async onStart(app: IApplication) {
          // Factory module started
        },
      });

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [createModule],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
      expect(app.modules.has('factory-module')).toBe(true);
    });

    it('should handle async factory function', async () => {
      const createAsyncModule = async (): Promise<IModule> => {
        // Simulate async initialization
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          name: 'async-factory-module',
          async onStart(app: IApplication) {
            // Async factory module started
          },
        };
      };

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [createAsyncModule],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
      expect(app.modules.has('async-factory-module')).toBe(true);
    });

    it('should handle factory function returning dynamic module', async () => {
      const createDynamicModule = (): IDynamicModule => ({
        module: class DynamicFactoryModule implements IModule {
          name = 'dynamic-factory-module';
        },
        providers: [{ provide: 'FACTORY_VALUE', useValue: 42 }],
      });

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [createDynamicModule],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Provider Registration', () => {
    it('should register useValue providers correctly', async () => {
      const VALUE_TOKEN = createToken<string>('ValueToken');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[VALUE_TOKEN, { useValue: 'test-value' }]],
      });

      await app.start();

      const value = app.resolve(VALUE_TOKEN);
      expect(value).toBe('test-value');
    });

    it('should register useClass providers correctly', async () => {
      @Injectable()
      class TestService {
        getValue(): string {
          return 'service-value';
        }
      }

      const SERVICE_TOKEN = createToken<TestService>('TestService');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [[SERVICE_TOKEN, { useClass: TestService }]],
      });

      await app.start();

      const service = app.resolve(SERVICE_TOKEN);
      expect(service).toBeInstanceOf(TestService);
      expect(service.getValue()).toBe('service-value');
    });

    it('should register useFactory providers correctly', async () => {
      const FACTORY_TOKEN = createToken<{ timestamp: number }>('FactoryToken');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            FACTORY_TOKEN,
            {
              useFactory: () => ({ timestamp: Date.now() }),
            },
          ],
        ],
      });

      await app.start();

      const result = app.resolve(FACTORY_TOKEN);
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('should register useFactory with dependencies', async () => {
      const CONFIG_TOKEN = createToken<{ multiplier: number }>('Config');
      const COMPUTED_TOKEN = createToken<{ value: number }>('Computed');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [CONFIG_TOKEN, { useValue: { multiplier: 10 } }],
          [
            COMPUTED_TOKEN,
            {
              useFactory: (config: { multiplier: number }) => ({
                value: 5 * config.multiplier,
              }),
              inject: [CONFIG_TOKEN],
            },
          ],
        ],
      });

      await app.start();

      const result = app.resolve(COMPUTED_TOKEN);
      expect(result.value).toBe(50);
    });
  });

  describe('Module with Exports', () => {
    it('should respect module exports', async () => {
      const PUBLIC_TOKEN = createToken<string>('PublicService');
      const PRIVATE_TOKEN = createToken<string>('PrivateService');

      @Module({
        providers: [
          { provide: PUBLIC_TOKEN, useValue: 'public' },
          { provide: PRIVATE_TOKEN, useValue: 'private' },
        ],
        exports: [PUBLIC_TOKEN], // Only export public
      })
      class FeatureModule implements IModule {
        name = 'feature';
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [FeatureModule],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Error Handling in Dynamic Modules', () => {
    it('should handle errors in async factory', async () => {
      @Module()
      class FailingAsyncModule implements IModule {
        name = 'failing-async';

        static forRootAsync(): IDynamicModule {
          return {
            module: FailingAsyncModule,
            providers: [
              {
                provide: 'FAILING_PROVIDER',
                useFactory: async () => {
                  throw new Error('Factory initialization failed');
                },
              },
            ],
          };
        }
      }

      // With eager initialization, async factory errors surface during Application.create()
      await expect(
        Application.create({
          disableGracefulShutdown: true,
          disableCoreModules: true,
          modules: [FailingAsyncModule.forRootAsync()],
        })
      ).rejects.toThrow('Factory initialization failed');
    });

    it('should handle missing dependencies gracefully', async () => {
      @Module()
      class DependentModule implements IModule {
        name = 'dependent';
        dependencies = ['missing-module'];
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [DependentModule],
      });

      // Should start despite missing dependency
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });
});
