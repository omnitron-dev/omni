/**
 * Tests for EventValidationService
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { z } from 'zod';

import 'reflect-metadata';
import { EventValidationService } from '../../../src/modules/events/event-validation.service';

describe('EventValidationService', () => {
  let validationService: EventValidationService;

  beforeEach(() => {
    validationService = new EventValidationService();
  });

  it('should validate event names', () => {
    expect(validationService.isValidEventName('valid.event')).toBe(true);
    expect(validationService.isValidEventName('also.valid.event')).toBe(true);
    expect(validationService.isValidEventName('123invalid')).toBe(false);
    expect(validationService.isValidEventName('')).toBe(false);
    expect(validationService.isValidEventName('invalid..event')).toBe(false);
  });

  it('should validate event data', () => {
    const schema = {
      type: 'object',
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['id'],
    };

    validationService.registerSchema('user.event', schema);

    expect(validationService.validateData('user.event', { id: 1, name: 'John' })).toBe(true);
    expect(validationService.validateData('user.event', { name: 'John' })).toBe(false);
    expect(validationService.validateData('user.event', { id: '1', name: 'John' })).toBe(false);
  });

  it('should validate handler signature', () => {
    const validHandler = (data: any) => {};
    const asyncHandler = async (data: any) => {};
    const invalidHandler = 'not a function';

    expect(validationService.isValidHandler(validHandler)).toBe(true);
    expect(validationService.isValidHandler(asyncHandler)).toBe(true);
    expect(validationService.isValidHandler(invalidHandler as any)).toBe(false);
  });

  it('should sanitize event data', () => {
    const data = {
      name: 'John',
      password: 'secret123',
      ssn: '123-45-6789',
      safe: 'value',
    };

    const sanitized = validationService.sanitizeData(data);
    expect(sanitized.name).toBe('John');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.ssn).toBe('[REDACTED]');
    expect(sanitized.safe).toBe('value');
  });

  describe('Schema Validation with Zod', () => {
    it('should validate nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              email: { type: 'string' },
            },
            required: ['id', 'name'],
          },
        },
        required: ['user'],
      };

      validationService.registerSchema('user.created', schema);

      expect(
        validationService.validateData('user.created', {
          user: { id: 1, name: 'John', email: 'john@example.com' },
        })
      ).toBe(true);

      expect(
        validationService.validateData('user.created', {
          user: { id: 1 },
        })
      ).toBe(false);

      expect(
        validationService.validateData('user.created', {
          user: { name: 'John' },
        })
      ).toBe(false);
    });

    it('should validate arrays', () => {
      const schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'number' },
                name: { type: 'string' },
              },
              required: ['id'],
            },
            minItems: 1,
            maxItems: 10,
          },
        },
        required: ['items'],
      };

      validationService.registerSchema('items.list', schema);

      expect(
        validationService.validateData('items.list', {
          items: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
          ],
        })
      ).toBe(true);

      expect(validationService.validateData('items.list', { items: [] })).toBe(false);

      expect(
        validationService.validateData('items.list', {
          items: [{ name: 'Invalid' }],
        })
      ).toBe(false);
    });

    it('should validate string constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          username: {
            type: 'string',
            minLength: 3,
            maxLength: 20,
            pattern: '^[a-zA-Z0-9_]+$',
          },
        },
        required: ['username'],
      };

      validationService.registerSchema('user.validate', schema);

      expect(validationService.validateData('user.validate', { username: 'john_doe' })).toBe(true);
      expect(validationService.validateData('user.validate', { username: 'ab' })).toBe(false);
      expect(validationService.validateData('user.validate', { username: 'a'.repeat(25) })).toBe(false);
      expect(validationService.validateData('user.validate', { username: 'john-doe!' })).toBe(false);
    });

    it('should validate number constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          age: {
            type: 'integer',
            minimum: 0,
            maximum: 120,
          },
          score: {
            type: 'number',
            minimum: 0,
            maximum: 100,
          },
        },
        required: ['age'],
      };

      validationService.registerSchema('score.validate', schema);

      expect(validationService.validateData('score.validate', { age: 25, score: 85.5 })).toBe(true);
      expect(validationService.validateData('score.validate', { age: -1 })).toBe(false);
      expect(validationService.validateData('score.validate', { age: 150 })).toBe(false);
      expect(validationService.validateData('score.validate', { age: 25.5 })).toBe(false);
    });

    it('should support direct Zod schema registration', () => {
      const zodSchema = z.object({
        email: z.string().email(),
        age: z.number().int().positive().max(120),
        tags: z.array(z.string()).min(1).max(5),
      });

      validationService.registerSchema('user.zod', zodSchema as any);

      expect(
        validationService.validateData('user.zod', {
          email: 'test@example.com',
          age: 30,
          tags: ['developer', 'typescript'],
        })
      ).toBe(true);

      expect(
        validationService.validateData('user.zod', {
          email: 'invalid-email',
          age: 30,
          tags: ['developer'],
        })
      ).toBe(false);
    });

    it('should provide detailed error messages', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'number' },
          name: { type: 'string', minLength: 3 },
        },
        required: ['id', 'name'],
      };

      validationService.registerSchema('test.errors', schema);

      const result = validationService.validate('test.errors', { id: '123', name: 'ab' });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Transformer Registry', () => {
    it('should register and apply transformers', () => {
      const transformer = (data: any) => ({
        ...data,
        timestamp: Date.now(),
        transformed: true,
      });

      validationService.registerTransformer('data.transform', transformer);

      expect(validationService.hasTransformer('data.transform')).toBe(true);

      const result = validationService.validateAndTransform('data.transform', { value: 123 });

      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.transformed).toBe(true);
      expect(result.data?.timestamp).toBeDefined();
    });

    it('should support wildcard transformer patterns', () => {
      const uppercaseTransformer = (data: any) => ({
        ...data,
        name: data.name?.toUpperCase(),
      });

      validationService.registerTransformer('user.*', uppercaseTransformer);

      const result1 = validationService.validateAndTransform('user.created', { name: 'john' });
      expect(result1.data?.name).toBe('JOHN');

      const result2 = validationService.validateAndTransform('user.updated', { name: 'jane' });
      expect(result2.data?.name).toBe('JANE');
    });

    it('should remove transformers', () => {
      const transformer = (data: any) => data;
      validationService.registerTransformer('test.event', transformer);

      expect(validationService.hasTransformer('test.event')).toBe(true);

      validationService.removeTransformer('test.event');

      expect(validationService.hasTransformer('test.event')).toBe(false);
    });

    it('should handle transformer errors', () => {
      const errorTransformer = () => {
        throw new Error('Transformation failed');
      };

      validationService.registerTransformer('error.event', errorTransformer);

      const result = validationService.validateAndTransform('error.event', { value: 123 });

      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0]).toContain('Transformation failed');
    });

    it('should validate before transforming', () => {
      const schema = {
        type: 'object',
        properties: {
          value: { type: 'number' },
        },
        required: ['value'],
      };

      validationService.registerSchema('validate.transform', schema);
      validationService.registerTransformer('validate.transform', (data: any) => ({
        ...data,
        doubled: data.value * 2,
      }));

      const validResult = validationService.validateAndTransform('validate.transform', { value: 10 });
      expect(validResult.valid).toBe(true);
      expect(validResult.data?.doubled).toBe(20);

      const invalidResult = validationService.validateAndTransform('validate.transform', {
        value: 'not a number',
      });
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.data).toBeUndefined();
    });
  });

  describe('Lifecycle and Health', () => {
    it('should initialize and report healthy status', async () => {
      await validationService.onInit();

      const health = await validationService.health();
      expect(health.status).toBe('healthy');
      expect(health.details?.initialized).toBe(true);
      expect(health.details?.destroyed).toBe(false);
    });

    it('should track registered schemas and transformers in health', async () => {
      validationService.registerSchema('test.event', { type: 'object' });
      validationService.registerTransformer('test.event', (data: any) => data);

      const health = await validationService.health();
      expect(health.details?.registeredSchemas).toBe(1);
      expect(health.details?.registeredTransformers).toBe(1);
    });

    it('should clean up on destroy', async () => {
      validationService.registerSchema('test.event', { type: 'object' });
      validationService.registerTransformer('test.event', (data: any) => data);

      await validationService.onDestroy();

      const health = await validationService.health();
      expect(health.status).toBe('unhealthy');
      expect(health.details?.destroyed).toBe(true);
    });
  });
});
