/**
 * Tests for ValidationMiddleware - TDD approach
 */

import { z } from 'zod';
import { ValidationMiddleware } from '../../src/validation/validation-middleware.js';
import { ValidationEngine } from '../../src/validation/validation-engine.js';
import { contract } from '../../src/validation/contract.js';

describe('ValidationMiddleware', () => {
  let middleware: ValidationMiddleware;
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
    middleware = new ValidationMiddleware(engine);
  });

  describe('wrapMethod', () => {
    it('should wrap methods with validation', async () => {
      const service = {
        async createUser(input: any) {
          return { id: '123', ...input };
        }
      };

      const methodContract = {
        input: z.object({
          email: z.string().email(),
          name: z.string().min(2)
        }),
        output: z.object({
          id: z.string(),
          email: z.string().email(),
          name: z.string()
        })
      };

      const wrapped = middleware.wrapMethod(service, 'createUser', methodContract);

      // Valid input
      const result = await wrapped.call(service, {
        email: 'test@example.com',
        name: 'Test User'
      });

      expect(result).toEqual({
        id: '123',
        email: 'test@example.com',
        name: 'Test User'
      });

      // Invalid input should throw
      await expect(wrapped.call(service, {
        email: 'invalid',
        name: 'a'
      })).rejects.toThrow();
    });

    it('should handle methods without validation', async () => {
      const service = {
        async noValidation(input: any) {
          return input;
        }
      };

      const wrapped = middleware.wrapMethod(service, 'noValidation');

      const result = await wrapped.call(service, { any: 'data' });
      expect(result).toEqual({ any: 'data' });
    });

    it('should validate only input', async () => {
      const service = {
        async inputOnly(input: any) {
          return { processed: true, ...input };
        }
      };

      const methodContract = {
        input: z.object({
          required: z.string()
        })
      };

      const wrapped = middleware.wrapMethod(service, 'inputOnly', methodContract);

      // Valid input
      const result = await wrapped.call(service, { required: 'value' });
      expect(result).toEqual({ processed: true, required: 'value' });

      // Invalid input
      await expect(wrapped.call(service, {})).rejects.toThrow();
    });

    it('should validate only output', async () => {
      const service = {
        async outputOnly(input: any) {
          return input;
        }
      };

      const methodContract = {
        output: z.object({
          id: z.string(),
          name: z.string()
        })
      };

      const wrapped = middleware.wrapMethod(service, 'outputOnly', methodContract);

      // Valid output
      const result = await wrapped.call(service, {
        id: '123',
        name: 'Test'
      });
      expect(result).toEqual({ id: '123', name: 'Test' });

      // Invalid output
      await expect(wrapped.call(service, {
        id: '123'
        // missing name
      })).rejects.toThrow();
    });
  });

  describe('streaming methods', () => {
    it('should validate streaming methods', async () => {
      const service = {
        async *streamUsers(filter: any) {
          yield { id: '1', name: 'User 1' };
          yield { id: '2', name: 'User 2' };
          yield { id: 'invalid', name: 123 }; // Invalid
        }
      };

      const methodContract = {
        input: z.object({
          limit: z.number().optional()
        }),
        output: z.object({
          id: z.string(),
          name: z.string()
        }),
        stream: true
      };

      const wrapped = middleware.wrapMethod(service, 'streamUsers', methodContract);

      const results: any[] = [];
      const generator = wrapped.call(service, { limit: 10 }) as AsyncGenerator;

      try {
        for await (const item of generator) {
          results.push(item);
        }
        fail('Should have thrown on invalid item');
      } catch (error) {
        // Should fail on third item
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({ id: '1', name: 'User 1' });
        expect(results[1]).toEqual({ id: '2', name: 'User 2' });
      }
    });

    it('should validate stream input once', async () => {
      let validateCount = 0;

      const service = {
        async *streamData(input: any) {
          validateCount++;
          yield { value: 1 };
          yield { value: 2 };
        }
      };

      const methodContract = {
        input: z.object({
          filter: z.string()
        }),
        output: z.object({
          value: z.number()
        }),
        stream: true
      };

      const wrapped = middleware.wrapMethod(service, 'streamData', methodContract);

      // Invalid input should fail immediately
      const generator = wrapped.call(service, { invalid: 'input' }) as AsyncGenerator;

      try {
        // Try to get first item
        await generator.next();
        fail('Should have thrown on invalid input');
      } catch (error) {
        expect(validateCount).toBe(0); // Should not reach the method
      }
    });
  });

  describe('error handling', () => {
    it('should preserve original errors when output validation fails', async () => {
      const service = {
        async failingMethod() {
          return { invalid: 'output' };
        }
      };

      const methodContract = {
        output: z.object({
          id: z.string(),
          name: z.string()
        })
      };

      const wrapped = middleware.wrapMethod(service, 'failingMethod', methodContract);

      try {
        await wrapped.call(service);
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.code).toBe('VALIDATION_ERROR');
      }
    });

    it('should handle async errors in wrapped methods', async () => {
      const service = {
        async errorMethod() {
          throw new Error('Original error');
        }
      };

      const methodContract = {
        input: z.any(),
        output: z.any()
      };

      const wrapped = middleware.wrapMethod(service, 'errorMethod', methodContract);

      await expect(wrapped.call(service)).rejects.toThrow('Original error');
    });
  });

  describe('transform support', () => {
    it('should apply input transforms', async () => {
      const service = {
        async echo(input: any) {
          return input;
        }
      };

      const methodContract = {
        input: z.object({
          email: z.string().email().transform(s => s.toLowerCase()),
          age: z.string().transform(s => parseInt(s, 10))
        })
      };

      const wrapped = middleware.wrapMethod(service, 'echo', methodContract);

      const result = await wrapped.call(service, {
        email: 'TEST@EXAMPLE.COM',
        age: '25'
      });

      expect(result).toEqual({
        email: 'test@example.com',
        age: 25
      });
    });

    it('should apply output transforms', async () => {
      const service = {
        async getData() {
          return {
            date: '2024-01-01',
            count: '100'
          };
        }
      };

      const methodContract = {
        output: z.object({
          date: z.string().transform(s => new Date(s)),
          count: z.string().transform(s => parseInt(s, 10))
        })
      };

      const wrapped = middleware.wrapMethod(service, 'getData', methodContract);

      const result = await wrapped.call(service);

      expect(result.date).toBeInstanceOf(Date);
      expect(result.count).toBe(100);
    });
  });

  describe('performance', () => {
    it('should cache validators for repeated calls', async () => {
      const service = {
        async method(input: any) {
          return input;
        }
      };

      const methodContract = {
        input: z.object({ value: z.number() }),
        output: z.object({ value: z.number() })
      };

      const wrapped = middleware.wrapMethod(service, 'method', methodContract);

      // Multiple calls should use cached validators
      const promises = Array.from({ length: 100 }, (_, i) =>
        wrapped.call(service, { value: i })
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(100);
      results.forEach((result, i) => {
        expect(result).toEqual({ value: i });
      });
    });
  });

  describe('wrapService', () => {
    it('should wrap all methods of a service', () => {
      const service = {
        async method1(input: any) { return input; },
        async method2(input: any) { return input; },
        async method3(input: any) { return input; }
      };

      const serviceContract = contract({
        method1: {
          input: z.string(),
          output: z.string()
        },
        method2: {
          input: z.number(),
          output: z.number()
        }
        // method3 has no contract
      });

      const wrappedService = middleware.wrapService(service, serviceContract);

      expect(wrappedService).toBeDefined();
      expect(wrappedService.method1).toBeDefined();
      expect(wrappedService.method2).toBeDefined();
      expect(wrappedService.method3).toBeDefined();
    });

    it('should validate wrapped service methods', async () => {
      const service = {
        async createUser(input: any) {
          return { id: '123', ...input };
        },
        async getUser(id: any) {
          return { id, name: 'Test User' };
        }
      };

      const serviceContract = contract({
        createUser: {
          input: z.object({
            email: z.string().email(),
            name: z.string()
          }),
          output: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string()
          })
        },
        getUser: {
          input: z.string().uuid(),
          output: z.object({
            id: z.string(),
            name: z.string()
          })
        }
      });

      const wrappedService = middleware.wrapService(service, serviceContract);

      // Valid call
      const user = await wrappedService.createUser({
        email: 'test@example.com',
        name: 'Test'
      });
      expect(user.id).toBe('123');

      // Invalid call
      await expect(wrappedService.getUser('not-a-uuid')).rejects.toThrow();
    });
  });
});