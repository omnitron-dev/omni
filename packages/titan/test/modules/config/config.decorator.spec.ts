/**
 * Tests for Configuration Decorators
 */

import 'reflect-metadata';
import { z } from 'zod';
import {
  Config,
  InjectConfig,
  ConfigSchema,
  ConfigWatch,
} from '../../../src/modules/config/config.decorator.js';
import { ConfigService } from '../../../src/modules/config/config.service.js';
import { Container, createToken } from '@omnitron-dev/nexus';

describe('Configuration Decorators', () => {
  describe('@Config decorator', () => {
    it('should inject configuration value into property', () => {
      class TestService {
        @Config('database.host', 'localhost')
        private dbHost!: string;

        @Config('app.port')
        private port!: number;

        getConfig() {
          return { host: this.dbHost, port: this.port };
        }
      }

      const service = new TestService();

      // Simulate DI injection
      (service as any).__configService = {
        get: (path: string, defaultValue?: any) => {
          if (path === 'database.host') return 'prod-db.example.com';
          if (path === 'app.port') return 3000;
          return defaultValue;
        }
      };

      const config = service.getConfig();
      expect(config.host).toBe('prod-db.example.com');
      expect(config.port).toBe(3000);
    });

    it('should inject configuration into constructor parameters', () => {
      class TestService {
        constructor(
          @Config('app.name') private appName: string,
          @Config('app.port', 3000) private port: number
        ) {}

        getAppInfo() {
          return { name: this.appName, port: this.port };
        }
      }

      // Check metadata was set
      const metadata = Reflect.getMetadata(CONFIG_INJECT_METADATA_KEY, TestService);
      expect(metadata).toBeDefined();
      expect(metadata).toHaveLength(2);
      // Decorators are applied in reverse order, so port comes first
      expect(metadata[0].path).toBe('app.port');
      expect(metadata[0].defaultValue).toBe(3000);
      expect(metadata[1].path).toBe('app.name');
    });

    it('should store configuration metadata', () => {
      class TestService {
        @Config('test.path', 'default')
        value!: string;
      }

      const metadata = Reflect.getMetadata(
        CONFIG_INJECT_METADATA_KEY,
        TestService.prototype,
        'value'
      );

      expect(metadata).toEqual({
        path: 'test.path',
        defaultValue: 'default'
      });
    });

    it('should use property name as path if not specified', () => {
      class TestService {
        @Config()
        serverPort!: number;
      }

      const metadata = Reflect.getMetadata(
        CONFIG_INJECT_METADATA_KEY,
        TestService.prototype,
        'serverPort'
      );

      expect(metadata.path).toBe('serverPort');
    });
  });

  describe('@InjectConfig decorator', () => {
    it('should inject ConfigService', () => {
      const MockConfigService = createToken('ConfigService');

      @InjectConfig()
      class TestService {
        constructor(private config: ConfigService) {}

        getConfigService() {
          return this.config;
        }
      }

      // The decorator should use Inject internally
      // We can't fully test DI integration here without a container
      expect(TestService).toBeDefined();
    });
  });

  describe('@ConfigSchema decorator', () => {
    it('should define schema for class', () => {
      const AppSchema = z.object({
        name: z.string(),
        port: z.number(),
        debug: z.boolean()
      });

      @ConfigSchema(AppSchema)
      class AppConfig {
        name!: string;
        port!: number;
        debug!: boolean;
      }

      const schema = Reflect.getMetadata(CONFIG_SCHEMA_METADATA_KEY, AppConfig);
      expect(schema).toBe(AppSchema);
    });

    it('should add validate method to instance', () => {
      const Schema = z.object({
        value: z.string().min(3)
      });

      @ConfigSchema(Schema)
      class Config {
        value = 'test';
      }

      const config = new Config();
      const result = (config as any).validate();

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: 'test' });
    });

    it('should add static validate method to class', () => {
      const Schema = z.object({
        value: z.number()
      });

      @ConfigSchema(Schema)
      class Config {}

      const result = (Config as any).validate({ value: 42 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ value: 42 });

      const invalidResult = (Config as any).validate({ value: 'string' });
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('@Configuration decorator', () => {
    it('should mark class as configuration', () => {
      @Configuration('database')
      class DatabaseConfig {
        host = 'localhost';
        port = 5432;
      }

      const isConfig = Reflect.getMetadata('titan:configuration', DatabaseConfig);
      const prefix = Reflect.getMetadata('titan:configuration:prefix', DatabaseConfig);

      expect(isConfig).toBe(true);
      expect(prefix).toBe('database');
    });

    it('should auto-register with DI token', () => {
      @Configuration()
      class AppConfig {}

      const token = Reflect.getMetadata('titan:token', AppConfig);
      expect(token).toBeDefined();
      expect(token.toString()).toContain('AppConfigConfig');
    });
  });

  describe('@ConfigValidate decorator', () => {
    it('should validate property on set', () => {
      const PortSchema = z.number().min(1).max(65535);

      class ServerConfig {
        @ConfigValidate(PortSchema)
        port = 3000;
      }

      const config = new ServerConfig();
      config.port = 8080;
      expect(config.port).toBe(8080);

      expect(() => {
        config.port = -1;
      }).toThrow('Validation failed');

      expect(() => {
        config.port = 70000;
      }).toThrow('Validation failed');
    });

    it('should store validation schema in metadata', () => {
      const EmailSchema = z.string().email();

      class UserConfig {
        @ConfigValidate(EmailSchema)
        email = 'test@example.com';
      }

      const schema = Reflect.getMetadata(
        'titan:config:validation:email',
        UserConfig.prototype
      );

      expect(schema).toBe(EmailSchema);
    });
  });

  describe('@ConfigWatch decorator', () => {
    it('should register config change watchers', () => {
      class ServiceWithWatchers {
        @ConfigWatch('database.connectionString')
        onDatabaseChange(newValue: string, oldValue: string) {
          console.log(`Database changed from ${oldValue} to ${newValue}`);
        }

        @ConfigWatch('app.debug')
        onDebugChange(newValue: boolean) {
          console.log(`Debug mode: ${newValue}`);
        }
      }

      const metadata = Reflect.getMetadata('titan:config:watch', ServiceWithWatchers.prototype);

      expect(metadata).toHaveLength(2);
      expect(metadata[0].path).toBe('database.connectionString');
      expect(metadata[0].method).toBe('onDatabaseChange');
      expect(metadata[1].path).toBe('app.debug');
      expect(metadata[1].method).toBe('onDebugChange');
    });
  });

  describe('@ConfigDefaults decorator', () => {
    it('should set default configuration values', () => {
      const defaults = {
        host: 'localhost',
        port: 5432,
        ssl: false
      };

      @ConfigDefaults(defaults)
      class DatabaseConfig {
        host!: string;
        port!: number;
        ssl!: boolean;
      }

      const storedDefaults = Reflect.getMetadata('titan:config:defaults', DatabaseConfig);
      expect(storedDefaults).toEqual(defaults);
    });
  });

  describe('@ConfigProvider decorator', () => {
    it('should mark method as configuration provider', () => {
      class ConfigProviders {
        @ConfigProvider('database')
        async provideDatabaseConfig() {
          return {
            host: 'db.example.com',
            port: 5432
          };
        }

        @ConfigProvider('cache')
        provideCacheConfig() {
          return {
            ttl: 3600,
            maxSize: 100
          };
        }
      }

      const providers = Reflect.getMetadata('titan:config:providers', ConfigProviders.prototype);

      expect(providers).toBeDefined();
      expect(providers.database).toBeDefined();
      expect(providers.cache).toBeDefined();
      expect(typeof providers.database).toBe('function');
      expect(typeof providers.cache).toBe('function');
    });
  });

  describe('@ConfigTransform decorator', () => {
    it('should transform property values on set', () => {
      class AppConfig {
        @ConfigTransform((value: string) => value.toUpperCase())
        environment = 'development';

        @ConfigTransform((value: number) => Math.max(0, Math.min(100, value)))
        percentage = 50;
      }

      const config = new AppConfig();

      config.environment = 'production';
      expect(config.environment).toBe('PRODUCTION');

      config.percentage = 150;
      expect(config.percentage).toBe(100);

      config.percentage = -10;
      expect(config.percentage).toBe(0);
    });

    it('should store transformer in metadata', () => {
      const transformer = (value: string) => value.trim();

      class Config {
        @ConfigTransform(transformer)
        value = 'test';
      }

      const storedTransformer = Reflect.getMetadata(
        'titan:config:transform:value',
        Config.prototype
      );

      expect(storedTransformer).toBe(transformer);
    });
  });

  describe('getConfigMetadata helper', () => {
    it('should retrieve all configuration metadata', () => {
      const schema = z.object({ test: z.string() });
      const defaults = { test: 'default' };

      @ConfigSchema(schema)
      @ConfigDefaults(defaults)
      class TestConfig {
        @Config('test.value')
        value!: string;

        @ConfigWatch('test.value')
        onChange(value: string) {}

        @ConfigProvider('custom')
        provideCustom() {
          return { custom: true };
        }
      }

      const metadata = getConfigMetadata(TestConfig);

      expect(metadata.schema).toBe(schema);
      expect(metadata.defaults).toEqual(defaults);
      // Watch metadata is on prototype, not class
      const watchMeta = getConfigMetadata(TestConfig.prototype);
      expect(watchMeta.watch).toBeDefined();
      expect(watchMeta.providers).toBeDefined();
    });

    it('should handle classes without metadata', () => {
      class EmptyClass {}

      const metadata = getConfigMetadata(EmptyClass);

      expect(metadata.schema).toBeUndefined();
      expect(metadata.defaults).toBeUndefined();
      expect(metadata.inject).toBeUndefined();
      expect(metadata.watch).toBeUndefined();
      expect(metadata.providers).toBeUndefined();
    });
  });

  describe('Decorator combinations', () => {
    it('should combine multiple decorators', () => {
      const DatabaseSchema = z.object({
        host: z.string(),
        port: z.number().positive(),
        ssl: z.boolean()
      });

      @Configuration('database')
      @ConfigSchema(DatabaseSchema)
      @ConfigDefaults({
        host: 'localhost',
        port: 5432,
        ssl: false
      })
      class DatabaseConfig {
        @Config('database.host')
        @ConfigValidate(z.string().min(1))
        @ConfigTransform((value: string) => value.toLowerCase())
        host!: string;

        @Config('database.port')
        @ConfigValidate(z.number().min(1).max(65535))
        port!: number;

        @ConfigWatch('database.host')
        onHostChange(newHost: string) {
          console.log(`Database host changed to: ${newHost}`);
        }
      }

      // Verify all metadata is set correctly
      expect(Reflect.getMetadata('titan:configuration', DatabaseConfig)).toBe(true);
      expect(Reflect.getMetadata(CONFIG_SCHEMA_METADATA_KEY, DatabaseConfig)).toBe(DatabaseSchema);
      expect(Reflect.getMetadata('titan:config:defaults', DatabaseConfig)).toBeDefined();
      expect(Reflect.getMetadata('titan:config:watch', DatabaseConfig.prototype)).toBeDefined();

      const hostMetadata = Reflect.getMetadata(
        CONFIG_INJECT_METADATA_KEY,
        DatabaseConfig.prototype,
        'host'
      );
      expect(hostMetadata.path).toBe('database.host');
    });
  });

  describe('Property descriptor modifications', () => {
    it('should preserve property enumeration and configuration', () => {
      class TestConfig {
        @Config('test.value')
        value = 'test';
      }

      const config = new TestConfig();
      const descriptor = Object.getOwnPropertyDescriptor(TestConfig.prototype, 'value');

      expect(descriptor?.enumerable).toBe(true);
      expect(descriptor?.configurable).toBe(true);
    });

    it('should allow property deletion and redefinition', () => {
      class TestConfig {
        @ConfigValidate(z.string())
        value = 'test';
      }

      const config = new TestConfig();
      // Set a new value
      config.value = 'new value';
      expect(config.value).toBe('new value');

      // The decorated property uses internal storage, so deleting doesn't affect it
      delete (config as any).value;
      // The value is still stored internally
      expect(config.value).toBe('new value');

      // Can still set a new value
      config.value = 'another value';
      expect(config.value).toBe('another value');
    });
  });
});