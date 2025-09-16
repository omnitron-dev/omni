/**
 * Tests for ConfigModule with zod@4.1.8
 */

import { z } from 'zod';
import { 
  ConfigModule,
  createConfigModule,
  ConfigSchemas,
  createTypedConfig,
  type ValidationResult
} from '../../src/modules/config.module';

describe('ConfigModule with zod@4.1.8', () => {
  let config: ConfigModule;

  beforeEach(() => {
    config = new ConfigModule();
  });

  describe('Basic functionality', () => {
    it('should set and get configuration values', () => {
      config.set('test.value', 42);
      expect(config.get('test.value')).toBe(42);
    });

    it('should merge configuration objects', () => {
      config.merge({
        app: { name: 'test-app' },
        server: { port: 3000 }
      });
      
      expect(config.get('app.name')).toBe('test-app');
      expect(config.get('server.port')).toBe(3000);
    });

    it('should handle nested paths', () => {
      config.set('deeply.nested.value', 'test');
      expect(config.get('deeply.nested.value')).toBe('test');
    });

    it('should return default value for missing keys', () => {
      expect(config.get('missing.key', 'default')).toBe('default');
    });

    it('should throw for required missing keys', () => {
      expect(() => config.require('missing.key')).toThrow();
    });
  });

  describe('Schema validation with zod 4.1.8', () => {
    const testSchema = z.object({
      name: z.string().min(3),
      port: z.number().int().positive(),
      enabled: z.boolean()
    });

    it('should validate configuration against schema', () => {
      config.merge({
        name: 'test-app',
        port: 3000,
        enabled: true
      });

      const result = config.validate(testSchema);
      expect(result.name).toBe('test-app');
      expect(result.port).toBe(3000);
      expect(result.enabled).toBe(true);
    });

    it('should throw detailed errors for invalid configuration', () => {
      config.merge({
        name: 'ab', // Too short
        port: -1,    // Negative
        enabled: 'yes' // Wrong type
      });

      expect(() => config.validate(testSchema)).toThrow(/Configuration validation failed/);
    });

    it('should provide safe validation with detailed errors', () => {
      config.merge({
        name: 'ab',
        port: 'invalid',
        enabled: true
      });

      const result = config.validateSafe(testSchema);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.formattedErrors).toBeDefined();
      expect(result.formattedErrors!.length).toBeGreaterThan(0);
    });

    it('should validate specific paths', () => {
      config.set('database', {
        host: 'localhost',
        port: 5432,
        username: 'admin',
        password: 'secret',
        database: 'myapp'
      });

      const dbConfig = config.validatePath('database', ConfigSchemas.database);
      expect(dbConfig.host).toBe('localhost');
      expect(dbConfig.port).toBe(5432);
    });
  });

  describe('Typed configuration', () => {
    const appSchema = z.object({
      app: z.object({
        name: z.string(),
        version: z.string(),
        debug: z.boolean().default(false)
      }),
      features: z.object({
        cache: z.boolean().default(true),
        rateLimit: z.number().default(100)
      })
    });

    type AppConfig = z.infer<typeof appSchema>;

    it('should get typed configuration values', () => {
      config.merge({
        app: { name: 'test', version: '1.0.0' }
      });

      const typedValue = config.getTyped('app', z.object({
        name: z.string(),
        version: z.string()
      }));

      expect(typedValue?.name).toBe('test');
      expect(typedValue?.version).toBe('1.0.0');
    });

    it('should return undefined for invalid typed values', () => {
      config.set('invalid', 'not-an-object');

      const typedValue = config.getTyped('invalid', z.object({
        name: z.string()
      }));

      expect(typedValue).toBeUndefined();
    });

    it('should create typed configuration getter', () => {
      config.merge({
        app: { name: 'test', version: '1.0.0', debug: true },
        features: { cache: false, rateLimit: 50 }
      });

      const getConfig = createTypedConfig(config, appSchema);
      const appConfig = getConfig();

      expect(appConfig.app.name).toBe('test');
      expect(appConfig.features.cache).toBe(false);
      expect(appConfig.features.rateLimit).toBe(50);
    });
  });

  describe('Schema registration', () => {
    it('should register and retrieve schemas', () => {
      const schema = z.string().email();
      config.registerSchema('user.email', schema);

      const retrieved = config.getRegisteredSchema('user.email');
      expect(retrieved).toBe(schema);
    });

    it('should validate on registration if value exists', () => {
      config.set('user.email', 'invalid-email');
      
      const schema = z.string().email();
      expect(() => config.registerSchema('user.email', schema)).toThrow();
    });

    it('should validate with registered schemas', () => {
      const emailSchema = z.string().email();
      config.registerSchema('user.email', emailSchema);
      
      config.set('user.email', 'test@example.com');
      const validated = config.validatePath('user.email', emailSchema);
      expect(validated).toBe('test@example.com');
    });
  });

  describe('Advanced zod 4.1.8 features', () => {
    it('should handle refinements', () => {
      const passwordSchema = z.string()
        .min(8)
        .refine(
          (password) => /[A-Z]/.test(password),
          { message: 'Must contain uppercase letter' }
        )
        .refine(
          (password) => /[0-9]/.test(password),
          { message: 'Must contain number' }
        );

      config.set('password', 'weak');
      
      expect(() => config.validatePath('password', passwordSchema))
        .toThrow(/Must contain uppercase letter/);
    });

    it('should handle union types', () => {
      const configSchema = z.object({
        port: z.union([z.number(), z.string()])
      });

      config.merge({ port: 3000 });
      expect(config.validate(configSchema).port).toBe(3000);

      config.merge({ port: '3000' });
      expect(config.validate(configSchema).port).toBe('3000');
    });

    it('should handle optional and nullable types', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
        nullable: z.string().nullable(),
        optionalNullable: z.string().optional().nullable()
      });

      config.merge({
        required: 'value',
        nullable: null
      });

      const result = config.validate(schema);
      expect(result.required).toBe('value');
      expect(result.optional).toBeUndefined();
      expect(result.nullable).toBeNull();
    });

    it('should handle default values', () => {
      const schema = z.object({
        name: z.string().default('default-name'),
        port: z.number().default(3000),
        enabled: z.boolean().default(true)
      });

      config.merge({}); // Empty config
      
      const result = config.validate(schema);
      expect(result.name).toBe('default-name');
      expect(result.port).toBe(3000);
      expect(result.enabled).toBe(true);
    });

    it('should handle transforms', () => {
      const schema = z.object({
        port: z.string().transform((val) => parseInt(val, 10)),
        uppercase: z.string().transform((val) => val.toUpperCase()),
        date: z.string().transform((val) => new Date(val))
      });

      config.merge({
        port: '3000',
        uppercase: 'hello',
        date: '2024-01-01'
      });

      const result = config.validate(schema);
      expect(result.port).toBe(3000);
      expect(result.uppercase).toBe('HELLO');
      expect(result.date).toBeInstanceOf(Date);
    });
  });

  describe('Async validation', () => {
    it('should handle async validation', async () => {
      const asyncSchema = z.object({
        url: z.string().url().refine(
          async (url) => {
            // Simulate async check
            await new Promise(resolve => setTimeout(resolve, 10));
            return url.includes('https');
          },
          { message: 'Must be HTTPS' }
        )
      });

      config.merge({ url: 'http://example.com' });
      
      await expect(config.validateAsync(asyncSchema))
        .rejects.toThrow(/Must be HTTPS/);

      config.merge({ url: 'https://example.com' });
      
      const result = await config.validateAsync(asyncSchema);
      expect(result.url).toBe('https://example.com');
    });
  });

  describe('Environment variables', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should load from environment variables', () => {
      process.env['APP_NAME'] = 'test-app';
      process.env['APP_PORT'] = '3000';
      process.env['APP_DEBUG'] = 'true';

      config.loadEnv('APP_');
      
      expect(config.get('name')).toBe('test-app');
      expect(config.get('port')).toBe(3000);
      expect(config.get('debug')).toBe(true);
    });

    it('should handle nested environment variables', () => {
      process.env['APP_DATABASE_HOST'] = 'localhost';
      process.env['APP_DATABASE_PORT'] = '5432';

      config.loadEnv('APP_');
      
      expect(config.get('database.host')).toBe('localhost');
      expect(config.get('database.port')).toBe(5432);
    });
  });

  describe('Watchers', () => {
    it('should notify watchers on value change', () => {
      const callback = jest.fn();
      
      config.watch('test.value', callback);
      config.set('test.value', 42);
      
      expect(callback).toHaveBeenCalledWith(42);
    });

    it('should allow unsubscribing from watchers', () => {
      const callback = jest.fn();
      
      const unwatch = config.watch('test.value', callback);
      config.set('test.value', 1);
      expect(callback).toHaveBeenCalledTimes(1);
      
      unwatch();
      config.set('test.value', 2);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error formatting', () => {
    it('should format validation errors nicely', () => {
      const schema = z.object({
        user: z.object({
          name: z.string().min(3),
          email: z.string().email(),
          age: z.number().int().min(18).max(120)
        })
      });

      config.merge({
        user: {
          name: 'ab',
          email: 'invalid',
          age: 150
        }
      });

      const result = config.validateSafe(schema);
      expect(result.success).toBe(false);
      expect(result.formattedErrors).toBeDefined();
      
      // Check that errors are formatted with paths
      const errors = result.formattedErrors!.join('\n');
      expect(errors).toContain('[user.name]');
      expect(errors).toContain('[user.email]');
      expect(errors).toContain('[user.age]');
    });
  });

  describe('Configuration module factory', () => {
    it('should create module with options', () => {
      const schema = z.object({
        name: z.string(),
        port: z.number()
      });

      const module = createConfigModule({
        schema,
        defaults: {
          name: 'default-app',
          port: 3000
        },
        environment: 'test'
      });

      expect(module.get('name')).toBe('default-app');
      expect(module.get('port')).toBe(3000);
      expect(module.getEnvironment()).toBe('test');
    });

    it('should register multiple schemas', () => {
      const module = createConfigModule({
        schemas: {
          'database': ConfigSchemas.database,
          'server': ConfigSchemas.server,
          'logger': ConfigSchemas.logger
        }
      });

      expect(module.getRegisteredSchema('database')).toBeDefined();
      expect(module.getRegisteredSchema('server')).toBeDefined();
      expect(module.getRegisteredSchema('logger')).toBeDefined();
    });
  });
});