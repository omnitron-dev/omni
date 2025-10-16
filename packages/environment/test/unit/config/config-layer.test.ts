import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { ConfigLayer } from '../../../src/config/config-layer';

describe('ConfigLayer', () => {
  let config: ConfigLayer;

  beforeEach(() => {
    config = new ConfigLayer(undefined, {
      app: {
        name: 'TestApp',
        version: '1.0.0',
        port: 3000
      },
      database: {
        host: 'localhost',
        port: 5432
      }
    });
  });

  describe('Get/Set operations', () => {
    it('should get value at path', () => {
      expect(config.get('app.name')).toBe('TestApp');
      expect(config.get('app.port')).toBe(3000);
      expect(config.get('database.host')).toBe('localhost');
    });

    it('should set value at path', () => {
      config.set('app.name', 'NewApp');
      expect(config.get('app.name')).toBe('NewApp');
    });

    it('should return undefined for non-existent path', () => {
      expect(config.get('non.existent.path')).toBeUndefined();
    });

    it('should check if path exists', () => {
      expect(config.has('app.name')).toBe(true);
      expect(config.has('non.existent')).toBe(false);
    });

    it('should delete path', () => {
      config.delete('app.port');
      expect(config.has('app.port')).toBe(false);
    });
  });

  describe('Bulk operations', () => {
    it('should get all data', () => {
      const data = config.getAll();
      expect(data).toMatchObject({
        app: {
          name: 'TestApp',
          version: '1.0.0',
          port: 3000
        }
      });
    });

    it('should set all data', () => {
      config.setAll({ newKey: 'newValue' });
      expect(config.get('newKey')).toBe('newValue');
      expect(config.get('app')).toBeUndefined();
    });

    it('should clear all data', () => {
      config.clear();
      expect(config.getAll()).toEqual({});
    });
  });

  describe('Validation', () => {
    it('should validate with Zod schema', async () => {
      const schema = z.object({
        app: z.object({
          name: z.string(),
          port: z.number()
        })
      });

      const validConfig = new ConfigLayer(schema, {
        app: { name: 'Test', port: 3000 }
      });

      const result = await validConfig.validate();
      expect(result.valid).toBe(true);
    });

    it('should fail validation with invalid data', async () => {
      const schema = z.object({
        app: z.object({
          name: z.string(),
          port: z.number()
        })
      });

      const invalidConfig = new ConfigLayer(schema, {
        app: { name: 'Test', port: 'invalid' }
      });

      const result = await invalidConfig.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should validate with JSON Schema', async () => {
      const schema = {
        type: 'object',
        properties: {
          app: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              port: { type: 'number' }
            },
            required: ['name', 'port']
          }
        }
      };

      const validConfig = new ConfigLayer(schema, {
        app: { name: 'Test', port: 3000 }
      });

      const result = await validConfig.validate();
      expect(result.valid).toBe(true);
    });
  });

  describe('Variable resolution', () => {
    it('should interpolate variables', async () => {
      const configWithVars = new ConfigLayer(undefined, {
        app: {
          name: '${appName}',
          url: 'https://${domain}:${port}'
        }
      });

      await configWithVars.resolve({
        variables: {
          appName: 'TestApp',
          domain: 'example.com',
          port: '3000'
        }
      });

      expect(configWithVars.get('app.name')).toBe('TestApp');
      expect(configWithVars.get('app.url')).toBe('https://example.com:3000');
    });
  });
});
