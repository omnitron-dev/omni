/**
 * Tests for ConfigService
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import { ConfigService } from '../../../src/modules/config/config.service.js';
import { ConfigLoaderService } from '../../../src/modules/config/config-loader.service.js';
import { ConfigValidatorService } from '../../../src/modules/config/config-validator.service.js';
import fs from 'node:fs';
import path from 'node:path';

describe('ConfigService', () => {
  let configService: ConfigService;
  let tempDir: string;
  let mockLoader: ConfigLoaderService;
  let mockValidator: ConfigValidatorService;

  beforeEach(() => {
    // Create mocked dependencies
    mockLoader = {
      load: jest.fn().mockResolvedValue({}),
    } as any;
    mockValidator = {
      validate: jest.fn().mockReturnValue({ success: true, errors: [] }),
    } as any;

    // Create ConfigService with mocked dependencies
    configService = new ConfigService({ loadEnvironment: false }, mockLoader, mockValidator);

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

    it('should check if configuration has value', async () => {
      await configService.initialize();
      configService.set('existing.key', 'value');
      expect(configService.has('existing.key')).toBe(true);
      expect(configService.has('missing.key')).toBe(false);
    });

    it('should handle setting root configuration', async () => {
      await configService.initialize();
      const config = { app: { name: 'test' }, debug: true };
      configService.set('', config);
      expect(configService.getAll()).toEqual(config);
    });
  });

  describe('Schema validation', () => {
    const testSchema = z.object({
      app: z.object({
        name: z.string().min(3),
        port: z.number().int().positive(),
        debug: z.boolean(),
      }),
    });

    it('should validate configuration with schema', async () => {
      const validConfig = {
        app: { name: 'test-app', port: 3000, debug: false },
      };

      mockLoader.load = jest.fn().mockResolvedValue(validConfig);
      mockValidator.validate = jest.fn().mockReturnValue({ success: true, errors: [] });

      configService = new ConfigService(
        {
          schema: testSchema,
          validateOnStartup: true,
          sources: [
            {
              type: 'object',
              data: validConfig,
            },
          ],
        },
        mockLoader,
        mockValidator,
        undefined,
        testSchema
      );

      await configService.initialize();

      const config = configService.getAll();
      expect(config.app.name).toBe('test-app');
      expect(config.app.port).toBe(3000);
    });

    it('should throw on invalid configuration', async () => {
      const invalidConfig = {
        app: { name: 'ab', port: -1, debug: 'invalid' },
      };

      mockLoader.load = jest.fn().mockResolvedValue(invalidConfig);
      mockValidator.validate = jest.fn().mockReturnValue({
        success: false,
        errors: ['Invalid configuration'],
      });

      configService = new ConfigService(
        {
          schema: testSchema,
          defaults: invalidConfig,
          validateOnStartup: true,
          sources: [],
        },
        mockLoader,
        mockValidator,
        undefined,
        testSchema
      );

      await expect(configService.initialize()).rejects.toThrow();
    });
  });

  describe('Configuration sources', () => {
    it('should load from sources', async () => {
      const configData = {
        app: { name: 'loaded-app', port: 4000 },
      };

      mockLoader.load = jest.fn().mockResolvedValue(configData);

      configService = new ConfigService(
        {
          sources: [
            {
              type: 'file',
              path: 'test.json',
              format: 'json',
            },
          ],
        },
        mockLoader,
        mockValidator
      );

      await configService.initialize();

      expect(configService.get('app.name')).toBe('loaded-app');
      expect(configService.get('app.port')).toBe(4000);
      expect(mockLoader.load).toHaveBeenCalled();
    });

    it('should handle multiple sources', async () => {
      const mergedConfig = {
        app: { name: 'merged-app', port: 5000 },
        database: { host: 'localhost' },
      };

      mockLoader.load = jest.fn().mockResolvedValue(mergedConfig);

      configService = new ConfigService(
        {
          sources: [
            { type: 'file', path: 'base.json', format: 'json' },
            { type: 'env', prefix: 'APP_' },
            { type: 'object', data: { app: { port: 5000 } } },
          ],
        },
        mockLoader,
        mockValidator
      );

      await configService.initialize();

      expect(configService.get('app.port')).toBe(5000);
      expect(configService.get('database.host')).toBe('localhost');
    });
  });

  describe('Change listeners', () => {
    it('should notify listeners on change', async () => {
      await configService.initialize();

      const listener = jest.fn();
      const unsubscribe = configService.onChange(listener);

      configService.set('test.value', 42);

      expect(listener).toHaveBeenCalledWith({
        path: 'test.value',
        oldValue: undefined,
        newValue: 42,
        source: 'runtime',
        timestamp: expect.any(Date),
      });

      unsubscribe();
      configService.set('test.value', 100);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Caching', () => {
    it('should cache values when enabled', async () => {
      const mockData = { app: { name: 'cached' } };
      mockLoader.load = jest.fn().mockResolvedValue(mockData);

      configService = new ConfigService(
        {
          cache: { enabled: true, ttl: 1000 },
          sources: [],
        },
        mockLoader,
        mockValidator
      );

      await configService.initialize();
      configService.set('app.name', 'cached');

      // First access should cache
      const value1 = configService.get('app.name');
      // Second access should use cache
      const value2 = configService.get('app.name');

      expect(value1).toBe('cached');
      expect(value2).toBe('cached');
    });

    it('should invalidate cache after TTL', async () => {
      const mockData = {};
      mockLoader.load = jest.fn().mockResolvedValue(mockData);

      configService = new ConfigService(
        {
          cache: { enabled: true, ttl: 100 }, // 100ms TTL
          sources: [],
        },
        mockLoader,
        mockValidator
      );

      await configService.initialize();
      configService.set('test', 'value');

      const value1 = configService.get('test');
      expect(value1).toBe('value');

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Change value
      configService.set('test', 'new-value');
      const value2 = configService.get('test');
      expect(value2).toBe('new-value');
    });
  });

  describe('Typed configuration', () => {
    it('should get typed configuration with schema', async () => {
      const schema = z.object({
        port: z.number(),
        host: z.string(),
      });

      await configService.initialize();
      configService.set('server', { port: 3000, host: 'localhost' });

      const config = configService.getTyped(schema, 'server');
      expect(config).toEqual({ port: 3000, host: 'localhost' });
    });

    it('should throw on invalid typed configuration', async () => {
      const schema = z.object({
        port: z.number(),
        host: z.string(),
      });

      await configService.initialize();
      configService.set('server', { port: 'invalid', host: 'localhost' });

      expect(() => configService.getTyped(schema, 'server')).toThrow();
    });
  });

  describe('Reload functionality', () => {
    it('should reload configuration from sources', async () => {
      const initialData = { version: 1 };
      const updatedData = { version: 2 };

      mockLoader.load = jest.fn().mockResolvedValueOnce(initialData).mockResolvedValueOnce(updatedData);

      configService = new ConfigService(
        {
          sources: [{ type: 'file', path: 'config.json' }],
        },
        mockLoader,
        mockValidator
      );

      await configService.initialize();
      expect(configService.get('version')).toBe(1);

      await configService.reload();
      expect(configService.get('version')).toBe(2);
      expect(mockLoader.load).toHaveBeenCalledTimes(2);
    });

    it('should restore old config on validation failure during reload', async () => {
      const initialData = { version: 1, valid: true };
      const invalidData = { version: 2, valid: false };

      mockLoader.load = jest.fn().mockResolvedValueOnce(initialData).mockResolvedValueOnce(invalidData);

      mockValidator.validate = jest
        .fn()
        .mockReturnValueOnce({ success: true, errors: [] })
        .mockReturnValueOnce({ success: false, errors: ['Invalid'] });

      const schema = z.object({ version: z.number(), valid: z.boolean() });

      configService = new ConfigService(
        {
          sources: [{ type: 'file', path: 'config.json' }],
          validateOnStartup: true,
          schema,
        },
        mockLoader,
        mockValidator,
        undefined,
        schema
      );

      await configService.initialize();
      expect(configService.get('version')).toBe(1);

      await expect(configService.reload()).rejects.toThrow();
      // Config should remain unchanged
      expect(configService.get('version')).toBe(1);
    });
  });

  describe('Metadata', () => {
    it('should provide configuration metadata', async () => {
      configService = new ConfigService(
        {
          environment: 'test',
          sources: [{ type: 'file', path: 'test.json', name: 'test-file' }],
          cache: { enabled: true },
        },
        mockLoader,
        mockValidator
      );

      await configService.initialize();

      const metadata = configService.getMetadata();
      expect(metadata.environment).toBe('test');
      expect(metadata.cached).toBe(true);
      expect(metadata.loadedAt).toBeInstanceOf(Date);
    });

    it('should get environment from metadata', async () => {
      configService = new ConfigService({ environment: 'production' }, mockLoader, mockValidator);

      expect(configService.environment).toBe('production');
    });
  });
});
