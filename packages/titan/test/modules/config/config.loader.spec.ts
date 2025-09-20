/**
 * Tests for ConfigLoader
 */

import fs from 'node:fs';
import path from 'node:path';
import { ConfigLoaderService } from '../../../src/modules/config/config-loader.service.js';
import type {
  IFileConfigSource as FileConfigSource,
  IEnvironmentConfigSource as EnvironmentConfigSource,
  IObjectConfigSource as ObjectConfigSource,
  IRemoteConfigSource as RemoteConfigSource,
} from '../../../src/modules/config/types.js';

describe('ConfigLoaderService', () => {
  let loader: ConfigLoaderService;
  let tempDir: string;

  beforeEach(() => {
    loader = new ConfigLoaderService();
    tempDir = path.join(process.cwd(), 'packages/titan/test/modules/config/.temp-loader-test');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('File source loading', () => {
    it('should load JSON file', async () => {
      const configFile = path.join(tempDir, 'config.json');
      const configData = {
        app: { name: 'test-app', version: '1.0.0' },
        server: { port: 3000 }
      };
      fs.writeFileSync(configFile, JSON.stringify(configData));

      const source: FileConfigSource = {
        type: 'file',
        path: configFile,
        format: 'json'
      };

      const result = await loader.load([source]);
      expect(result).toEqual(configData);
    });

    it('should auto-detect JSON format', async () => {
      const configFile = path.join(tempDir, 'config.json');
      const configData = { test: 'value' };
      fs.writeFileSync(configFile, JSON.stringify(configData));

      const source: FileConfigSource = {
        type: 'file',
        path: configFile
        // format not specified
      };

      const result = await loader.load([source]);
      expect(result).toEqual(configData);
    });

    it('should load .env file', async () => {
      const envFile = path.join(tempDir, '.env');
      const envContent = `
# Comment
APP_NAME=test-app
APP_PORT=3000
APP_DEBUG=true
DATABASE_URL="postgresql://localhost/mydb"
EMPTY_VALUE=
`;
      fs.writeFileSync(envFile, envContent);

      const source: FileConfigSource = {
        type: 'file',
        path: envFile,
        format: 'env'
      };

      const result = await loader.load([source]);
      expect(result.APP_NAME).toBe('test-app');
      expect(result.APP_PORT).toBe(3000);
      expect(result.APP_DEBUG).toBe(true);
      expect(result.DATABASE_URL).toBe('postgresql://localhost/mydb');
      expect(result.EMPTY_VALUE).toBe('');
    });

    it('should load .properties file', async () => {
      const propsFile = path.join(tempDir, 'config.properties');
      const propsContent = `
# Application properties
app.name=test-app
app.version=1.0.0
server.port=3000
database.host=localhost
database.port=5432
`;
      fs.writeFileSync(propsFile, propsContent);

      const source: FileConfigSource = {
        type: 'file',
        path: propsFile,
        format: 'properties'
      };

      const result = await loader.load([source]);
      expect(result.app.name).toBe('test-app');
      expect(result.app.version).toBe('1.0.0');
      expect(result.server.port).toBe(3000);
      expect(result.database.host).toBe('localhost');
      expect(result.database.port).toBe(5432);
    });

    it('should handle optional file source', async () => {
      const source: FileConfigSource = {
        type: 'file',
        path: '/non/existent/file.json',
        optional: true
      };

      const result = await loader.load([source]);
      expect(result).toEqual({});
    });

    it('should throw for missing required file', async () => {
      const source: FileConfigSource = {
        type: 'file',
        path: '/non/existent/file.json',
        optional: false
      };

      await expect(loader.load([source])).rejects.toThrow();
    });

    it('should apply transformation to file data', async () => {
      const configFile = path.join(tempDir, 'transform.json');
      fs.writeFileSync(configFile, JSON.stringify({ port: '3000', debug: 'true' }));

      const source: FileConfigSource = {
        type: 'file',
        path: configFile,
        transform: (data) => ({
          ...data,
          port: parseInt(data.port, 10),
          debug: data.debug === 'true'
        })
      };

      const result = await loader.load([source]);
      expect(result.port).toBe(3000);
      expect(result.debug).toBe(true);
    });

    it('should handle invalid JSON gracefully', async () => {
      const configFile = path.join(tempDir, 'invalid.json');
      fs.writeFileSync(configFile, 'invalid json content');

      const source: FileConfigSource = {
        type: 'file',
        path: configFile,
        format: 'json'
      };

      await expect(loader.load([source])).rejects.toThrow();
    });
  });

  describe('Environment source loading', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should load environment variables with prefix', async () => {
      process.env.APP_NAME = 'env-app';
      process.env.APP_PORT = '3000';
      process.env.APP_DEBUG = 'true';
      process.env.OTHER_VAR = 'ignored';

      const source: EnvironmentConfigSource = {
        type: 'env',
        prefix: 'APP_'
      };

      const result = await loader.load([source]);
      expect(result.name).toBe('env-app');
      expect(result.port).toBe(3000);
      expect(result.debug).toBe(true);
      expect(result.OTHER_VAR).toBeUndefined();
    });

    it('should handle nested environment variables', async () => {
      process.env.APP_DATABASE__HOST = 'localhost';
      process.env.APP_DATABASE__PORT = '5432';
      process.env.APP_CACHE__ENABLED = 'true';

      const source: EnvironmentConfigSource = {
        type: 'env',
        prefix: 'APP_',
        separator: '__'
      };

      const result = await loader.load([source]);
      expect(result.database.host).toBe('localhost');
      expect(result.database.port).toBe(5432);
      expect(result.cache.enabled).toBe(true);
    });

    it('should apply transformation to env values', async () => {
      process.env.CONFIG_PORT = '3000';
      process.env.CONFIG_HOST = 'LOCALHOST';

      const source: EnvironmentConfigSource = {
        type: 'env',
        prefix: 'CONFIG_',
        transform: (key, value) => {
          if (key.endsWith('HOST')) {
            return value.toLowerCase();
          }
          // Return undefined to keep parsed value for other keys
          return undefined;
        }
      };

      const result = await loader.load([source]);
      expect(result.port).toBe(3000);
      expect(result.host).toBe('localhost');
    });

    it('should parse env value types correctly', async () => {
      process.env.TEST_STRING = 'text';
      process.env.TEST_NUMBER = '42';
      process.env.TEST_FLOAT = '3.14';
      process.env.TEST_BOOL_TRUE = 'true';
      process.env.TEST_BOOL_FALSE = 'false';
      process.env.TEST_JSON_ARRAY = '[1,2,3]';
      process.env.TEST_JSON_OBJECT = '{"key":"value"}';

      const source: EnvironmentConfigSource = {
        type: 'env',
        prefix: 'TEST_'
      };

      const result = await loader.load([source]);
      expect(result.string).toBe('text');
      expect(result.number).toBe(42);
      expect(result.float).toBe(3.14);
      expect(result.bool_true).toBe(true);
      expect(result.bool_false).toBe(false);
      expect(result.json_array).toEqual([1, 2, 3]);
      expect(result.json_object).toEqual({ key: 'value' });
    });
  });

  describe('Object source loading', () => {
    it('should load object source directly', async () => {
      const data = {
        app: { name: 'object-app', port: 3000 },
        features: { cache: true, rateLimit: 100 }
      };

      const source: ObjectConfigSource = {
        type: 'object',
        data
      };

      const result = await loader.load([source]);
      expect(result).toEqual(data);
    });

    it('should handle priority in object sources', async () => {
      const source: ObjectConfigSource = {
        type: 'object',
        data: { test: 'value' },
        priority: 10
      };

      const result = await loader.load([source]);
      expect(result).toEqual({ test: 'value' });
    });
  });

  describe('Multiple source loading', () => {
    it('should load and merge multiple sources', async () => {
      const jsonFile = path.join(tempDir, 'base.json');
      fs.writeFileSync(jsonFile, JSON.stringify({
        app: { name: 'base-app', version: '1.0.0' },
        server: { port: 3000 }
      }));

      process.env.OVERRIDE_SERVER__PORT = '4000';

      const sources = [
        {
          type: 'file',
          path: jsonFile,
          format: 'json'
        } as FileConfigSource,
        {
          type: 'env',
          prefix: 'OVERRIDE_',
          separator: '__'
        } as EnvironmentConfigSource,
        {
          type: 'object',
          data: { app: { name: 'final-app' } }
        } as ObjectConfigSource
      ];

      const result = await loader.load(sources);
      expect(result.app.name).toBe('final-app'); // From object (last)
      expect(result.app.version).toBe('1.0.0'); // From file
      expect(result.server.port).toBe(4000); // From env

      delete process.env.OVERRIDE_SERVER__PORT;
    });

    it('should respect source priorities', async () => {
      const sources = [
        {
          type: 'object',
          data: { value: 'low' },
          priority: 1
        } as ObjectConfigSource,
        {
          type: 'object',
          data: { value: 'high' },
          priority: 10
        } as ObjectConfigSource,
        {
          type: 'object',
          data: { value: 'medium' },
          priority: 5
        } as ObjectConfigSource
      ];

      const result = await loader.load(sources);
      expect(result.value).toBe('high'); // Highest priority wins
    });

    it('should handle optional sources in loadAll', async () => {
      const validFile = path.join(tempDir, 'valid.json');
      fs.writeFileSync(validFile, JSON.stringify({ valid: true }));

      const sources = [
        {
          type: 'file',
          path: '/non/existent/optional.json',
          optional: true
        } as FileConfigSource,
        {
          type: 'file',
          path: validFile
        } as FileConfigSource
      ];

      const result = await loader.load(sources);
      expect(result.valid).toBe(true);
    });

    it('should throw if required source fails in loadAll', async () => {
      const sources = [
        {
          type: 'file',
          path: '/non/existent/required.json',
          optional: false
        } as FileConfigSource
      ];

      await expect(loader.load(sources)).rejects.toThrow();
    });
  });

  describe('Deep merge functionality', () => {
    it('should deeply merge nested objects', async () => {
      const sources = [
        {
          type: 'object',
          data: {
            database: {
              host: 'localhost',
              port: 5432,
              credentials: {
                username: 'admin',
                password: 'secret'
              }
            }
          }
        } as ObjectConfigSource,
        {
          type: 'object',
          data: {
            database: {
              port: 3306,
              credentials: {
                password: 'new-secret'
              },
              ssl: true
            }
          }
        } as ObjectConfigSource
      ];

      const result = await loader.load(sources);
      expect(result.database.host).toBe('localhost'); // Preserved from first
      expect(result.database.port).toBe(3306); // Overridden by second
      expect(result.database.credentials.username).toBe('admin'); // Preserved from first
      expect(result.database.credentials.password).toBe('new-secret'); // Overridden by second
      expect(result.database.ssl).toBe(true); // Added by second
    });

    it('should handle arrays in deep merge', async () => {
      const sources = [
        {
          type: 'object',
          data: {
            features: ['feature1', 'feature2'],
            settings: { timeout: 30 }
          }
        } as ObjectConfigSource,
        {
          type: 'object',
          data: {
            features: ['feature3', 'feature4'],
            settings: { retries: 3 }
          }
        } as ObjectConfigSource
      ];

      const result = await loader.load(sources);
      expect(result.features).toEqual(['feature3', 'feature4']); // Arrays are replaced
      expect(result.settings.timeout).toBe(30); // Preserved
      expect(result.settings.retries).toBe(3); // Added
    });
  });

  describe('Error handling', () => {
    it('should provide meaningful error for unsupported format', async () => {
      const source = {
        type: 'unsupported' as any,
        data: {}
      };

      await expect(loader.load(source as any)).rejects.toThrow('Unsupported configuration source type');
    });

    it('should handle file read errors', async () => {
      const source: FileConfigSource = {
        type: 'file',
        path: tempDir, // Directory, not a file
        format: 'json'
      };

      await expect(loader.load([source])).rejects.toThrow();
    });
  });
});