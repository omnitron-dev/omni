/**
 * Tests for ValidationEngine - TDD approach
 */

import { z } from 'zod';
import { ValidationEngine, ValidationError } from '../../src/validation/validation-engine.js';

describe('ValidationEngine', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
  });

  describe('compile', () => {
    it('should compile and cache validators', () => {
      const schema = z.string().email();
      const validator1 = engine.compile(schema);
      const validator2 = engine.compile(schema);

      // Should return the same cached instance
      expect(validator1).toBe(validator2);
    });

    it('should create different validators for different options', () => {
      const schema = z.string();
      const validator1 = engine.compile(schema, { mode: 'strip' });
      const validator2 = engine.compile(schema, { mode: 'strict' });

      expect(validator1).not.toBe(validator2);
    });

    it('should support lazy compilation', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const validator = engine.compile(schema);
      expect(validator).toBeDefined();
      expect(validator.validate).toBeDefined();
      expect(validator.validateAsync).toBeDefined();
      expect(validator.is).toBeDefined();
    });
  });

  describe('validate', () => {
    it('should validate simple types', () => {
      const schema = z.string().email();
      const validator = engine.compile(schema);

      const valid = 'test@example.com';
      const invalid = 'not-an-email';

      expect(validator.validate(valid)).toBe(valid);
      expect(() => validator.validate(invalid)).toThrow(ValidationError);
    });

    it('should validate complex objects', () => {
      const schema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        age: z.number().int().min(0).max(150).optional(),
        roles: z.array(z.enum(['user', 'admin', 'moderator'])).default(['user']),
      });

      const validator = engine.compile(schema);

      const validData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@example.com',
        age: 25,
      };

      const result = validator.validate(validData);
      expect(result.email).toBe('user@example.com');
      expect(result.age).toBe(25);
      expect(result.roles).toEqual(['user']); // default applied
    });

    it('should skip validation when option is set', () => {
      const schema = z.string().email();
      const validator = engine.compile(schema, { skipValidation: true });

      const invalid = 'not-an-email';
      expect(validator.validate(invalid)).toBe(invalid); // no validation
    });

    it('should handle transforms', () => {
      const schema = z
        .string()
        .email()
        .transform((s) => s.toLowerCase());
      const validator = engine.compile(schema);

      const input = 'TEST@EXAMPLE.COM';
      const result = validator.validate(input);
      expect(result).toBe('test@example.com');
    });
  });

  describe('validateAsync', () => {
    it('should validate asynchronously', async () => {
      const schema = z.string().email();
      const validator = engine.compile(schema);

      const valid = 'test@example.com';
      const result = await validator.validateAsync(valid);
      expect(result).toBe(valid);
    });

    it('should handle async refinements', async () => {
      const schema = z.string().refine(
        async (val) => {
          // Simulate async check
          await new Promise((resolve) => setTimeout(resolve, 10));
          return val.length > 5;
        },
        { message: 'String must be longer than 5 characters' }
      );

      const validator = engine.compile(schema);

      await expect(validator.validateAsync('short')).rejects.toThrow(ValidationError);
      await expect(validator.validateAsync('long enough')).resolves.toBe('long enough');
    });
  });

  describe('type guards', () => {
    it('should provide type guard functionality', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });

      const validator = engine.compile(schema);

      const validData = { name: 'John', age: 30 };
      const invalidData = { name: 'John', age: 'thirty' };

      expect(validator.is(validData)).toBe(true);
      expect(validator.is(invalidData)).toBe(false);
    });
  });

  describe('performance optimizations', () => {
    it('should optimize object schemas', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const validator = engine.compile(schema, { mode: 'strict' });

      // Should fail fast on unknown properties
      const dataWithExtra = {
        id: '123',
        name: 'Test',
        extra: 'field',
      };

      expect(() => validator.validate(dataWithExtra)).toThrow(ValidationError);
    });

    it('should handle strip mode', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const validator = engine.compile(schema, { mode: 'strip' });

      const dataWithExtra = {
        id: '123',
        name: 'Test',
        extra: 'field',
      };

      const result = validator.validate(dataWithExtra);
      expect(result).toEqual({ id: '123', name: 'Test' });
      expect((result as any).extra).toBeUndefined();
    });

    it('should handle coercion', () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean(),
      });

      const validator = engine.compile(schema, { coerce: true });

      const data = {
        age: '25',
        active: 'true',
      };

      const result = validator.validate(data);
      expect(result.age).toBe(25);
      expect(result.active).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw ValidationError with details', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
      });

      const validator = engine.compile(schema);

      try {
        validator.validate({
          email: 'invalid',
          age: 15,
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;

        expect(validationError.code).toBe('VALIDATION_ERROR');
        expect(validationError.statusCode).toBe(422);

        const json = validationError.toJSON();
        expect(json.code).toBe('VALIDATION_ERROR');
        expect(json.errors).toBeDefined();
        expect(json.errors.length).toBeGreaterThan(0);
      }
    });

    it('should support simple error format', () => {
      const schema = z.string().email();
      const validator = engine.compile(schema, { errorFormat: 'simple' });

      try {
        validator.validate('invalid');
        fail('Should have thrown');
      } catch (error) {
        const validationError = error as ValidationError;
        const json = validationError.toJSON();

        expect(json.errors).toBeInstanceOf(Array);
        expect(typeof json.errors[0]).toBe('string');
      }
    });

    it('should handle abortEarly option', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
        name: z.string().min(2),
      });

      const validator1 = engine.compile(schema, { abortEarly: true });
      const validator2 = engine.compile(schema, { abortEarly: false });

      const invalidData = {
        email: 'invalid',
        age: 15,
        name: 'a',
      };

      try {
        validator1.validate(invalidData);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = (error as ValidationError).toJSON();
        // With abortEarly, should stop at first error
        expect(json.errors.length).toBe(1);
      }

      try {
        validator2.validate(invalidData);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = (error as ValidationError).toJSON();
        // Without abortEarly, should collect all errors
        expect(json.errors.length).toBe(3);
      }
    });
  });

  describe('cache management', () => {
    it('should cache validators effectively', () => {
      const schemas = Array.from({ length: 100 }, (_, i) => z.object({ [`field${i}`]: z.string() }));

      const validators = schemas.map((schema) => engine.compile(schema));

      // All validators should be cached
      const validators2 = schemas.map((schema) => engine.compile(schema));

      validators.forEach((validator, i) => {
        expect(validator).toBe(validators2[i]);
      });
    });

    it('should generate unique cache keys', () => {
      const schema = z.string();

      const validators = [
        engine.compile(schema),
        engine.compile(schema, { mode: 'strip' }),
        engine.compile(schema, { mode: 'strict' }),
        engine.compile(schema, { coerce: true }),
        engine.compile(schema, { skipValidation: true }),
      ];

      // All should be different due to different options
      const uniqueValidators = new Set(validators);
      expect(uniqueValidators.size).toBe(5);
    });

    it('should clear cache', () => {
      const schema = z.string();
      engine.compile(schema);

      expect(engine.getCacheSize()).toBeGreaterThan(0);

      engine.clearCache();
      expect(engine.getCacheSize()).toBe(0);
    });

    it('should get cache size', () => {
      const initialSize = engine.getCacheSize();

      engine.compile(z.string());
      expect(engine.getCacheSize()).toBe(initialSize + 1);

      engine.compile(z.number());
      expect(engine.getCacheSize()).toBe(initialSize + 2);
    });
  });

  describe('schema optimization', () => {
    it('should handle passthrough mode', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string(),
      });

      const validator = engine.compile(schema, { mode: 'passthrough' });

      const dataWithExtra = {
        id: '123',
        name: 'Test',
        extra: 'field',
      };

      const result = validator.validate(dataWithExtra);
      expect(result).toEqual(dataWithExtra);
      expect((result as any).extra).toBe('field');
    });

    it('should not modify schemas with effects/transforms', () => {
      const schema = z.string().transform((s) => s.toUpperCase());
      const validator = engine.compile(schema, { mode: 'strict' });

      const result = validator.validate('test');
      expect(result).toBe('TEST');
    });
  });

  describe('coercion edge cases', () => {
    it('should coerce dates', () => {
      const schema = z.object({
        createdAt: z.date(),
      });

      const validator = engine.compile(schema, { coerce: true });

      const data = {
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const result = validator.validate(data);
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it('should coerce top-level fields', () => {
      const schema = z.object({
        id: z.string(),
        age: z.number(),
        price: z.number(),
        active: z.boolean(),
      });

      const validator = engine.compile(schema, { coerce: true });

      const data = {
        id: '123',
        age: '25',
        price: '29.99',
        active: 'true',
      };

      const result = validator.validate(data);
      expect(result.id).toBe('123');
      expect(result.age).toBe(25);
      expect(result.price).toBe(29.99);
      expect(result.active).toBe(true);
    });
  });

  describe('async validation edge cases', () => {
    it('should handle async validation with coercion', async () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean(),
      });

      const validator = engine.compile(schema, { coerce: true });

      const data = {
        age: '25',
        active: 'true',
      };

      const result = await validator.validateAsync(data);
      expect(result.age).toBe(25);
      expect(result.active).toBe(true);
    });

    it('should handle async abortEarly option', async () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
        name: z.string().min(2),
      });

      const validator = engine.compile(schema, { abortEarly: true });

      const invalidData = {
        email: 'invalid',
        age: 15,
        name: 'a',
      };

      try {
        await validator.validateAsync(invalidData);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = (error as ValidationError).toJSON();
        expect(json.errors.length).toBe(1);
      }
    });
  });

  describe('error formatting', () => {
    it('should handle detailed error format', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().int().min(18),
      });

      const validator = engine.compile(schema, { errorFormat: 'detailed' });

      try {
        validator.validate({
          email: 'invalid',
          age: 15,
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = (error as ValidationError).toJSON();

        expect(json.code).toBe('VALIDATION_ERROR');
        expect(json.message).toBe('Validation failed');
        expect(json.errors).toBeInstanceOf(Array);
        expect(json.errors.length).toBeGreaterThan(0);
        expect(json.errors[0]).toHaveProperty('path');
        expect(json.errors[0]).toHaveProperty('message');
        expect(json.errors[0]).toHaveProperty('code');
      }
    });

    it('should handle null zodError gracefully', () => {
      const validationError = new ValidationError(null as any);
      const json = validationError.toJSON();

      expect(json.code).toBe('VALIDATION_ERROR');
      expect(json.message).toBe('Validation failed');
      expect(json.errors).toEqual([]);
    });
  });

  describe('real-world scenarios', () => {
    it('should validate user registration', () => {
      interface User {
        email: string;
        password: string;
        age: number;
        role: 'admin' | 'user';
        preferences?: {
          newsletter: boolean;
          notifications: boolean;
        };
      }

      const userSchema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        age: z.number().int().min(18).max(120),
        role: z.enum(['admin', 'user']),
        preferences: z
          .object({
            newsletter: z.boolean(),
            notifications: z.boolean(),
          })
          .optional(),
      });

      const validator = engine.compile(userSchema);

      const validUser = {
        email: 'user@example.com',
        password: 'SecurePass123',
        age: 25,
        role: 'user' as const,
        preferences: {
          newsletter: true,
          notifications: false,
        },
      };

      expect(() => validator.validate(validUser)).not.toThrow();
    });

    it('should validate product catalog entry', () => {
      const productSchema = z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(200),
        price: z.number().positive(),
        currency: z.enum(['USD', 'EUR', 'GBP']),
        stock: z.number().int().min(0),
        tags: z.array(z.string()).min(1).max(10),
        metadata: z.record(z.string(), z.any()).optional(),
      });

      const validator = engine.compile(productSchema, { mode: 'strip' });

      const validProduct = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Test Product',
        price: 29.99,
        currency: 'USD' as const,
        stock: 100,
        tags: ['electronics', 'gadget'],
        extraField: 'should be stripped',
      };

      const result = validator.validate(validProduct);
      expect((result as any).extraField).toBeUndefined();
      expect(result.tags).toEqual(['electronics', 'gadget']);
    });

    it('should validate API response with nested objects', () => {
      const responseSchema = z.object({
        status: z.enum(['success', 'error']),
        data: z
          .object({
            user: z.object({
              id: z.string(),
              name: z.string(),
              email: z.string().email(),
            }),
            session: z.object({
              token: z.string(),
              expiresAt: z.string().datetime(),
            }),
          })
          .nullable(),
        error: z
          .object({
            code: z.string(),
            message: z.string(),
          })
          .nullable(),
      });

      const validator = engine.compile(responseSchema);

      const validResponse = {
        status: 'success' as const,
        data: {
          user: {
            id: '123',
            name: 'John Doe',
            email: 'john@example.com',
          },
          session: {
            token: 'abc123',
            expiresAt: '2024-12-31T23:59:59.000Z',
          },
        },
        error: null,
      };

      expect(() => validator.validate(validResponse)).not.toThrow();
    });

    it('should validate union types', () => {
      const eventSchema = z.discriminatedUnion('type', [
        z.object({
          type: z.literal('user.created'),
          userId: z.string().uuid(),
          email: z.string().email(),
        }),
        z.object({
          type: z.literal('user.deleted'),
          userId: z.string().uuid(),
        }),
        z.object({
          type: z.literal('user.updated'),
          userId: z.string().uuid(),
          changes: z.record(z.string(), z.any()),
        }),
      ]);

      const validator = engine.compile(eventSchema);

      const events = [
        {
          type: 'user.created',
          userId: '123e4567-e89b-12d3-a456-426614174000',
          email: 'user@example.com',
        },
        {
          type: 'user.deleted',
          userId: '123e4567-e89b-12d3-a456-426614174000',
        },
        {
          type: 'user.updated',
          userId: '123e4567-e89b-12d3-a456-426614174000',
          changes: { name: 'New Name' },
        },
      ];

      events.forEach((event) => {
        expect(() => validator.validate(event)).not.toThrow();
      });
    });
  });
});
