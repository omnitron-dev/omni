/**
 * Tests for Configuration Utilities
 */

import { z } from 'zod';
import {
  ConfigPath,
  ConfigValidator,
  ConfigEncryption,
  ConfigInterpolation,
  ConfigDiff,
  ConfigEnvironment,
  createConfigToken,
  getValueByPath,
  setValueByPath,
  flattenObject,
  expandObject,
} from '../../../src/modules/config/config.utils.js';
import fs from 'node:fs';
import path from 'node:path';

describe('ConfigPath', () => {
  describe('toArray and fromArray', () => {
    it('should convert dot-notation to array and back', () => {
      const path = 'app.database.host';
      const array = ConfigPath.toArray(path);
      expect(array).toEqual(['app', 'database', 'host']);
      expect(ConfigPath.fromArray(array)).toBe(path);
    });

    it('should handle single-level paths', () => {
      expect(ConfigPath.toArray('key')).toEqual(['key']);
      expect(ConfigPath.fromArray(['key'])).toBe('key');
    });

    it('should handle empty path', () => {
      expect(ConfigPath.toArray('')).toEqual(['']);
      expect(ConfigPath.fromArray([])).toBe('');
    });
  });

  describe('getValue', () => {
    const testObj = {
      app: {
        name: 'test',
        database: {
          host: 'localhost',
          port: 5432
        }
      },
      features: ['feature1', 'feature2']
    };

    it('should get nested values', () => {
      expect(ConfigPath.getValue(testObj, 'app.name')).toBe('test');
      expect(ConfigPath.getValue(testObj, 'app.database.host')).toBe('localhost');
      expect(ConfigPath.getValue(testObj, 'app.database.port')).toBe(5432);
    });

    it('should get array values', () => {
      expect(ConfigPath.getValue(testObj, 'features')).toEqual(['feature1', 'feature2']);
    });

    it('should return undefined for non-existent paths', () => {
      expect(ConfigPath.getValue(testObj, 'app.missing')).toBeUndefined();
      expect(ConfigPath.getValue(testObj, 'missing.nested.path')).toBeUndefined();
    });

    it('should handle null/undefined objects', () => {
      expect(ConfigPath.getValue(null, 'any.path')).toBeUndefined();
      expect(ConfigPath.getValue(undefined, 'any.path')).toBeUndefined();
    });
  });

  describe('setValue', () => {
    it('should set nested values', () => {
      const obj: any = {};
      ConfigPath.setValue(obj, 'app.name', 'test');
      ConfigPath.setValue(obj, 'app.database.port', 5432);

      expect(obj.app.name).toBe('test');
      expect(obj.app.database.port).toBe(5432);
    });

    it('should overwrite existing values', () => {
      const obj = { app: { name: 'old' } };
      ConfigPath.setValue(obj, 'app.name', 'new');
      expect(obj.app.name).toBe('new');
    });

    it('should create nested structure as needed', () => {
      const obj: any = {};
      ConfigPath.setValue(obj, 'deeply.nested.structure.value', 42);
      expect(obj.deeply.nested.structure.value).toBe(42);
    });
  });

  describe('deleteValue', () => {
    it('should delete existing values', () => {
      const obj = {
        app: {
          name: 'test',
          port: 3000
        }
      };

      const result = ConfigPath.deleteValue(obj, 'app.port');
      expect(result).toBe(true);
      expect(obj.app.port).toBeUndefined();
      expect(obj.app.name).toBe('test');
    });

    it('should return false for non-existent paths', () => {
      const obj = { app: {} };
      const result = ConfigPath.deleteValue(obj, 'app.missing');
      expect(result).toBe(false);
    });
  });

  describe('hasValue', () => {
    it('should check if path exists', () => {
      const obj = {
        app: {
          name: 'test',
          enabled: false,
          count: 0,
          nothing: null
        }
      };

      expect(ConfigPath.hasValue(obj, 'app.name')).toBe(true);
      expect(ConfigPath.hasValue(obj, 'app.enabled')).toBe(true);
      expect(ConfigPath.hasValue(obj, 'app.count')).toBe(true);
      expect(ConfigPath.hasValue(obj, 'app.nothing')).toBe(true);
      expect(ConfigPath.hasValue(obj, 'app.missing')).toBe(false);
    });
  });

  describe('getAllPaths', () => {
    it('should get all paths in object', () => {
      const obj = {
        app: {
          name: 'test',
          database: {
            host: 'localhost',
            port: 5432
          }
        },
        features: ['f1', 'f2'],
        enabled: true
      };

      const paths = ConfigPath.getAllPaths(obj);
      expect(paths).toContain('app.name');
      expect(paths).toContain('app.database.host');
      expect(paths).toContain('app.database.port');
      expect(paths).toContain('features');
      expect(paths).toContain('enabled');
    });

    it('should handle empty object', () => {
      expect(ConfigPath.getAllPaths({})).toEqual([]);
    });

    it('should handle arrays as leaf nodes', () => {
      const obj = { items: [1, 2, 3], nested: { array: ['a', 'b'] } };
      const paths = ConfigPath.getAllPaths(obj);
      expect(paths).toEqual(['items', 'nested.array']);
    });
  });
});

