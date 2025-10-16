import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Environment, EnvironmentBuilder } from '../../../src/core/index.js';

describe('Environment Factory Methods', () => {
  const testDir = path.join(process.cwd(), 'test-temp');

  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
  });

  describe('fromFile()', () => {
    it('should load environment from YAML file', async () => {
      const yamlPath = path.join(testDir, 'config.yaml');
      const yamlContent = `name: test-env
version: 1.0.0
config:
  database:
    host: localhost
    port: 5432`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath);

      expect(env.name).toBe('test-env');
      expect(env.version).toBe('1.0.0');
      expect(env.get('database.host')).toBe('localhost');
      expect(env.get('database.port')).toBe(5432);
    });

    it('should load environment from JSON file', async () => {
      const jsonPath = path.join(testDir, 'config.json');
      const jsonContent = {
        name: 'json-env',
        version: '2.0.0',
        config: {
          api: {
            endpoint: 'https://api.example.com',
            timeout: 3000,
          },
        },
      };
      await fs.writeFile(jsonPath, JSON.stringify(jsonContent, null, 2));

      const env = await Environment.fromFile(jsonPath);

      expect(env.name).toBe('json-env');
      expect(env.version).toBe('2.0.0');
      expect(env.get('api.endpoint')).toBe('https://api.example.com');
      expect(env.get('api.timeout')).toBe(3000);
    });

    it('should load environment from YAML file with .yml extension', async () => {
      const ymlPath = path.join(testDir, 'config.yml');
      const ymlContent = `name: yml-env
config:
  setting: value`;
      await fs.writeFile(ymlPath, ymlContent);

      const env = await Environment.fromFile(ymlPath);

      expect(env.name).toBe('yml-env');
      expect(env.get('setting')).toBe('value');
    });

    it('should support flat config structure', async () => {
      const yamlPath = path.join(testDir, 'flat.yaml');
      const yamlContent = `database:
  host: localhost
  port: 5432
app:
  name: myapp`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath);

      expect(env.get('database.host')).toBe('localhost');
      expect(env.get('app.name')).toBe('myapp');
    });

    it('should auto-generate name from filename if not provided', async () => {
      const yamlPath = path.join(testDir, 'production.yaml');
      const yamlContent = `database:
  host: prod-db`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath);

      expect(env.name).toBe('production');
    });

    it('should override name from options', async () => {
      const yamlPath = path.join(testDir, 'config.yaml');
      const yamlContent = `name: original
config:
  key: value`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath, { name: 'overridden' });

      expect(env.name).toBe('original'); // File name takes precedence
    });

    it('should merge metadata from file and options', async () => {
      const yamlPath = path.join(testDir, 'config.yaml');
      const yamlContent = `name: test
metadata:
  description: From file
config:
  key: value`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath, {
        metadata: { tags: ['tag1', 'tag2'] },
      });

      expect(env.metadata.description).toBe('From file');
      expect(env.metadata.tags).toEqual(['tag1', 'tag2']);
    });

    it('should set sourcePath metadata', async () => {
      const yamlPath = path.join(testDir, 'config.yaml');
      const yamlContent = `config:
  key: value`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath);

      expect(env.metadata.sourcePath).toBe(yamlPath);
      expect(env.metadata.source).toBe('file');
    });

    it('should handle version from file', async () => {
      const yamlPath = path.join(testDir, 'config.yaml');
      const yamlContent = `name: test
version: 3.5.2
config:
  key: value`;
      await fs.writeFile(yamlPath, yamlContent);

      const env = await Environment.fromFile(yamlPath);

      expect(env.version).toBe('3.5.2');
    });

    it('should throw error for non-existent file', async () => {
      const nonExistentPath = path.join(testDir, 'non-existent.yaml');

      await expect(Environment.fromFile(nonExistentPath)).rejects.toThrow();
    });
  });

  describe('fromObject()', () => {
    it('should create environment from flat object', () => {
      const data = {
        database: {
          host: 'localhost',
          port: 5432,
        },
        api: {
          endpoint: 'https://api.example.com',
        },
      };

      const env = Environment.fromObject(data);

      expect(env.get('database.host')).toBe('localhost');
      expect(env.get('api.endpoint')).toBe('https://api.example.com');
    });

    it('should create environment from nested structure with name', () => {
      const data = {
        name: 'my-env',
        version: '2.0.0',
        config: {
          setting1: 'value1',
          setting2: 'value2',
        },
      };

      const env = Environment.fromObject(data);

      expect(env.name).toBe('my-env');
      expect(env.version).toBe('2.0.0');
      expect(env.get('setting1')).toBe('value1');
      expect(env.get('setting2')).toBe('value2');
    });

    it('should create environment from nested structure with metadata', () => {
      const data = {
        name: 'test',
        metadata: {
          description: 'Test environment',
          tags: ['testing'],
        },
        config: {
          key: 'value',
        },
      };

      const env = Environment.fromObject(data);

      expect(env.name).toBe('test');
      expect(env.metadata.description).toBe('Test environment');
      expect(env.metadata.tags).toEqual(['testing']);
    });

    it('should use name from options if not in data', () => {
      const data = {
        key1: 'value1',
        key2: 'value2',
      };

      const env = Environment.fromObject(data, { name: 'options-name' });

      expect(env.name).toBe('options-name');
      expect(env.get('key1')).toBe('value1');
    });

    it('should prioritize data.name over options.name', () => {
      const data = {
        name: 'data-name',
        config: {
          key: 'value',
        },
      };

      const env = Environment.fromObject(data, { name: 'options-name' });

      expect(env.name).toBe('data-name');
    });

    it('should handle version from data', () => {
      const data = {
        name: 'test',
        version: '1.5.0',
        config: {
          key: 'value',
        },
      };

      const env = Environment.fromObject(data);

      expect(env.version).toBe('1.5.0');
    });

    it('should handle version from options', () => {
      const data = {
        config: {
          key: 'value',
        },
      };

      const env = Environment.fromObject(data, { version: '2.0.0' });

      expect(env.version).toBe('2.0.0');
    });

    it('should handle empty object', () => {
      const env = Environment.fromObject({});

      expect(env.name).toBe('unnamed');
      expect(env.toObject()).toEqual({});
    });

    it('should handle nested arrays in config', () => {
      const data = {
        servers: [
          { host: 'server1', port: 8080 },
          { host: 'server2', port: 8081 },
        ],
      };

      const env = Environment.fromObject(data);

      const servers = env.get('servers');
      expect(servers).toHaveLength(2);
      expect(servers[0].host).toBe('server1');
    });
  });

  describe('builder()', () => {
    it('should create a builder instance', () => {
      const builder = new EnvironmentBuilder();

      expect(builder).toBeInstanceOf(EnvironmentBuilder);
    });

    it('should build environment with name', async () => {
      const env = await new EnvironmentBuilder().withName('test-builder').withVariables({ key: 'value' }).build();

      expect(env).toBeInstanceOf(Environment);
      expect(env.name).toBe('test-builder');
      expect(env.get('key')).toBe('value');
    });

    it('should throw error if name not set', async () => {
      await expect(new EnvironmentBuilder().build()).rejects.toThrow('name is required');
    });
  });
});

