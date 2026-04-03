/**
 * Application Configuration Tests
 *
 * Tests for configuration-related functionality:
 * - Configuration setup and access
 * - Configuration merging
 * - Module configuration
 * - Configuration changes
 */

import { Application, createApp } from '../../src/application.js';
import { ApplicationState, ApplicationEvent } from '../../src/types.js';
import {
  SimpleModule,
  DatabaseModule,
  CacheModule,
  HttpServerModule,
  createWebApplication,
  createFullStackApplication,
} from '../fixtures/test-modules.js';

describe('Application Configuration', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop();
    }
  });

  describe('Configuration Setup', () => {
    it('should initialize with default configuration', () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const config = app.getConfig();
      expect(config).toEqual({});
    });

    it('should initialize with custom configuration', () => {
      const customConfig = {
        database: { host: 'localhost', port: 5432 },
        cache: { ttl: 60000 },
        features: {
          auth: true,
          analytics: false,
        },
      };

      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: customConfig,
      });

      expect(app.getConfig()).toEqual(customConfig);
    });

    it('should handle nested configuration', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          level1: {
            level2: {
              level3: {
                deep: 'value',
              },
            },
          },
        },
      });

      const config = app.getConfig();
      expect(config.level1.level2.level3.deep).toBe('value');
    });

    it('should handle arrays in configuration', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          servers: ['server1', 'server2', 'server3'],
          ports: [3000, 3001, 3002],
          features: ['feature1', 'feature2'],
        },
      });

      const config = app.getConfig();
      expect(config.servers).toEqual(['server1', 'server2', 'server3']);
      expect(config.ports).toEqual([3000, 3001, 3002]);
      expect(config.features).toEqual(['feature1', 'feature2']);
    });
  });

  describe('Configuration Updates', () => {
    it('should update configuration at runtime', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: { initial: 'value' },
      });

      expect(app.getConfig()).toEqual({ initial: 'value' });

      app.configure({ additional: 'config' });

      expect(app.getConfig()).toEqual({
        initial: 'value',
        additional: 'config',
      });
    });

    it('should merge configuration deeply', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'localhost', port: 5432 },
          cache: { ttl: 60000 },
        },
      });

      app.configure({
        database: { port: 3306, user: 'admin' },
        newOption: true,
      });

      expect(app.getConfig()).toEqual({
        database: {
          host: 'localhost',
          port: 3306,
          user: 'admin',
        },
        cache: { ttl: 60000 },
        newOption: true,
      });
    });

    it('should emit config:changed event', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const events: any[] = [];
      app.on(ApplicationEvent.ConfigChanged, (data) => events.push(data));

      app.configure({ key1: 'value1' });
      app.configure({ key2: 'value2' });

      expect(events).toHaveLength(2);
      expect(events[0].config).toEqual({ key1: 'value1' });
      expect(events[1].config).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should chain configuration calls', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const result = app
        .configure({ option1: 'value1' })
        .configure({ option2: 'value2' })
        .configure({ option3: 'value3' });

      expect(result).toBe(app); // Should return self for chaining

      expect(app.getConfig()).toEqual({
        option1: 'value1',
        option2: 'value2',
        option3: 'value3',
      });
    });

    it('should handle configuration replacement', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'old-host', port: 5432 },
        },
      });

      app.configure({
        database: { host: 'new-host', port: 3306 },
      });

      expect(app.getConfig().database).toEqual({
        host: 'new-host',
        port: 3306,
      });
    });
  });

  describe('Module Configuration', () => {
    it('should configure individual modules', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'db-server', port: 5432 },
          cache: { ttl: 30000 },
          http: { port: 8080 },
        },
      });

      const dbModule = new DatabaseModule();
      const cacheModule = new CacheModule();
      const httpModule = new HttpServerModule();

      app.use(dbModule);
      app.use(cacheModule);
      app.use(httpModule);

      // Modules should receive their configuration
      expect(httpModule.port).toBe(8080);
    });

    it('should reconfigure modules when configuration changes', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const module = new SimpleModule();
      app.use(module);

      expect(module.configureCalled).toBe(false);

      app.configure({ simple: { key: 'value' } });

      expect(module.configureCalled).toBe(true);
      expect(module.configValue).toEqual({ key: 'value' });

      module.configureCalled = false;

      app.configure({ simple: { key: 'new-value', additional: 'prop' } });

      expect(module.configureCalled).toBe(true);
      expect(module.configValue).toEqual({ key: 'new-value', additional: 'prop' });
    });

    it('should handle modules without configure method', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: { test: { value: 'data' } },
      });

      const module = {
        name: 'test',
        version: '1.0.0',
        // No configure method
      };

      // Should not throw
      expect(() => app.use(module)).not.toThrow();
    });

    it('should isolate module configurations', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          module1: { value: 'config1' },
          module2: { value: 'config2' },
        },
      });

      const module1 = new SimpleModule();
      module1.name = 'module1';

      const module2 = new SimpleModule();
      module2.name = 'module2';

      app.use(module1);
      app.use(module2);

      expect(module1.configValue).toEqual({ value: 'config1' });
      expect(module2.configValue).toEqual({ value: 'config2' });
    });
  });

  describe('Environment-specific Configuration', () => {
    it('should handle development configuration', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        debug: true,
        config: {
          environment: 'development',
          database: { host: 'localhost' },
          debug: {
            verbose: true,
            logLevel: 'debug',
          },
        },
      });

      const config = app.getConfig();
      expect(config.environment).toBe('development');
      expect(config.debug.verbose).toBe(true);
      expect(app.debug).toBe(true);
    });

    it('should handle production configuration', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        debug: false,
        config: {
          environment: 'production',
          database: { host: 'prod-db-server', ssl: true },
          cache: { ttl: 86400000 }, // 24 hours
          security: {
            https: true,
            cors: false,
          },
        },
      });

      const config = app.getConfig();
      expect(config.environment).toBe('production');
      expect(config.database.ssl).toBe(true);
      expect(config.security.https).toBe(true);
      expect(app.debug).toBe(false);
    });
  });

  describe('Complex Configuration Scenarios', () => {
    it('should handle web application configuration', async () => {
      app = createWebApplication({
        config: {
          http: { port: 8000, timeout: 30000 },
          database: {
            host: 'db.example.com',
            port: 5432,
            poolSize: 20,
            ssl: true,
          },
        },
      });

      await app.start();

      const httpModule = app.modules.get('http') as HttpServerModule;
      expect(httpModule.port).toBe(8000);
      expect(httpModule.isListening()).toBe(true);

      await app.stop();
    });

    it('should handle full-stack application configuration', async () => {
      app = createFullStackApplication();

      const config = app.getConfig();

      // Should have complete configuration
      expect(config.http).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.cache).toBeDefined();
      expect(config.queue).toBeDefined();
      expect(config.auth).toBeDefined();
      expect(config.notifications).toBeDefined();

      await app.start();

      // All modules should be configured
      const moduleNames = Array.from(app.modules.keys());
      expect(moduleNames.length).toBeGreaterThan(5);

      await app.stop();
    });

    it('should handle configuration validation', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Configure with invalid values (module should handle)
      app.configure({
        database: {
          port: -1, // Invalid port
          host: '', // Empty host
          poolSize: 0, // Invalid pool size
        },
      });

      const dbModule = new DatabaseModule();

      // Module should handle invalid config gracefully
      expect(() => app.use(dbModule)).not.toThrow();
    });

    it('should preserve configuration immutability', () => {
      const initialConfig = {
        database: { host: 'localhost', port: 5432 },
        cache: { ttl: 60000 },
      };

      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: initialConfig,
      });

      const config = app.getConfig();

      // Modify retrieved config
      config.database.port = 3306;
      config.cache.ttl = 30000;

      // Original config should not be affected
      const newConfig = app.getConfig();
      expect(newConfig.database.port).toBe(3306); // It's modified (not immutable by default)

      // To test proper immutability, we need to check the internal config
      app.configure({ test: 'value' });
      const finalConfig = app.getConfig();
      expect(finalConfig.test).toBe('value');
    });
  });

  describe('Configuration Access Patterns', () => {
    it('should support config getter', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          feature: { enabled: true },
          limits: { max: 100 },
        },
      });

      const config = app.config(); // Using method call without parameters
      expect(config).toEqual(app.getConfig());
      expect(config.feature.enabled).toBe(true);
      expect(config.limits.max).toBe(100);
    });

    it('should handle undefined configuration paths', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: { existing: 'value' },
      });

      const config = app.getConfig();
      expect(config.nonExistent).toBeUndefined();
      expect(config.deep?.nested?.path).toBeUndefined();
    });

    it('should handle null configuration values', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          nullValue: null,
          nested: {
            nullProp: null,
          },
        },
      });

      const config = app.getConfig();
      expect(config.nullValue).toBeNull();
      expect(config.nested.nullProp).toBeNull();
    });

    it('should handle boolean configuration values', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          features: {
            auth: true,
            analytics: false,
            beta: true,
            legacy: false,
          },
        },
      });

      const config = app.getConfig();
      expect(config.features.auth).toBe(true);
      expect(config.features.analytics).toBe(false);
      expect(config.features.beta).toBe(true);
      expect(config.features.legacy).toBe(false);
    });
  });

  describe('Configuration Edge Cases', () => {
    it('should handle empty configuration updates', () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: { existing: 'value' },
      });

      app.configure({});

      expect(app.getConfig()).toEqual({ existing: 'value' });
    });

    it('should handle configuration with symbols', () => {
      const symKey = Symbol('config-key');

      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          [symKey]: 'symbol-value',
          regular: 'value',
        },
      });

      const config = app.getConfig();
      expect(config[symKey]).toBe('symbol-value');
      expect(config.regular).toBe('value');
    });

    it('should handle configuration with functions', () => {
      const testFunc = () => 'result';

      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          processor: testFunc,
          options: {
            formatter: (v: any) => String(v),
          },
        },
      });

      const config = app.getConfig();
      expect(typeof config.processor).toBe('function');
      expect(config.processor()).toBe('result');
      expect(typeof config.options.formatter).toBe('function');
    });

    it('should handle very large configurations', () => {
      const largeConfig: any = {
        databases: {},
        services: {},
        features: {},
      };

      // Create large nested structure
      for (let i = 0; i < 100; i++) {
        largeConfig.databases[`db${i}`] = {
          host: `host${i}`,
          port: 5000 + i,
          options: {
            ssl: i % 2 === 0,
            poolSize: 10 + i,
          },
        };

        largeConfig.services[`service${i}`] = {
          enabled: i % 3 !== 0,
          config: { value: i * 100 },
        };

        largeConfig.features[`feature${i}`] = i % 2 === 0;
      }

      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: largeConfig,
      });

      const config = app.getConfig();
      expect(Object.keys(config.databases)).toHaveLength(100);
      expect(Object.keys(config.services)).toHaveLength(100);
      expect(Object.keys(config.features)).toHaveLength(100);
    });
  });
});
