import { describe, expect, it } from 'vitest';
import * as yaml from 'js-yaml';
import * as TOML from '@iarna/toml';
import { Environment } from '../../../src/core/environment';

describe('Environment Format Conversion', () => {
  describe('toJSON', () => {
    it('should convert simple config to JSON', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar', count: 42 },
      });

      const json = env.toJSON();

      expect(json).toEqual({ foo: 'bar', count: 42 });
      expect(typeof json).toBe('object');
    });

    it('should handle nested objects in JSON', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          database: {
            host: 'localhost',
            port: 5432,
            credentials: {
              username: 'admin',
              password: 'secret',
            },
          },
        },
      });

      const json = env.toJSON();

      expect(json.database.host).toBe('localhost');
      expect(json.database.credentials.username).toBe('admin');
    });

    it('should handle arrays in JSON', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          servers: ['server1', 'server2', 'server3'],
          ports: [8080, 8081, 8082],
        },
      });

      const json = env.toJSON();

      expect(Array.isArray(json.servers)).toBe(true);
      expect(json.servers).toHaveLength(3);
      expect(json.ports[1]).toBe(8081);
    });

    it('should handle mixed data types in JSON', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          string: 'hello',
          number: 123,
          boolean: true,
          nullValue: null,
          array: [1, 'two', false],
        },
      });

      const json = env.toJSON();

      expect(json.string).toBe('hello');
      expect(json.number).toBe(123);
      expect(json.boolean).toBe(true);
      expect(json.nullValue).toBe(null);
      expect(json.array).toEqual([1, 'two', false]);
    });

    it('should handle empty config in JSON', () => {
      const env = Environment.create({
        name: 'test',
        config: {},
      });

      const json = env.toJSON();

      expect(json).toEqual({});
    });
  });

  describe('toYAML', () => {
    it('should convert simple config to YAML', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar', count: 42 },
      });

      const yamlStr = env.toYAML();

      expect(yamlStr).toContain('foo: bar');
      expect(yamlStr).toContain('count: 42');
      expect(typeof yamlStr).toBe('string');
    });

    it('should handle nested objects in YAML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          database: {
            host: 'localhost',
            port: 5432,
          },
        },
      });

      const yamlStr = env.toYAML();

      expect(yamlStr).toContain('database:');
      expect(yamlStr).toContain('host: localhost');
      expect(yamlStr).toContain('port: 5432');
    });

    it('should handle arrays in YAML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          servers: ['server1', 'server2', 'server3'],
        },
      });

      const yamlStr = env.toYAML();

      expect(yamlStr).toContain('servers:');
      expect(yamlStr).toContain('server1');
      expect(yamlStr).toContain('server2');
    });

    it('should produce valid YAML that can be parsed back', () => {
      const config = {
        app: { name: 'TestApp', version: '1.0.0' },
        features: ['auth', 'api', 'admin'],
      };

      const env = Environment.create({
        name: 'test',
        config,
      });

      const yamlStr = env.toYAML();
      const parsed = yaml.load(yamlStr);

      expect(parsed).toEqual(config);
    });

    it('should handle empty config in YAML', () => {
      const env = Environment.create({
        name: 'test',
        config: {},
      });

      const yamlStr = env.toYAML();

      expect(yamlStr).toBe('{}\n');
    });
  });

  describe('toTOML', () => {
    it('should convert simple config to TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar', count: 42 },
      });

      const tomlStr = env.toTOML();

      expect(tomlStr).toContain('foo = "bar"');
      expect(tomlStr).toContain('count = 42');
      expect(typeof tomlStr).toBe('string');
    });

    it('should handle nested objects in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          database: {
            host: 'localhost',
            port: 5432,
          },
        },
      });

      const tomlStr = env.toTOML();

      expect(tomlStr).toContain('[database]');
      expect(tomlStr).toContain('host = "localhost"');
      // @iarna/toml may format numbers with underscores (5_432)
      expect(tomlStr).toMatch(/port = (5432|5_432)/);
    });

    it('should handle arrays in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          servers: ['server1', 'server2', 'server3'],
        },
      });

      const tomlStr = env.toTOML();

      expect(tomlStr).toContain('servers');
      expect(tomlStr).toContain('server1');
      expect(tomlStr).toContain('server2');
    });

    it('should produce valid TOML that can be parsed back', () => {
      const config = {
        title: 'Test Config',
        count: 100,
        enabled: true,
      };

      const env = Environment.create({
        name: 'test',
        config,
      });

      const tomlStr = env.toTOML();
      const parsed = TOML.parse(tomlStr);

      expect(parsed).toEqual(config);
    });

    it('should handle Date objects in TOML', () => {
      const testDate = new Date('2024-01-15T10:30:00Z');
      const env = Environment.create({
        name: 'test',
        config: {
          timestamp: testDate,
        },
      });

      const tomlStr = env.toTOML();
      const parsed = TOML.parse(tomlStr);

      expect(parsed.timestamp).toBeInstanceOf(Date);
      expect(parsed.timestamp.toISOString()).toBe(testDate.toISOString());
    });

    it('should handle RegExp as string in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          pattern: /test\d+/gi,
        },
      });

      const tomlStr = env.toTOML();
      const parsed = TOML.parse(tomlStr);

      expect(parsed.pattern).toBe('/test\\d+/gi');
    });

    it('should filter out undefined values in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          defined: 'value',
          undefined: undefined,
          nested: {
            also_defined: 'value',
            also_undefined: undefined,
          },
        },
      });

      const tomlStr = env.toTOML();

      expect(tomlStr).toContain('defined = "value"');
      expect(tomlStr).not.toContain('undefined');
      expect(tomlStr).not.toContain('also_undefined');
    });

    it('should handle empty config in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {},
      });

      const tomlStr = env.toTOML();

      expect(tomlStr).toBe('');
    });

    it('should handle deeply nested objects in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          level1: {
            level2: {
              level3: {
                value: 'deep',
              },
            },
          },
        },
      });

      const tomlStr = env.toTOML();

      expect(tomlStr).toContain('[level1.level2.level3]');
      expect(tomlStr).toContain('value = "deep"');
    });

    it('should handle mixed arrays in TOML', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          numbers: [1, 2, 3],
          strings: ['a', 'b', 'c'],
          booleans: [true, false, true],
        },
      });

      const tomlStr = env.toTOML();
      const parsed = TOML.parse(tomlStr);

      expect(parsed.numbers).toEqual([1, 2, 3]);
      expect(parsed.strings).toEqual(['a', 'b', 'c']);
      expect(parsed.booleans).toEqual([true, false, true]);
    });
  });

  describe('Format roundtrip tests', () => {
    it('should survive JSON roundtrip', () => {
      const config = {
        app: { name: 'Test', version: '1.0' },
        ports: [8080, 8081],
        enabled: true,
      };

      const env = Environment.create({
        name: 'test',
        config,
      });

      const json = env.toJSON();
      const env2 = Environment.fromObject(json, { name: 'test2' });

      expect(env2.toJSON()).toEqual(config);
    });

    it('should survive YAML roundtrip', () => {
      const config = {
        database: { host: 'localhost', port: 5432 },
        cache: { ttl: 3600 },
      };

      const env = Environment.create({
        name: 'test',
        config,
      });

      const yamlStr = env.toYAML();
      const parsed = yaml.load(yamlStr) as Record<string, any>;
      const env2 = Environment.fromObject(parsed, { name: 'test2' });

      expect(env2.toJSON()).toEqual(config);
    });

    it('should survive TOML roundtrip', () => {
      const config = {
        title: 'Config',
        count: 42,
        enabled: true,
        tags: ['dev', 'test'],
      };

      const env = Environment.create({
        name: 'test',
        config,
      });

      const tomlStr = env.toTOML();
      const parsed = TOML.parse(tomlStr);
      const env2 = Environment.fromObject(parsed as Record<string, any>, { name: 'test2' });

      expect(env2.toJSON()).toEqual(config);
    });
  });

  describe('Special cases', () => {
    it('should handle null values consistently across formats', () => {
      const env = Environment.create({
        name: 'test',
        config: { nullValue: null, defined: 'value' },
      });

      const json = env.toJSON();
      const yamlStr = env.toYAML();
      const tomlStr = env.toTOML();

      expect(json.nullValue).toBe(null);
      expect(yamlStr).toContain('nullValue: null');
      // TOML filters out null values
      expect(tomlStr).not.toContain('nullValue');
      expect(tomlStr).toContain('defined = "value"');
    });

    it('should handle numbers with different formats', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          integer: 42,
          float: 3.14,
          negative: -100,
          scientific: 1.5e10,
        },
      });

      const json = env.toJSON();
      const yamlStr = env.toYAML();
      const tomlStr = env.toTOML();

      expect(json.integer).toBe(42);
      expect(json.float).toBe(3.14);
      expect(yamlStr).toContain('integer: 42');
      expect(tomlStr).toContain('integer = 42');
      expect(tomlStr).toContain('float = 3.14');
    });

    it('should handle boolean values', () => {
      const env = Environment.create({
        name: 'test',
        config: { enabled: true, disabled: false },
      });

      const json = env.toJSON();
      const yamlStr = env.toYAML();
      const tomlStr = env.toTOML();

      expect(json.enabled).toBe(true);
      expect(json.disabled).toBe(false);
      expect(yamlStr).toContain('enabled: true');
      expect(tomlStr).toContain('enabled = true');
    });

    it('should handle empty strings', () => {
      const env = Environment.create({
        name: 'test',
        config: { empty: '', nonEmpty: 'value' },
      });

      const json = env.toJSON();
      const yamlStr = env.toYAML();
      const tomlStr = env.toTOML();

      expect(json.empty).toBe('');
      expect(yamlStr).toContain('empty: \'\'');
      expect(tomlStr).toContain('empty = ""');
    });

    it('should handle strings with special characters', () => {
      const env = Environment.create({
        name: 'test',
        config: {
          quotes: 'Hello "world"',
          newlines: 'Line1\nLine2',
          unicode: 'Hello 世界',
        },
      });

      const json = env.toJSON();
      const yamlStr = env.toYAML();
      const tomlStr = env.toTOML();

      expect(json.quotes).toBe('Hello "world"');
      expect(json.unicode).toBe('Hello 世界');

      const parsedYaml = yaml.load(yamlStr) as Record<string, any>;
      expect(parsedYaml.quotes).toBe('Hello "world"');

      const parsedToml = TOML.parse(tomlStr);
      expect(parsedToml.quotes).toBe('Hello "world"');
    });
  });

  describe('toObject', () => {
    it('should return the same as toJSON', () => {
      const config = {
        app: 'test',
        version: '1.0',
        nested: { value: 42 },
      };

      const env = Environment.create({
        name: 'test',
        config,
      });

      const obj = env.toObject();
      const json = env.toJSON();

      expect(obj).toEqual(json);
      expect(obj).toEqual(config);
    });

    it('should return a plain object', () => {
      const env = Environment.create({
        name: 'test',
        config: { foo: 'bar' },
      });

      const obj = env.toObject();

      expect(typeof obj).toBe('object');
      expect(obj.constructor.name).toBe('Object');
    });
  });
});
