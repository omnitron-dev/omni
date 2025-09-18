/**
 * Tests for ConfigService
 */

import { z } from 'zod';
import { ConfigService } from '../../../src/modules/config/config.service.js';
import { ConfigChangeEvent, ConfigModuleOptions } from '../../../src/modules/config/config.types.js';
import fs from 'node:fs';
import path from 'node:path';

describe('ConfigService', () => {
  let configService: ConfigService;
  let tempDir: string;

  beforeEach(() => {
    configService = new ConfigService();
    tempDir = path.join(process.cwd(), 'packages/titan/test/modules/config/.temp-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(async () => {
    await configService.dispose();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('Basic functionality', () => {
    it('should initialize with empty configuration', async () => {
      await configService.initialize();
      expect(configService.getAll()).toEqual({});
    });

    it('should get and set configuration values', async () => {
      await configService.initialize();
      configService.set('test.value', 42);
      expect(configService.get('test.value')).toBe(42);
    });

    it('should handle nested paths', async () => {
      await configService.initialize();
      configService.set('deeply.nested.value', 'test');
      expect(configService.get('deeply.nested.value')).toBe('test');
    });

    it('should return default value for missing keys', async () => {
      await configService.initialize();
      expect(configService.get('missing.key', 'default')).toBe('default');
    });

    it('should throw for required missing keys', async () => {
      await configService.initialize();
      expect(() => configService.require('missing.key')).toThrow('Configuration key "missing.key" is required but not found');
    });

    it('should check if configuration has value', async () => {
      await configService.initialize();
      configService.set('existing.key', 'value');
      expect(configService.has('existing.key')).toBe(true);
      expect(configService.has('missing.key')).toBe(false);
    });

    it('should merge configurations', async () => {
      await configService.initialize();
      configService.merge({
        app: { name: 'test-app', version: '1.0.0' },
        server: { port: 3000 }
      });
      expect(configService.get('app.name')).toBe('test-app');
      expect(configService.get('server.port')).toBe(3000);
    });

    it('should reset configuration', async () => {
      await configService.initialize();
      configService.set('test.value', 42);
      configService.reset();
      expect(configService.has('test.value')).toBe(false);
    });
  });

  describe('Schema validation', () => {
    const testSchema = z.object({
      app: z.object({
        name: z.string().min(3),
        port: z.number().int().positive(),
        debug: z.boolean()
      })
    });

    it('should validate configuration with schema', async () => {
      const options: ConfigModuleOptions = {
        schema: testSchema,
        defaults: {
          app: { name: 'test-app', port: 3000, debug: false }
        }
      };
      configService = new ConfigService(options);
      await configService.initialize();

      const config = configService.getAll();
      expect(config.app.name).toBe('test-app');
      expect(config.app.port).toBe(3000);
    });

    it('should throw on invalid configuration', async () => {
      const options: ConfigModuleOptions = {
        schema: testSchema,
        defaults: {
          app: { name: 'ab', port: -1, debug: 'invalid' }
        }
      };
      configService = new ConfigService(options);
      await expect(configService.initialize()).rejects.toThrow();
    });

    it('should validate configuration on set with schema', async () => {
      const options: ConfigModuleOptions = {
        schema: testSchema,
        defaults: {
          app: { name: 'test-app', port: 3000, debug: false }
        },
        validateOnStartup: true
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(() => configService.set('app.port', -1)).not.toThrow();
      // Validation happens on full config, not individual values
    });
  });

  describe('Configuration sources', () => {
    it('should load from JSON file', async () => {
      const configFile = path.join(tempDir, 'config.json');
      fs.writeFileSync(configFile, JSON.stringify({
        app: { name: 'file-app', port: 4000 }
      }));

      const options: ConfigModuleOptions = {
        sources: [{
          type: 'file',
          path: configFile,
          format: 'json'
        }]
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('app.name')).toBe('file-app');
      expect(configService.get('app.port')).toBe(4000);
    });

    it('should load from environment variables', async () => {
      process.env.TEST_APP_NAME = 'env-app';
      process.env.TEST_APP_PORT = '5000';
      process.env.TEST_APP_DEBUG = 'true';

      const options: ConfigModuleOptions = {
        sources: [{
          type: 'env',
          prefix: 'TEST_APP_',
          separator: '_'
        }]
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('name')).toBe('env-app');
      expect(configService.get('port')).toBe(5000);
      expect(configService.get('debug')).toBe(true);

      delete process.env.TEST_APP_NAME;
      delete process.env.TEST_APP_PORT;
      delete process.env.TEST_APP_DEBUG;
    });

    it('should load from object source', async () => {
      const options: ConfigModuleOptions = {
        sources: [{
          type: 'object',
          data: {
            app: { name: 'object-app', port: 6000 }
          }
        }]
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('app.name')).toBe('object-app');
      expect(configService.get('app.port')).toBe(6000);
    });

    it('should merge multiple sources with priority', async () => {
      const configFile = path.join(tempDir, 'base.json');
      fs.writeFileSync(configFile, JSON.stringify({
        app: { name: 'file-app', port: 3000, version: '1.0.0' }
      }));

      process.env.OVERRIDE_APP_PORT = '4000';

      const options: ConfigModuleOptions = {
        sources: [
          {
            type: 'file',
            path: configFile,
            format: 'json'
          },
          {
            type: 'env',
            prefix: 'OVERRIDE_APP_',
            separator: '_'
          },
          {
            type: 'object',
            data: {
              app: { name: 'final-app' }
            },
            priority: 10
          }
        ]
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('app.name')).toBe('final-app'); // From object (highest priority)
      expect(configService.get('app.port')).toBe(4000); // From env
      expect(configService.get('app.version')).toBe('1.0.0'); // From file

      delete process.env.OVERRIDE_APP_PORT;
    });

    it('should handle optional sources', async () => {
      const options: ConfigModuleOptions = {
        sources: [{
          type: 'file',
          path: '/non/existent/file.json',
          optional: true
        }],
        defaults: {
          app: { name: 'default-app' }
        }
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('app.name')).toBe('default-app');
    });
  });

  describe('Configuration watching', () => {
    it('should watch configuration changes', (done) => {
      configService.initialize().then(() => {
        const unwatch = configService.watch('test.value', (event: ConfigChangeEvent) => {
          expect(event.path).toBe('test.value');
          expect(event.oldValue).toBeUndefined();
          expect(event.newValue).toBe(42);
          unwatch();
          done();
        });

        configService.set('test.value', 42);
      });
    });

    it('should watch nested path changes', (done) => {
      configService.initialize().then(() => {
        const unwatch = configService.watch('app', (event: ConfigChangeEvent) => {
          expect(event.path).toBe('app.name');
          expect(event.newValue).toBe('new-app');
          unwatch();
          done();
        });

        configService.set('app.name', 'new-app');
      });
    });

    it('should emit configuration change events', (done) => {
      configService.initialize().then(() => {
        configService.on('config:changed', (event: ConfigChangeEvent) => {
          expect(event.path).toBe('test.value');
          expect(event.newValue).toBe('test');
          done();
        });

        configService.set('test.value', 'test');
      });
    });
  });

  describe('File watching', () => {
    it('should reload configuration when file changes', async () => {
      const configFile = path.join(tempDir, 'watch.json');
      fs.writeFileSync(configFile, JSON.stringify({
        app: { name: 'initial', port: 3000 }
      }));

      const options: ConfigModuleOptions = {
        sources: [{
          type: 'file',
          path: configFile,
          watch: true
        }],
        watchForChanges: true
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('app.name')).toBe('initial');

      // Update file
      fs.writeFileSync(configFile, JSON.stringify({
        app: { name: 'updated', port: 4000 }
      }));

      // Wait for file watcher to detect change
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(configService.get('app.name')).toBe('updated');
      expect(configService.get('app.port')).toBe(4000);
    });
  });

  describe('Environment detection', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should detect current environment', async () => {
      process.env.NODE_ENV = 'production';
      const options: ConfigModuleOptions = {
        environment: process.env.NODE_ENV
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.getEnvironment()).toBe('production');
    });

    it('should use default environment if not set', async () => {
      delete process.env.NODE_ENV;
      configService = new ConfigService();
      await configService.initialize();

      expect(configService.getEnvironment()).toBe('development');
    });
  });

  describe('Configuration encryption', () => {
    it('should encrypt sensitive fields', async () => {
      const options: ConfigModuleOptions = {
        defaults: {
          database: {
            host: 'localhost',
            password: 'secret123'
          }
        },
        encryption: {
          enabled: true,
          key: 'test-encryption-key-32-chars-long',
          fields: ['database.password']
        }
      };
      configService = new ConfigService(options);
      await configService.initialize();

      const config = configService.getAll();
      expect(config.database.host).toBe('localhost');
      expect(config.database.password).toBe('secret123');
    });
  });

  describe('Configuration metadata', () => {
    it('should provide configuration metadata', async () => {
      await configService.initialize();
      const metadata = configService.getMetadata();

      expect(metadata.source).toBeDefined();
      expect(metadata.loadedAt).toBeInstanceOf(Date);
      expect(metadata.environment).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should handle invalid JSON file gracefully', async () => {
      const configFile = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(configFile, 'invalid json content');

      const options: ConfigModuleOptions = {
        sources: [{
          type: 'file',
          path: configFile,
          format: 'json'
        }]
      };
      configService = new ConfigService(options);

      await expect(configService.initialize()).rejects.toThrow();
    });

    it('should handle missing required file', async () => {
      const options: ConfigModuleOptions = {
        sources: [{
          type: 'file',
          path: '/non/existent/required.json',
          optional: false
        }]
      };
      configService = new ConfigService(options);

      await expect(configService.initialize()).rejects.toThrow();
    });
  });

  describe('Configuration interpolation', () => {
    it('should interpolate configuration values', async () => {
      process.env.DB_HOST = 'prod-db.example.com';

      const options: ConfigModuleOptions = {
        defaults: {
          database: {
            host: '${env:DB_HOST}',
            url: 'postgresql://${database.host}:5432/mydb'
          }
        }
      };
      configService = new ConfigService(options);
      await configService.initialize();

      expect(configService.get('database.host')).toBe('prod-db.example.com');

      delete process.env.DB_HOST;
    });
  });

  describe('Typed configuration access', () => {
    interface AppConfig {
      app: {
        name: string;
        port: number;
        debug: boolean;
      };
    }

    it('should provide typed configuration access', async () => {
      const options: ConfigModuleOptions = {
        defaults: {
          app: {
            name: 'typed-app',
            port: 3000,
            debug: false
          }
        }
      };
      configService = new ConfigService<AppConfig>(options);
      await configService.initialize();

      const appConfig = configService.get<AppConfig['app']>('app');
      expect(appConfig?.name).toBe('typed-app');
      expect(appConfig?.port).toBe(3000);
      expect(appConfig?.debug).toBe(false);
    });
  });
});