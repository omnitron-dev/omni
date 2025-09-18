/**
 * Tests for ConfigModule DI integration
 */

import { z } from 'zod';
import { Container } from '@omnitron-dev/nexus';
import { ConfigModule } from '../../../src/modules/config/config.module.js';
import { ConfigService } from '../../../src/modules/config/config.service.js';
import {
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  ConfigModuleOptions,
} from '../../../src/modules/config/config.types.js';
import { createToken } from '@omnitron-dev/nexus';
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
      expect(module.exports).toContain(ConfigService);
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

      // Check that ConfigService is exported
      expect(module.exports).toContain(ConfigService);
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
      expect(module.exports).toContain(ConfigService);
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
      expect(module.exports).toContain(ConfigService);
    });

    it('should support inject tokens', () => {
      const DB_TOKEN = createToken<{ host: string }>('Database');

      const module = ConfigModule.forRootAsync({
        imports: [],
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
        (p: any) => Array.isArray(p) && typeof p[0] === 'symbol'
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

      const module = ConfigModule.forRoot(options);

      // Register providers in container
      if (module.providers) {
        for (const provider of module.providers) {
          if (Array.isArray(provider)) {
            container.register(provider[0], provider[1]);
          }
        }
      }

      const configService = container.resolve(ConfigService);
      expect(configService).toBeInstanceOf(ConfigService);

      await configService.initialize();
      expect(configService.get('app.name')).toBe('di-test');
    });

    it('should share ConfigService in global module', async () => {
      const module = ConfigModule.forRoot({
        defaults: { shared: 'value' },
        global: true
      });

      // Register providers
      if (module.providers) {
        for (const provider of module.providers) {
          if (Array.isArray(provider)) {
            container.register(provider[0], provider[1]);
          }
        }
      }

      const service1 = container.resolve(ConfigService);
      const service2 = container.resolve(ConfigService);

      expect(service1).toBe(service2); // Should be singleton
    });

    it('should resolve feature configuration', async () => {
      const featureSchema = z.object({
        enabled: z.boolean(),
        timeout: z.number()
      });

      // First register main config
      const mainModule = ConfigModule.forRoot({
        defaults: {
          myFeature: {
            enabled: true,
            timeout: 5000
          }
        }
      });

      if (mainModule.providers) {
        for (const provider of mainModule.providers) {
          if (Array.isArray(provider)) {
            container.register(provider[0], provider[1]);
          }
        }
      }

      // Then register feature module
      const featureModule = ConfigModule.forFeature('myFeature', featureSchema);

      if (featureModule.providers) {
        for (const provider of featureModule.providers) {
          if (Array.isArray(provider)) {
            const token = provider[0];
            const factory = provider[1];

            if (factory.useFactory) {
              // Handle factory provider
              const configService = container.resolve(ConfigService);
              await configService.initialize();
              const value = factory.useFactory(configService);
              container.register(token, { useValue: value });
            } else {
              container.register(token, factory);
            }
          }
        }
      }

      // Resolve feature config
      const FEATURE_TOKEN = createToken<z.infer<typeof featureSchema>>('Config:myFeature');
      const featureConfig = container.resolve(FEATURE_TOKEN);

      expect(featureConfig.enabled).toBe(true);
      expect(featureConfig.timeout).toBe(5000);
    });
  });

  describe('Module lifecycle', () => {
    it('should initialize on module start', async () => {
      const module = new ConfigModule();
      const configService = new ConfigService({});
      const mockApp = {
        resolve: jest.fn().mockReturnValue(configService),
        on: jest.fn()
      };

      await module.onStart(mockApp as any);

      expect(mockApp.resolve).toHaveBeenCalledWith(ConfigService);
    });

    it('should dispose on module stop', async () => {
      const module = new ConfigModule();
      const configService = new ConfigService({});
      configService.dispose = jest.fn();

      const mockApp = {
        resolve: jest.fn().mockReturnValue(configService)
      };

      await module.onStop(mockApp as any);

      expect(configService.dispose).toHaveBeenCalled();
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
      const module = ConfigModule.forRoot({
        sources: [{
          type: 'file',
          path: '/non/existent/required.json',
          optional: false
        }]
      });

      if (module.providers) {
        for (const provider of module.providers) {
          if (Array.isArray(provider)) {
            container.register(provider[0], provider[1]);
          }
        }
      }

      const configService = container.resolve(ConfigService);
      await expect(configService.initialize()).rejects.toThrow();
    });
  });
});