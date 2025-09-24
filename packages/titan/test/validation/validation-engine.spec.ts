/**
 * Tests for ValidationEngine - TDD approach
 */

import { z } from 'zod';
import { ValidationEngine, ValidationError, ValidationOptions } from '../../src/validation/validation-engine.js';

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
        age: z.number()
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
        roles: z.array(z.enum(['user', 'admin', 'moderator'])).default(['user'])
      });

      const validator = engine.compile(schema);

      const validData = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        email: 'user@example.com',
        age: 25
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
      const schema = z.string().email().transform(s => s.toLowerCase());
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
          await new Promise(resolve => setTimeout(resolve, 10));
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
        age: z.number()
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
        name: z.string()
      });

      const validator = engine.compile(schema, { mode: 'strict' });

      // Should fail fast on unknown properties
      const dataWithExtra = {
        id: '123',
        name: 'Test',
        extra: 'field'
      };

      expect(() => validator.validate(dataWithExtra)).toThrow(ValidationError);
    });

    it('should handle strip mode', () => {
      const schema = z.object({
        id: z.string(),
        name: z.string()
      });

      const validator = engine.compile(schema, { mode: 'strip' });

      const dataWithExtra = {
        id: '123',
        name: 'Test',
        extra: 'field'
      };

      const result = validator.validate(dataWithExtra);
      expect(result).toEqual({ id: '123', name: 'Test' });
      expect((result as any).extra).toBeUndefined();
    });

    it('should handle coercion', () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean()
      });

      const validator = engine.compile(schema, { coerce: true });

      const data = {
        age: '25',
        active: 'true'
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
        age: z.number().min(18)
      });

      const validator = engine.compile(schema);

      try {
        validator.validate({
          email: 'invalid',
          age: 15
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
        name: z.string().min(2)
      });

      const validator1 = engine.compile(schema, { abortEarly: true });
      const validator2 = engine.compile(schema, { abortEarly: false });

      const invalidData = {
        email: 'invalid',
        age: 15,
        name: 'a'
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
      const schemas = Array.from({ length: 100 }, (_, i) =>
        z.object({ [`field${i}`]: z.string() })
      );

      const validators = schemas.map(schema => engine.compile(schema));

      // All validators should be cached
      const validators2 = schemas.map(schema => engine.compile(schema));

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
        engine.compile(schema, { skipValidation: true })
      ];

      // All should be different due to different options
      const uniqueValidators = new Set(validators);
      expect(uniqueValidators.size).toBe(5);
    });
  });
});