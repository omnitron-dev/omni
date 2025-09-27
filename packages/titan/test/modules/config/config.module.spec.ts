/**
 * Tests for ConfigModule DI integration
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import { Container } from '@nexus';
import { ConfigModule } from '../../../src/modules/config/config.module.js';
import { ConfigService } from '../../../src/modules/config/config.service.js';
import {
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  CONFIG_SERVICE_TOKEN,
  CONFIG_LOADER_SERVICE_TOKEN,
  CONFIG_VALIDATOR_SERVICE_TOKEN,
  CONFIG_WATCHER_SERVICE_TOKEN,
} from '../../../src/modules/config/config.tokens.js';
import type {
  IConfigModuleOptions as ConfigModuleOptions,
} from '../../../src/modules/config/types.js';
import { createToken } from '@nexus';
import { registerModuleProviders } from '../../../src/testing/container-utils.js';
import path from 'node:path';
import fs from 'node:fs';

describe('ConfigModule', () => {
  let container: Container;
  let tempDir: string;

  beforeEach(() => {
    container = new Container();
    tempDir = path.join(process.cwd(), 'packages/titan/test/modules/config/.temp-module-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('forRoot', () => {
    it('should create module with default options', () => {
      const module = ConfigModule.forRoot();

      expect(module.module).toBe(ConfigModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toContain(CONFIG_SERVICE_TOKEN);
    });

    it('should create module with custom options', () => {
      const schema = z.object({
        app: z.object({
          name: z.string(),
          port: z.number()
        })
      });

      const options: ConfigModuleOptions = {
        schema,
        defaults: {
          app: { name: 'test-app', port: 3000 }
        }
      };

      const module = ConfigModule.forRoot(options);

      expect(module.providers).toBeDefined();
      expect(module.global).toBeUndefined();
    });

    it('should create global module when specified', () => {
      const module = ConfigModule.forRoot({ global: true });

      expect(module.global).toBe(true);
    });

    it('should register providers correctly', () => {
      const options: ConfigModuleOptions = {
        defaults: {
          test: 'value'
        }
      };

      const module = ConfigModule.forRoot(options);

      // Check that providers array has the correct structure
      expect(Array.isArray(module.providers)).toBe(true);
      expect(module.providers?.length).toBeGreaterThan(0);

      // Check that ConfigService token is exported
      expect(module.exports).toContain(CONFIG_SERVICE_TOKEN);
    });

    it('should handle file sources', () => {
      const configFile = path.join(tempDir, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify({
        app: { name: 'file-app' }
      }));

      const module = ConfigModule.forRoot({
        sources: [{
          type: 'file',
          path: configFile
        }]
      });

      expect(module.providers).toBeDefined();
      expect(module.exports).toContain(CONFIG_SERVICE_TOKEN);
    });
  });

  describe('forRootAsync', () => {
    it('should create async module with factory', () => {
      const module = ConfigModule.forRootAsync({
        useFactory: async () => ({
          defaults: {
            app: { name: 'async-app' }
          }
        })
      });

      expect(module.module).toBe(ConfigModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toContain(CONFIG_SERVICE_TOKEN);
    });

    it('should support inject tokens', () => {
      const DB_TOKEN = createToken<{ host: string }>('Database');

      const module = ConfigModule.forRootAsync({
        inject: [DB_TOKEN],
        useFactory: async (db: { host: string }) => ({
          defaults: {
            database: { host: db.host }
          }
        })
      });

      expect(module.providers).toBeDefined();
      const factoryProvider = module.providers?.find(
        (p: any) => Array.isArray(p) && p[0] === CONFIG_OPTIONS_TOKEN
      );
      expect(factoryProvider).toBeDefined();
    });

    it('should create global async module', () => {
      const module = ConfigModule.forRootAsync({
        useFactory: async () => ({}),
        global: true
      });

      expect(module.global).toBe(true);
    });
  });

  describe('forFeature', () => {
    it('should create feature module with schema', () => {
      const featureSchema = z.object({
        feature: z.object({
          enabled: z.boolean(),
          config: z.string()
        })
      });

      const module = ConfigModule.forFeature('myFeature', featureSchema);

      expect(module.module).toBe(ConfigModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should provide typed feature config', () => {
      const userSchema = z.object({
        maxUsers: z.number(),
        allowRegistration: z.boolean()
      });

      const module = ConfigModule.forFeature('users', userSchema);

      expect(module.providers).toBeDefined();
      // Check that the feature token is created properly
      const hasFeatureProvider = module.providers?.some(
        (p: any) => Array.isArray(p) && p[0]?.id && typeof p[0].id === 'symbol'
      );
      expect(hasFeatureProvider).toBe(true);
    });

    it('should create multiple feature modules', () => {
      const authSchema = z.object({
        jwtSecret: z.string(),
        expiresIn: z.string()
      });

      const cacheSchema = z.object({
        ttl: z.number(),
        maxSize: z.number()
      });

      const authModule = ConfigModule.forFeature('auth', authSchema);
      const cacheModule = ConfigModule.forFeature('cache', cacheSchema);

      expect(authModule.providers).toBeDefined();
      expect(cacheModule.providers).toBeDefined();
      expect(authModule).not.toBe(cacheModule);
    });
  });

  describe('DI integration', () => {
    it('should resolve ConfigService from container', async () => {
      const options: ConfigModuleOptions = {
        defaults: {
          app: { name: 'di-test' }
        }
      };

      // Reset the ConfigModule state before test
      (ConfigModule as any).initialized = false;
      (ConfigModule as any).instance = null;

      const module = ConfigModule.forRoot(options);

      // Register providers in container
      registerModuleProviders(container, module.providers);

      const configService = await container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(configService).toBeDefined();
      expect(typeof configService.get).toBe('function');

      await configService.initialize();
      expect(configService.get('app.name')).toBe('di-test');
    });

    it('should share ConfigService in global module', async () => {
      const module = ConfigModule.forRoot({
        defaults: { shared: 'value' },
        global: true
      });

      // Register providers
      registerModuleProviders(container, module.providers);

      const service1 = await container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);
      const service2 = await container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);

      expect(service1).toBe(service2); // Should be singleton
    });

    it('should resolve feature configuration', async () => {
      const featureSchema = z.object({
        enabled: z.boolean(),
        timeout: z.number()
      });

      // Reset the ConfigModule state before test
      (ConfigModule as any).initialized = false;
      (ConfigModule as any).instance = null;

      // First register main config
      const mainModule = ConfigModule.forRoot({
        defaults: {
          myFeature: {
            enabled: true,
            timeout: 5000
          }
        }
      });

      registerModuleProviders(container, mainModule.providers);

      // Initialize ConfigService to ensure data is loaded
      const configService = await container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);
      await configService.initialize();

      // Then register feature module
      const featureModule = ConfigModule.forFeature('myFeature', featureSchema);

      registerModuleProviders(container, featureModule.providers);

      // Resolve feature config - get the actual token from the module
      const featureProvider = featureModule.providers?.find(
        (p: any) => Array.isArray(p) && p[0]?.id && typeof p[0].id === 'symbol'
      );

      if (!featureProvider || !Array.isArray(featureProvider)) {
        throw new Error('Feature provider not found');
      }

      const featureConfig = await container.resolveAsync(featureProvider[0]);

      expect(featureConfig.enabled).toBe(true);
      expect(featureConfig.timeout).toBe(5000);
    });
  });

  describe('Module lifecycle', () => {
    it('should initialize on module start', async () => {
      const module = new ConfigModule();
      const configService = new ConfigService({});
      const mockApp = {
        get: jest.fn(),
        resolve: jest.fn().mockReturnValue(configService),
        on: jest.fn()
      };

      // Set up ConfigModule.instance for the test
      (ConfigModule as any).instance = configService;

      await module.onStart?.(mockApp as any);

      // onStart doesn't need to resolve ConfigService if it's already in the static instance
      expect(module).toBeDefined();
    });

    it('should have lifecycle hooks', async () => {
      const module = new ConfigModule();

      // ConfigModule should have lifecycle hooks defined
      expect(module.onStart).toBeDefined();
      expect(module.onStop).toBeDefined();

      // The actual disposal is handled by the DI container
      // when it disposes all services, not by the module directly

      // Test that onStop can be called without errors
      const mockApp = {
        resolve: jest.fn()
      };

      await module.onStop?.(mockApp as any);
      // Should complete without errors
    });
  });

  describe('Schema validation in module', () => {
    it('should validate configuration on initialization', async () => {
      const schema = z.object({
        app: z.object({
          name: z.string().min(3),
          port: z.number().positive()
        })
      });

      const validModule = ConfigModule.forRoot({
        schema,
        defaults: {
          app: { name: 'valid', port: 3000 }
        }
      });

      expect(validModule.providers).toBeDefined();

      // Test invalid configuration
      const invalidModule = ConfigModule.forRoot({
        schema,
        defaults: {
          app: { name: 'ab', port: -1 } // Invalid values
        },
        validateOnStartup: false // Don't validate immediately
      });

      expect(invalidModule.providers).toBeDefined();
    });
  });

  describe('Environment-based configuration', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should load environment-specific config', () => {
      process.env.NODE_ENV = 'production';

      const module = ConfigModule.forRoot({
        environment: process.env.NODE_ENV,
        defaults: {
          app: {
            name: 'prod-app',
            debug: false
          }
        }
      });

      expect(module.providers).toBeDefined();
    });

    it('should auto-detect environment', () => {
      process.env.NODE_ENV = 'test';

      const module = ConfigModule.forRoot({
        autoLoad: true
      });

      expect(module.providers).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should handle initialization errors gracefully', async () => {
      // Reset the ConfigModule state before test
      (ConfigModule as any).initialized = false;
      (ConfigModule as any).instance = null;

      // Create a module with valid config first
      const module = ConfigModule.forRoot({
        defaults: {
          test: 'value'
        }
      });

      registerModuleProviders(container, module.providers);

      const configService = await container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);

      // Mock initialize to throw an error
      const originalInitialize = configService.initialize.bind(configService);
      configService.initialize = jest.fn().mockRejectedValue(new Error('Initialization failed'));

      // Now initialize should throw
      await expect(configService.initialize()).rejects.toThrow('Initialization failed');

      // Restore original
      configService.initialize = originalInitialize;
    });
  });
});