/**
 * Tests for ValidationMiddleware - TDD approach
 */

import 'reflect-metadata';
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

    it('should skip methods not in service', () => {
      const service = {
        async existingMethod(input: any) {
          return input;
        }
      };

      const serviceContract = contract({
        existingMethod: {
          input: z.string(),
          output: z.string()
        },
        missingMethod: {
          input: z.string(),
          output: z.string()
        }
      });

      const wrappedService = middleware.wrapService(service, serviceContract);

      expect(wrappedService.existingMethod).toBeDefined();
      expect((wrappedService as any).missingMethod).toBeUndefined();
    });

    it('should skip non-function properties', () => {
      const service = {
        async method(input: any) {
          return input;
        },
        property: 'not-a-function'
      };

      const serviceContract = contract({
        method: {
          input: z.string(),
          output: z.string()
        },
        property: {
          input: z.string(),
          output: z.string()
        }
      });

      const wrappedService = middleware.wrapService(service, serviceContract);

      expect(wrappedService.method).toBeDefined();
      expect((wrappedService as any).property).toBe('not-a-function');
    });
  });

  describe('createHandler', () => {
    it('should create handler with hooks', async () => {
      const service = {
        async process(input: any) {
          return { processed: true, ...input };
        }
      };

      const serviceContract = contract({
        process: {
          input: z.object({ value: z.number() }),
          output: z.object({ processed: z.boolean(), value: z.number() })
        }
      });

      const beforeCalls: any[] = [];
      const afterCalls: any[] = [];

      const handler = middleware.createHandler(service, serviceContract, {
        beforeValidation: (method, input) => {
          beforeCalls.push({ method, input });
        },
        afterValidation: (method, output) => {
          afterCalls.push({ method, output });
        }
      });

      await handler.process({ value: 42 });

      expect(beforeCalls).toHaveLength(1);
      expect(beforeCalls[0].method).toBe('process');
      expect(beforeCalls[0].input).toEqual({ value: 42 });

      expect(afterCalls).toHaveLength(1);
      expect(afterCalls[0].method).toBe('process');
      expect(afterCalls[0].output).toEqual({ processed: true, value: 42 });
    });

    it('should call error hook on validation failure', async () => {
      const service = {
        async process(input: any) {
          return input;
        }
      };

      const serviceContract = contract({
        process: {
          input: z.object({ value: z.number() }),
          output: z.object({ value: z.number() })
        }
      });

      const errorCalls: any[] = [];

      const handler = middleware.createHandler(service, serviceContract, {
        onError: (method, error) => {
          errorCalls.push({ method, error });
        }
      });

      try {
        await handler.process({ value: 'invalid' });
        fail('Should have thrown');
      } catch (error) {
        expect(errorCalls).toHaveLength(1);
        expect(errorCalls[0].method).toBe('process');
        expect(errorCalls[0].error).toBeDefined();
      }
    });

    it('should work without hooks', async () => {
      const service = {
        async process(input: any) {
          return input;
        }
      };

      const serviceContract = contract({
        process: {
          input: z.object({ value: z.number() }),
          output: z.object({ value: z.number() })
        }
      });

      const handler = middleware.createHandler(service, serviceContract);

      const result = await handler.process({ value: 42 });
      expect(result).toEqual({ value: 42 });
    });

    it('should access non-function properties', () => {
      const service = {
        async process(input: any) {
          return input;
        },
        config: { setting: 'value' }
      };

      const serviceContract = contract({
        process: {
          input: z.any(),
          output: z.any()
        }
      });

      const handler = middleware.createHandler(service, serviceContract, {});

      expect((handler as any).config).toEqual({ setting: 'value' });
    });
  });

  describe('shouldSkipValidation', () => {
    it('should skip validation when metadata has skipValidation', () => {
      const service = { method() { } };

      const shouldSkip = middleware.shouldSkipValidation(
        service,
        'method',
        { skipValidation: true }
      );

      expect(shouldSkip).toBe(true);
    });

    it('should skip validation when @NoValidation is used', () => {
      const service = { method() { } };

      Reflect.defineMetadata('validation:disabled', true, service, 'method');

      const shouldSkip = middleware.shouldSkipValidation(service, 'method');

      expect(shouldSkip).toBe(true);
    });

    it('should not skip validation by default', () => {
      const service = { method() { } };

      const shouldSkip = middleware.shouldSkipValidation(service, 'method');

      expect(shouldSkip).toBe(false);
    });
  });

  describe('getMethodContract', () => {
    it('should get method-level validation contract', () => {
      const service = { method() { } };
      const methodContract = {
        input: z.string(),
        output: z.string()
      };

      Reflect.defineMetadata('validation:method', methodContract, service, 'method');

      const retrieved = middleware.getMethodContract(service, 'method');

      expect(retrieved).toBe(methodContract);
    });

    it('should get class contract for method', () => {
      const service = { method() { } };
      const classContract = contract({
        method: {
          input: z.string(),
          output: z.string()
        }
      });

      const retrieved = middleware.getMethodContract(service, 'method', classContract);

      expect(retrieved).toBeDefined();
      expect(retrieved?.input).toBeDefined();
      expect(retrieved?.output).toBeDefined();
    });

    it('should prioritize method-level over class contract', () => {
      const service = { method() { } };
      const methodContract = {
        input: z.number(),
        output: z.number()
      };
      const classContract = contract({
        method: {
          input: z.string(),
          output: z.string()
        }
      });

      Reflect.defineMetadata('validation:method', methodContract, service, 'method');

      const retrieved = middleware.getMethodContract(service, 'method', classContract);

      expect(retrieved).toBe(methodContract);
    });

    it('should return undefined when no contract found', () => {
      const service = { method() { } };

      const retrieved = middleware.getMethodContract(service, 'method');

      expect(retrieved).toBeUndefined();
    });
  });

  describe('applyToInstance', () => {
    it('should apply validation to instance with contract', async () => {
      class UserService {
        async createUser(input: any) {
          return { id: '123', ...input };
        }
      }

      const serviceContract = contract({
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        }
      });

      Reflect.defineMetadata('validation:contract', serviceContract, UserService);

      const instance = new UserService();
      const wrapped = middleware.applyToInstance(instance);

      const result = await wrapped.createUser({ name: 'Test' });
      expect(result).toEqual({ id: '123', name: 'Test' });
    });

    it('should return instance unchanged when no contract', () => {
      class SimpleService {
        async method(input: any) {
          return input;
        }
      }

      const instance = new SimpleService();
      const wrapped = middleware.applyToInstance(instance);

      expect(wrapped).toBe(instance);
    });

    it('should merge class options with provided options', async () => {
      class UserService {
        async process(input: any) {
          return input;
        }
      }

      const serviceContract = contract({
        process: {
          input: z.object({ value: z.number() }),
          output: z.object({ value: z.number() })
        }
      });

      Reflect.defineMetadata('validation:contract', serviceContract, UserService);
      Reflect.defineMetadata('validation:options', { mode: 'strip' }, UserService);

      const instance = new UserService();
      const wrapped = middleware.applyToInstance(instance, undefined, { coerce: true });

      // Should work with coercion
      const result = await wrapped.process({ value: '42' } as any);
      expect(result.value).toBe(42);
    });

    it('should use provided contract over class contract', async () => {
      class UserService {
        async process(input: any) {
          return input;
        }
      }

      const classContract = contract({
        process: {
          input: z.string(),
          output: z.string()
        }
      });

      const overrideContract = contract({
        process: {
          input: z.number(),
          output: z.number()
        }
      });

      Reflect.defineMetadata('validation:contract', classContract, UserService);

      const instance = new UserService();
      const wrapped = middleware.applyToInstance(instance, overrideContract);

      const result = await wrapped.process(42);
      expect(result).toBe(42);

      await expect(wrapped.process('string')).rejects.toThrow();
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should throw when wrapping non-existent method', () => {
      const service = {};

      const methodContract = {
        input: z.string(),
        output: z.string()
      };

      expect(() => {
        middleware.wrapMethod(service, 'nonExistent', methodContract);
      }).toThrow();
    });

    it('should throw when streaming method does not return async generator', async () => {
      const service = {
        notAGenerator(input: any) {
          return 'not a generator';
        }
      };

      const methodContract = {
        input: z.any(),
        output: z.any(),
        stream: true
      };

      const wrapped = middleware.wrapMethod(service, 'notAGenerator', methodContract);

      try {
        const generator = wrapped.call(service, {}) as AsyncGenerator;
        await generator.next();
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('async generator');
      }
    });

    it('should handle multiple arguments in wrapped methods', async () => {
      const service = {
        async methodWithMultipleArgs(input: any, arg2: string, arg3: number) {
          return { input, arg2, arg3 };
        }
      };

      const methodContract = {
        input: z.object({ value: z.number() }),
        output: z.any()
      };

      const wrapped = middleware.wrapMethod(service, 'methodWithMultipleArgs', methodContract);

      const result = await wrapped.call(service, { value: 42 }, 'test', 123);
      expect(result).toEqual({
        input: { value: 42 },
        arg2: 'test',
        arg3: 123
      });
    });
  });
});