describe('EnvironmentBuilder', () => {
  const testDir = path.join(process.cwd(), 'test-temp-builder');

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore errors
    }
  });

  describe('withName()', () => {
    it('should set environment name', async () => {
      const env = await new EnvironmentBuilder().withName('my-env').withVariables({ key: 'value' }).build();

      expect(env.name).toBe('my-env');
    });

    it('should allow chaining', () => {
      const builder = new EnvironmentBuilder();
      const result = builder.withName('test');

      expect(result).toBe(builder);
    });
  });

  describe('withBase()', () => {
    it('should load base configuration from YAML file', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      const baseContent = `database:
  host: localhost
  port: 5432`;
      await fs.writeFile(basePath, baseContent);

      const builder = new EnvironmentBuilder().withName('test');
      await builder.withBase(basePath);
      const env = await builder.build();

      expect(env.get('database.host')).toBe('localhost');
      expect(env.get('database.port')).toBe(5432);
    });

    it('should load base configuration from JSON file', async () => {
      const basePath = path.join(testDir, 'base.json');
      const baseContent = {
        api: {
          url: 'https://api.example.com',
        },
      };
      await fs.writeFile(basePath, JSON.stringify(baseContent));

      const builder = new EnvironmentBuilder().withName('test');
      await builder.withBase(basePath);
      const env = await builder.build();

      expect(env.get('api.url')).toBe('https://api.example.com');
    });

    it('should allow chaining', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      await fs.writeFile(basePath, 'key: value');

      const builder = new EnvironmentBuilder();
      const result = await builder.withBase(basePath);

      expect(result).toBe(builder);
    });
  });

  describe('withOverrides()', () => {
    it('should load override configuration from file', async () => {
      const overridePath = path.join(testDir, 'override.yaml');
      const overrideContent = `database:
  host: prod-db`;
      await fs.writeFile(overridePath, overrideContent);

      const builder = new EnvironmentBuilder()
        .withName('test')
        .withVariables({ database: { host: 'localhost' } });
      await builder.withOverrides(overridePath);
      const env = await builder.build();

      expect(env.get('database.host')).toBe('prod-db');
    });

    it('should override base configuration', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      const baseContent = `database:
  host: localhost
  port: 5432`;
      await fs.writeFile(basePath, baseContent);

      const overridePath = path.join(testDir, 'override.yaml');
      const overrideContent = `database:
  host: prod-db`;
      await fs.writeFile(overridePath, overrideContent);

      const builder = new EnvironmentBuilder().withName('test');
      await builder.withBase(basePath);
      await builder.withOverrides(overridePath);
      const env = await builder.build();

      expect(env.get('database.host')).toBe('prod-db');
      expect(env.get('database.port')).toBe(5432);
    });
  });

  describe('withVariables()', () => {
    it('should set variables', async () => {
      const env = await new EnvironmentBuilder()
        .withName('test')
        .withVariables({
          key1: 'value1',
          key2: 'value2',
        })
        .build();

      expect(env.get('key1')).toBe('value1');
      expect(env.get('key2')).toBe('value2');
    });

    it('should merge multiple withVariables calls', async () => {
      const env = await new EnvironmentBuilder()
        .withName('test')
        .withVariables({ key1: 'value1' })
        .withVariables({ key2: 'value2' })
        .build();

      expect(env.get('key1')).toBe('value1');
      expect(env.get('key2')).toBe('value2');
    });

    it('should override previous variables', async () => {
      const env = await new EnvironmentBuilder()
        .withName('test')
        .withVariables({ key: 'old' })
        .withVariables({ key: 'new' })
        .build();

      expect(env.get('key')).toBe('new');
    });
  });

  describe('withValidation()', () => {
    it('should enable validation by default', async () => {
      const env = await new EnvironmentBuilder().withName('test').withVariables({ key: 'value' }).build();

      expect(env).toBeDefined();
    });

    it('should allow disabling validation', async () => {
      const env = await new EnvironmentBuilder()
        .withName('test')
        .withValidation(false)
        .withVariables({ key: 'value' })
        .build();

      expect(env).toBeDefined();
    });
  });

  describe('build()', () => {
    it('should build environment with all configurations', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      await fs.writeFile(
        basePath,
        `database:
  host: localhost
  port: 5432`
      );

      const overridePath = path.join(testDir, 'override.yaml');
      await fs.writeFile(overridePath, `database:\n  host: prod-db`);

      const builder = new EnvironmentBuilder()
        .withName('production')
        .withVariables({ app: { name: 'myapp' } })
        .withMetadata({ environment: 'production' });
      await builder.withBase(basePath);
      await builder.withOverrides(overridePath);
      const env = await builder.build();

      expect(env.name).toBe('production');
      expect(env.get('database.host')).toBe('prod-db');
      expect(env.get('database.port')).toBe(5432);
      expect(env.get('app.name')).toBe('myapp');
      expect(env.metadata.environment).toBe('production');
    });

    it('should apply configuration in correct order: base -> variables -> overrides', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      await fs.writeFile(basePath, `value: base`);

      const overridePath = path.join(testDir, 'override.yaml');
      await fs.writeFile(overridePath, `value: override`);

      const builder = new EnvironmentBuilder()
        .withName('test')
        .withVariables({ value: 'variables' });
      await builder.withBase(basePath);
      await builder.withOverrides(overridePath);
      const env = await builder.build();

      expect(env.get('value')).toBe('override');
    });

    it('should throw error if name is not set', async () => {
      await expect(new EnvironmentBuilder().build()).rejects.toThrow('name is required');
    });

    it('should handle nested configuration merging', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      await fs.writeFile(
        basePath,
        `database:
  host: localhost
  port: 5432
  credentials:
    user: admin`
      );

      const builder = new EnvironmentBuilder()
        .withName('test')
        .withVariables({
          database: {
            credentials: {
              password: 'secret',
            },
          },
        });
      await builder.withBase(basePath);
      const env = await builder.build();

      expect(env.get('database.host')).toBe('localhost');
      expect(env.get('database.port')).toBe(5432);
      expect(env.get('database.credentials.user')).toBe('admin');
      expect(env.get('database.credentials.password')).toBe('secret');
    });

    it('should handle empty builder', async () => {
      const env = await new EnvironmentBuilder().withName('empty').build();

      expect(env.name).toBe('empty');
      expect(env.toObject()).toEqual({});
    });

    it('should throw error for invalid file path', async () => {
      const builder = new EnvironmentBuilder().withName('test');
      await expect(builder.withBase('/non/existent/path.yaml')).rejects.toThrow();
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple base and override files', async () => {
      const base1Path = path.join(testDir, 'base1.yaml');
      await fs.writeFile(base1Path, `key1: value1`);

      const base2Path = path.join(testDir, 'base2.yaml');
      await fs.writeFile(base2Path, `key2: value2`);

      const builder = new EnvironmentBuilder().withName('test');
      await builder.withBase(base1Path);
      await builder.withBase(base2Path);
      const env = await builder.build();

      expect(env.get('key1')).toBe('value1');
      expect(env.get('key2')).toBe('value2');
    });

    it('should handle complex nested overrides', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      await fs.writeFile(
        basePath,
        `app:
  name: myapp
  version: 1.0.0
  features:
    auth: true
    logging: false`
      );

      const builder = new EnvironmentBuilder()
        .withName('test')
        .withVariables({
          app: {
            features: {
              logging: true,
              metrics: true,
            },
          },
        });
      await builder.withBase(basePath);
      const env = await builder.build();

      expect(env.get('app.name')).toBe('myapp');
      expect(env.get('app.features.auth')).toBe(true);
      expect(env.get('app.features.logging')).toBe(true);
      expect(env.get('app.features.metrics')).toBe(true);
    });

    it('should handle arrays in configuration', async () => {
      const basePath = path.join(testDir, 'base.yaml');
      await fs.writeFile(
        basePath,
        `servers:
  - host: server1
    port: 8080
  - host: server2
    port: 8081`
      );

      const builder = new EnvironmentBuilder().withName('test');
      await builder.withBase(basePath);
      const env = await builder.build();

      const servers = env.get('servers');
      expect(servers).toHaveLength(2);
      expect(servers[0].host).toBe('server1');
      expect(servers[1].port).toBe(8081);
    });
  });
});