describe('ConfigValidator', () => {
  describe('validate', () => {
    const schema = z.object({
      name: z.string().min(3),
      port: z.number().positive(),
      enabled: z.boolean()
    });

    it('should validate valid data', () => {
      const result = ConfigValidator.validate(
        { name: 'test', port: 3000, enabled: true },
        schema
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        name: 'test',
        port: 3000,
        enabled: true
      });
    });

    it('should return errors for invalid data', () => {
      const result = ConfigValidator.validate(
        { name: 'ab', port: -1, enabled: 'yes' },
        schema
      );

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should handle validation exceptions', () => {
      const badSchema = null as any;
      const result = ConfigValidator.validate({ test: 'data' }, badSchema);

      expect(result.success).toBe(false);
      expect(result.warnings).toBeDefined();
    });
  });

  describe('validatePartial', () => {
    const schema = z.object({
      name: z.string(),
      port: z.number(),
      required: z.string()
    });

    it('should validate partial data', () => {
      const result = ConfigValidator.validatePartial(
        { name: 'test' },
        schema
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ name: 'test' });
    });
  });

  describe('formatErrors', () => {
    it('should format validation errors', () => {
      const errors: z.ZodIssue[] = [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['app', 'name'],
          message: 'Expected string, received number'
        },
        {
          code: 'too_small',
          minimum: 1,
          type: 'number',
          inclusive: true,
          exact: false,
          path: ['port'],
          message: 'Number must be greater than or equal to 1'
        }
      ];

      const formatted = ConfigValidator.formatErrors(errors);
      expect(formatted).toContain('app.name: Expected string, received number');
      expect(formatted).toContain('port: Number must be greater than or equal to 1');
    });
  });
});

describe('ConfigEncryption', () => {
  const password = 'test-password-123';

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt strings', () => {
      const original = 'sensitive-data';
      const encrypted = ConfigEncryption.encrypt(original, password);

      expect(encrypted).not.toBe(original);
      // Check for valid base64 pattern (with or without padding)
      expect(encrypted).toMatch(/^[A-Za-z0-9+/]+=*$/);

      const decrypted = ConfigEncryption.decrypt(encrypted, password);
      expect(decrypted).toBe(original);
    });

    it('should produce different ciphertext for same plaintext', () => {
      const original = 'test-data';
      const encrypted1 = ConfigEncryption.encrypt(original, password);
      const encrypted2 = ConfigEncryption.encrypt(original, password);

      expect(encrypted1).not.toBe(encrypted2); // Different due to random IV/salt
      expect(ConfigEncryption.decrypt(encrypted1, password)).toBe(original);
      expect(ConfigEncryption.decrypt(encrypted2, password)).toBe(original);
    });

    it('should fail with wrong password', () => {
      const encrypted = ConfigEncryption.encrypt('data', password);
      expect(() => ConfigEncryption.decrypt(encrypted, 'wrong-password')).toThrow();
    });
  });

  describe('encryptPaths', () => {
    it('should encrypt specific paths in object', () => {
      const obj = {
        database: {
          host: 'localhost',
          username: 'admin',
          password: 'secret123'
        },
        api: {
          key: 'api-secret'
        }
      };

      const encrypted = ConfigEncryption.encryptPaths(
        obj,
        ['database.password', 'api.key'],
        password
      );

      expect(encrypted.database.host).toBe('localhost');
      expect(encrypted.database.username).toBe('admin');
      expect(encrypted.database.password).toMatch(/^encrypted:/);
      expect(encrypted.api.key).toMatch(/^encrypted:/);

      // Original object should not be modified
      expect(obj.database.password).toBe('secret123');
    });

    it('should skip non-existent paths', () => {
      const obj = { app: { name: 'test' } };
      const encrypted = ConfigEncryption.encryptPaths(
        obj,
        ['missing.path'],
        password
      );

      expect(encrypted).toEqual(obj);
    });
  });

  describe('decryptPaths', () => {
    it('should decrypt encrypted values in object', () => {
      const original = {
        database: {
          host: 'localhost',
          password: 'secret123'
        }
      };

      const encrypted = ConfigEncryption.encryptPaths(
        original,
        ['database.password'],
        password
      );

      const decrypted = ConfigEncryption.decryptPaths(encrypted, password);

      expect(decrypted.database.password).toBe('secret123');
      expect(decrypted.database.host).toBe('localhost');
    });

    it('should handle decryption errors gracefully', () => {
      const obj = {
        value: 'encrypted:invalid-base64-data'
      };

      const result = ConfigEncryption.decryptPaths(obj, password);
      expect(result.value).toBe('encrypted:invalid-base64-data'); // Unchanged
    });
  });
});

