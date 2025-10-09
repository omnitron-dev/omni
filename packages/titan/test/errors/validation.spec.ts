/**
 * Comprehensive tests for validation error module
 */

import { describe, it, expect } from '@jest/globals';
import { z } from 'zod';
import {
  ValidationError,
  ServiceError,
  ValidateInput,
  ValidateOutput,
  Validate,
  createValidationMiddleware
} from '../../src/errors/validation.js';
import { ErrorCode } from '../../src/errors/codes.js';

describe('Validation Errors', () => {
  describe('ValidationError', () => {
    it('should create from Zod error', () => {
      const zodError = new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['email'],
          message: 'Expected string, received number'
        }
      ]);

      const error = ValidationError.fromZodError(zodError);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.validationErrors).toHaveLength(1);
      expect(error.validationErrors[0].path).toBe('email');
      expect(error.validationErrors[0].message).toBe('Expected string, received number');
    });

    it('should create from field errors', () => {
      const errors = [
        { field: 'email', message: 'Invalid email format', code: 'invalid_email' },
        { field: 'password', message: 'Password too short', code: 'min_length' }
      ];

      const error = ValidationError.fromFieldErrors(errors);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.validationErrors).toHaveLength(2);
      expect(error.validationErrors[0].path).toBe('email');
      expect(error.validationErrors[1].path).toBe('password');
    });

    it('should get simple format', () => {
      const error = ValidationError.fromFieldErrors([
        { field: 'email', message: 'Invalid email' },
        { field: 'password', message: 'Too short' }
      ]);

      const simple = error.getSimpleFormat();

      expect(simple).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        errors: ['Invalid email', 'Too short']
      });
    });

    it('should get detailed format', () => {
      const error = ValidationError.fromFieldErrors(
        [{ field: 'email', message: 'Invalid email', code: 'invalid' }],
        { message: 'Custom message' }
      );

      const detailed = error.getDetailedFormat();

      expect(detailed).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Custom message',
        errors: [
          {
            path: 'email',
            message: 'Invalid email',
            code: 'invalid'
          }
        ]
      });
    });

    it('should check if field has errors', () => {
      const error = ValidationError.fromFieldErrors([
        { field: 'email', message: 'Invalid' },
        { field: 'password', message: 'Too short' }
      ]);

      expect(error.hasFieldError('email')).toBe(true);
      expect(error.hasFieldError('password')).toBe(true);
      expect(error.hasFieldError('username')).toBe(false);
    });

    it('should get errors for specific field', () => {
      const error = ValidationError.fromFieldErrors([
        { field: 'email', message: 'Invalid format', code: 'format' },
        { field: 'email', message: 'Already exists', code: 'unique' },
        { field: 'password', message: 'Too short', code: 'min' }
      ]);

      const emailErrors = error.getFieldErrors('email');

      expect(emailErrors).toHaveLength(2);
      expect(emailErrors[0]).toEqual({ message: 'Invalid format', code: 'format' });
      expect(emailErrors[1]).toEqual({ message: 'Already exists', code: 'unique' });
    });

    it('should serialize to JSON correctly', () => {
      const error = ValidationError.fromFieldErrors([
        { field: 'email', message: 'Invalid' }
      ]);

      const json = error.toJSON();

      expect(json).toHaveProperty('code');
      expect(json).toHaveProperty('message');
      expect(json).toHaveProperty('validationErrors');
      expect(json.validationErrors).toHaveLength(1);
    });

    it('should preserve expected and received values from Zod', () => {
      const zodError = new z.ZodError([
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'number',
          path: ['age'],
          message: 'Expected string'
        }
      ]);

      const error = ValidationError.fromZodError(zodError);

      expect(error.validationErrors[0].expected).toBe('string');
      expect(error.validationErrors[0].received).toBe('number');
    });
  });

  describe('ServiceError', () => {
    it('should create service error', () => {
      const error = new ServiceError(400, { field: 'email' }, 'Invalid email');

      expect(error.code).toBe(400);
      expect(error.message).toBe('Invalid email');
      expect(error.details).toEqual({ field: 'email' });
    });

    it('should use default message', () => {
      const error = new ServiceError(404, { id: '123' });

      expect(error.message).toBe('Service error: 404');
    });

    it('should create with validation', () => {
      const schema = z.object({
        field: z.string(),
        value: z.number()
      });

      const error = ServiceError.withValidation(400, schema, {
        field: 'email',
        value: 123
      });

      expect(error.code).toBe(400);
      expect(error.details).toEqual({ field: 'email', value: 123 });
    });

    it('should throw ValidationError for invalid data', () => {
      const schema = z.object({
        field: z.string()
      });

      expect(() => {
        ServiceError.withValidation(400, schema, {
          field: 123 // Wrong type
        });
      }).toThrow(ValidationError);
    });
  });

  describe('ValidateInput decorator', () => {
    it('should validate input successfully', async () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18)
      });

      class TestService {
        @ValidateInput(schema)
        async createUser(input: unknown) {
          return input;
        }
      }

      const service = new TestService();
      const result = await service.createUser({
        email: 'test@example.com',
        age: 25
      });

      expect(result).toEqual({
        email: 'test@example.com',
        age: 25
      });
    });

    it('should throw ValidationError for invalid input', async () => {
      const schema = z.object({
        email: z.string().email()
      });

      class TestService {
        @ValidateInput(schema)
        async createUser(input: unknown) {
          return input;
        }
      }

      const service = new TestService();

      await expect(
        service.createUser({ email: 'invalid-email' })
      ).rejects.toThrow(ValidationError);
    });

    it('should pass validated data to method', async () => {
      const schema = z.object({
        value: z.number()
      });

      class TestService {
        @ValidateInput(schema)
        async process(input: { value: number }) {
          return input.value * 2;
        }
      }

      const service = new TestService();
      const result = await service.process({ value: 21 });

      expect(result).toBe(42);
    });
  });

  describe('ValidateOutput decorator', () => {
    it('should validate output successfully', async () => {
      const schema = z.object({
        id: z.string(),
        name: z.string()
      });

      class TestService {
        @ValidateOutput(schema)
        async getUser() {
          return { id: '123', name: 'John' };
        }
      }

      const service = new TestService();
      const result = await service.getUser();

      expect(result).toEqual({ id: '123', name: 'John' });
    });

    it('should throw error for invalid output', async () => {
      const schema = z.object({
        id: z.string()
      });

      class TestService {
        @ValidateOutput(schema)
        async getUser() {
          return { id: 123 }; // Wrong type
        }
      }

      const service = new TestService();

      await expect(service.getUser()).rejects.toThrow();
    });

    it('should strip extra fields when schema is strict', async () => {
      const schema = z.object({
        name: z.string()
      }).strict();

      class TestService {
        @ValidateOutput(schema)
        async getData() {
          return { name: 'test', extra: 'field' };
        }
      }

      const service = new TestService();

      // Should throw because strict mode doesn't allow extra fields
      await expect(service.getData()).rejects.toThrow();
    });
  });

  describe('Validate decorator (input + output)', () => {
    it('should validate both input and output', async () => {
      const inputSchema = z.object({
        id: z.string()
      });

      const outputSchema = z.object({
        id: z.string(),
        name: z.string()
      });

      class TestService {
        @Validate(inputSchema, outputSchema)
        async getUser(input: { id: string }) {
          return { id: input.id, name: 'John' };
        }
      }

      const service = new TestService();
      const result = await service.getUser({ id: '123' });

      expect(result).toEqual({ id: '123', name: 'John' });
    });

    it('should throw for invalid input', async () => {
      const inputSchema = z.object({
        id: z.number()
      });

      const outputSchema = z.object({
        result: z.boolean()
      });

      class TestService {
        @Validate(inputSchema, outputSchema)
        async process(input: unknown) {
          return { result: true };
        }
      }

      const service = new TestService();

      await expect(
        service.process({ id: 'not-a-number' })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw for invalid output', async () => {
      const inputSchema = z.object({
        value: z.number()
      });

      const outputSchema = z.object({
        result: z.string()
      });

      class TestService {
        @Validate(inputSchema, outputSchema)
        async process(input: { value: number }) {
          return { result: 123 }; // Wrong type
        }
      }

      const service = new TestService();

      await expect(
        service.process({ value: 10 })
      ).rejects.toThrow();
    });
  });

  describe('createValidationMiddleware()', () => {
    it('should create validation middleware', () => {
      const schema = z.object({
        email: z.string().email()
      });

      const middleware = createValidationMiddleware(schema);
      const result = middleware({ email: 'test@example.com' });

      expect(result).toEqual({ email: 'test@example.com' });
    });

    it('should throw ValidationError for invalid data', () => {
      const schema = z.object({
        age: z.number()
      });

      const middleware = createValidationMiddleware(schema);

      expect(() => {
        middleware({ age: 'not-a-number' });
      }).toThrow(ValidationError);
    });

    it('should support stripUnknown option', () => {
      const schema = z.object({
        name: z.string()
      });

      const middleware = createValidationMiddleware(schema, {
        stripUnknown: true
      });

      const result = middleware({ name: 'test', extra: 'field' });

      expect(result).toEqual({ name: 'test' });
    });

    it('should support abortEarly option', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18)
      });

      const middleware = createValidationMiddleware(schema, {
        abortEarly: true
      });

      try {
        middleware({ email: 'invalid', age: 10 });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        // With abortEarly, should only have 1 error
        expect(validationError.validationErrors).toHaveLength(1);
      }
    });

    it('should handle nested objects', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email()
        })
      });

      const middleware = createValidationMiddleware(schema);
      const result = middleware({
        user: {
          name: 'John',
          email: 'john@example.com'
        }
      });

      expect(result.user.name).toBe('John');
      expect(result.user.email).toBe('john@example.com');
    });

    it('should handle arrays', () => {
      const schema = z.object({
        items: z.array(z.string())
      });

      const middleware = createValidationMiddleware(schema);
      const result = middleware({
        items: ['a', 'b', 'c']
      });

      expect(result.items).toEqual(['a', 'b', 'c']);
    });
  });
});