describe('ConfigInterpolation', () => {
  describe('interpolate', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should interpolate string values', () => {
      const context = {
        app: { name: 'test-app', version: '1.0.0' },
        server: { port: 3000 }
      };

      const value = 'App ${app.name} v${app.version} on port ${server.port}';
      const result = ConfigInterpolation.interpolate(value, context);

      expect(result).toBe('App test-app v1.0.0 on port 3000');
    });

    it('should interpolate environment variables', () => {
      process.env.DB_HOST = 'prod-db.example.com';
      process.env.DB_PORT = '5432';

      const value = 'postgresql://${env:DB_HOST}:${env:DB_PORT}/mydb';
      const result = ConfigInterpolation.interpolate(value, {});

      expect(result).toBe('postgresql://prod-db.example.com:5432/mydb');
    });

    it('should interpolate file content', () => {
      const tempFile = path.join(process.cwd(), 'packages/titan/test/modules/config/test-secret.txt');
      fs.writeFileSync(tempFile, 'file-secret-value');

      const value = `Secret: \${file:${tempFile}}`;
      const result = ConfigInterpolation.interpolate(value, {});

      expect(result).toBe('Secret: file-secret-value');

      fs.unlinkSync(tempFile);
    });

    it('should interpolate nested objects', () => {
      const context = { name: 'test', port: 3000 };
      const config = {
        app: {
          title: '${name} application',
          url: 'http://localhost:${port}'
        },
        array: ['${name}', '${port}']
      };

      const result = ConfigInterpolation.interpolate(config, context);

      expect(result.app.title).toBe('test application');
      expect(result.app.url).toBe('http://localhost:3000');
      expect(result.array).toEqual(['test', '3000']);
    });

    it('should leave unmatched patterns unchanged', () => {
      const value = '${missing.value} and ${env:MISSING_VAR}';
      const result = ConfigInterpolation.interpolate(value, {});

      expect(result).toBe('${missing.value} and ${env:MISSING_VAR}');
    });
  });
});

describe('ConfigDiff', () => {
  describe('diff', () => {
    it('should detect added values', () => {
      const oldConfig = { app: { name: 'test' } };
      const newConfig = { app: { name: 'test', version: '1.0.0' } };

      const changes = ConfigDiff.diff(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe('app.version');
      expect(changes[0].oldValue).toBeUndefined();
      expect(changes[0].newValue).toBe('1.0.0');
    });

    it('should detect modified values', () => {
      const oldConfig = { app: { port: 3000 } };
      const newConfig = { app: { port: 4000 } };

      const changes = ConfigDiff.diff(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe('app.port');
      expect(changes[0].oldValue).toBe(3000);
      expect(changes[0].newValue).toBe(4000);
    });

    it('should detect removed values', () => {
      const oldConfig = { app: { name: 'test', debug: true } };
      const newConfig = { app: { name: 'test' } };

      const changes = ConfigDiff.diff(oldConfig, newConfig);

      expect(changes).toHaveLength(1);
      expect(changes[0].path).toBe('app.debug');
      expect(changes[0].oldValue).toBe(true);
      expect(changes[0].newValue).toBeUndefined();
    });

    it('should handle complex nested changes', () => {
      const oldConfig = {
        database: {
          host: 'localhost',
          credentials: { username: 'admin', password: 'old' }
        }
      };
      const newConfig = {
        database: {
          host: 'remote',
          credentials: { username: 'admin', password: 'new' }
        }
      };

      const changes = ConfigDiff.diff(oldConfig, newConfig);

      expect(changes).toHaveLength(2);
      const hostChange = changes.find(c => c.path === 'database.host');
      const passChange = changes.find(c => c.path === 'database.credentials.password');

      expect(hostChange?.oldValue).toBe('localhost');
      expect(hostChange?.newValue).toBe('remote');
      expect(passChange?.oldValue).toBe('old');
      expect(passChange?.newValue).toBe('new');
    });

    it('should handle empty configs', () => {
      expect(ConfigDiff.diff({}, {})).toHaveLength(0);
      expect(ConfigDiff.diff({ a: 1 }, { a: 1 })).toHaveLength(0);
    });
  });
});

describe('ConfigEnvironment', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  describe('environment detection', () => {
    it('should get current environment', () => {
      process.env.NODE_ENV = 'production';
      expect(ConfigEnvironment.getCurrent()).toBe('production');

      process.env.NODE_ENV = 'test';
      expect(ConfigEnvironment.getCurrent()).toBe('test');
    });

    it('should default to development', () => {
      delete process.env.NODE_ENV;
      expect(ConfigEnvironment.getCurrent()).toBe('development');
    });

    it('should check environment types', () => {
      process.env.NODE_ENV = 'production';
      expect(ConfigEnvironment.isProduction()).toBe(true);
      expect(ConfigEnvironment.isDevelopment()).toBe(false);
      expect(ConfigEnvironment.isTest()).toBe(false);
      expect(ConfigEnvironment.isStaging()).toBe(false);

      process.env.NODE_ENV = 'development';
      expect(ConfigEnvironment.isProduction()).toBe(false);
      expect(ConfigEnvironment.isDevelopment()).toBe(true);

      process.env.NODE_ENV = 'test';
      expect(ConfigEnvironment.isTest()).toBe(true);

      process.env.NODE_ENV = 'staging';
      expect(ConfigEnvironment.isStaging()).toBe(true);
    });
  });

  describe('getConfigFile', () => {
    it('should generate environment-specific config file path', () => {
      const basePath = '/app/config';

      expect(ConfigEnvironment.getConfigFile(basePath, 'production'))
        .toBe('/app/config/config.production.json');

      expect(ConfigEnvironment.getConfigFile(basePath, 'development'))
        .toBe('/app/config/config.development.json');
    });

    it('should use current environment if not specified', () => {
      process.env.NODE_ENV = 'test';
      const basePath = '/app/config';

      expect(ConfigEnvironment.getConfigFile(basePath))
        .toBe('/app/config/config.test.json');
    });
  });
});

describe('Utility functions', () => {
  describe('createConfigToken', () => {
    it('should create a configuration token', () => {
      const token = createConfigToken('database');
      expect(typeof token).toBe('symbol');
      expect(token.toString()).toContain('config:database');
    });
  });

  describe('getValueByPath', () => {
    it('should get value using ConfigPath', () => {
      const obj = { app: { name: 'test' } };
      expect(getValueByPath(obj, 'app.name')).toBe('test');
    });
  });

  describe('setValueByPath', () => {
    it('should set value using ConfigPath', () => {
      const obj: any = {};
      setValueByPath(obj, 'app.name', 'test');
      expect(obj.app.name).toBe('test');
    });
  });

  describe('flattenObject', () => {
    it('should flatten nested object', () => {
      const nested = {
        app: {
          name: 'test',
          database: {
            host: 'localhost',
            port: 5432
          }
        },
        enabled: true
      };

      const flat = flattenObject(nested);

      expect(flat).toEqual({
        'app.name': 'test',
        'app.database.host': 'localhost',
        'app.database.port': 5432,
        'enabled': true
      });
    });

    it('should handle arrays and dates as values', () => {
      const obj = {
        items: [1, 2, 3],
        date: new Date('2024-01-01'),
        nested: { array: ['a', 'b'] }
      };

      const flat = flattenObject(obj);

      expect(flat['items']).toEqual([1, 2, 3]);
      expect(flat['date']).toBeInstanceOf(Date);
      expect(flat['nested.array']).toEqual(['a', 'b']);
    });
  });

  describe('expandObject', () => {
    it('should expand flattened object', () => {
      const flat = {
        'app.name': 'test',
        'app.database.host': 'localhost',
        'app.database.port': 5432,
        'enabled': true
      };

      const expanded = expandObject(flat);

      expect(expanded).toEqual({
        app: {
          name: 'test',
          database: {
            host: 'localhost',
            port: 5432
          }
        },
        enabled: true
      });
    });

    it('should be inverse of flattenObject', () => {
      const original = {
        deep: {
          nested: {
            structure: {
              value: 42,
              text: 'test'
            }
          }
        }
      };

      const flattened = flattenObject(original);
      const expanded = expandObject(flattened);

      expect(expanded).toEqual(original);
    });
  });
});