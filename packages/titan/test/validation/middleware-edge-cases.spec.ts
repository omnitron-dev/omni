/**
 * Edge cases and advanced scenarios for ValidationMiddleware
 */

import 'reflect-metadata';
import { z } from 'zod';
import { ValidationMiddleware } from '../../src/validation/validation-middleware.js';
import { ValidationEngine } from '../../src/validation/validation-engine.js';
import { contract } from '../../src/validation/contract.js';

describe('ValidationMiddleware - Edge Cases', () => {
  let middleware: ValidationMiddleware;
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
    middleware = new ValidationMiddleware(engine);
  });

  describe('context binding', () => {
    it('should maintain correct this context in wrapped methods', async () => {
      class Service {
        private value = 'test-value';

        async method(input: any) {
          return { value: this.value, input };
        }
      }

      const service = new Service();
      const methodContract = {
        input: z.object({ data: z.string() }),
        output: z.object({ value: z.string(), input: z.object({ data: z.string() }) }),
      };

      const wrapped = middleware.wrapMethod(service, 'method', methodContract);

      const result = await wrapped.call(service, { data: 'test' });
      expect(result.value).toBe('test-value');
    });

    it('should work with arrow functions', async () => {
      const service = {
        method: async (input: any) => ({ result: input.value * 2 }),
      };

      const methodContract = {
        input: z.object({ value: z.number() }),
        output: z.object({ result: z.number() }),
      };

      const wrapped = middleware.wrapMethod(service, 'method', methodContract);

      const result = await wrapped.call(service, { value: 21 });
      expect(result.result).toBe(42);
    });

    it('should handle bound methods', async () => {
      class Service {
        value = 100;

        async method(input: any) {
          return { total: this.value + input.amount };
        }
      }

      const service = new Service();
      const boundMethod = service.method.bind(service);
      service.method = boundMethod;

      const methodContract = {
        input: z.object({ amount: z.number() }),
        output: z.object({ total: z.number() }),
      };

      const wrapped = middleware.wrapMethod(service, 'method', methodContract);

      const result = await wrapped.call(service, { amount: 50 });
      expect(result.total).toBe(150);
    });
  });

  describe('validation options precedence', () => {
    it('should prioritize override options over contract options', async () => {
      const service = {
        async method(input: any) {
          return input;
        },
      };

      const methodContract = {
        input: z.object({ value: z.number(), extra: z.string() }),
        output: z.any(),
        options: {
          mode: 'strict' as const,
        },
      };

      // Override with strip mode
      const wrapped = middleware.wrapMethod(service, 'method', methodContract, {
        mode: 'strip',
      });

      // Should strip extra field instead of throwing in strict mode
      const result = await wrapped.call(service, {
        value: 42,
        extra: 'keep',
        unknown: 'should-be-stripped',
      });

      expect(result.value).toBe(42);
      expect(result.extra).toBe('keep');
      expect((result as any).unknown).toBeUndefined();
    });

    it('should merge options correctly', async () => {
      const service = {
        async method(input: any) {
          return input;
        },
      };

      const methodContract = {
        input: z.object({ age: z.number(), active: z.boolean() }),
        output: z.any(),
        options: {
          mode: 'strip' as const,
          abortEarly: true,
        },
      };

      const wrapped = middleware.wrapMethod(service, 'method', methodContract, {
        coerce: true, // Add coercion to existing options
      });

      const result = await wrapped.call(service, {
        age: '25',
        active: 'true',
      });

      expect(result.age).toBe(25);
      expect(result.active).toBe(true);
    });
  });

  describe('streaming with errors', () => {
    it('should handle errors in stream initialization', async () => {
      const service = {
        async *stream(input: any) {
          throw new Error('Initialization error');
        },
      };

      const methodContract = {
        input: z.object({ filter: z.string() }),
        output: z.object({ data: z.string() }),
        stream: true,
      };

      const wrapped = middleware.wrapMethod(service, 'stream', methodContract);

      const generator = wrapped.call(service, { filter: 'test' }) as AsyncGenerator;

      try {
        await generator.next();
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBe('Initialization error');
      }
    });

    it('should handle validation errors mid-stream', async () => {
      const service = {
        async *stream(input: any) {
          yield { value: 1, valid: true };
          yield { value: 2, valid: true };
          yield { value: 'invalid', valid: false }; // Invalid type
          yield { value: 4, valid: true };
        },
      };

      const methodContract = {
        input: z.object({ limit: z.number().optional() }),
        output: z.object({ value: z.number(), valid: z.boolean() }),
        stream: true,
      };

      const wrapped = middleware.wrapMethod(service, 'stream', methodContract);

      const results: any[] = [];
      const generator = wrapped.call(service, { limit: 10 }) as AsyncGenerator;

      try {
        for await (const item of generator) {
          results.push(item);
        }
        fail('Should have thrown');
      } catch (error) {
        expect(results).toHaveLength(2);
        expect(error).toBeDefined();
      }
    });

    it('should validate each chunk independently', async () => {
      const service = {
        async *stream(input: any) {
          for (let i = 0; i < 5; i++) {
            yield { id: i, data: `item-${i}` };
          }
        },
      };

      const methodContract = {
        input: z.object({ count: z.number() }),
        output: z.object({ id: z.number(), data: z.string() }),
        stream: true,
      };

      const wrapped = middleware.wrapMethod(service, 'stream', methodContract);

      const results: any[] = [];
      const generator = wrapped.call(service, { count: 5 }) as AsyncGenerator;

      for await (const item of generator) {
        results.push(item);
      }

      expect(results).toHaveLength(5);
      expect(results[0].data).toBe('item-0');
      expect(results[4].data).toBe('item-4');
    });
  });

  describe('service wrapping edge cases', () => {
    it('should handle services with getters and setters', () => {
      class Service {
        private _value = 0;

        get value() {
          return this._value;
        }

        set value(val: number) {
          this._value = val;
        }

        async method(input: any) {
          return { value: this._value + input.amount };
        }
      }

      const service = new Service();
      const serviceContract = contract({
        method: {
          input: z.object({ amount: z.number() }),
          output: z.object({ value: z.number() }),
        },
      });

      const wrapped = middleware.wrapService(service, serviceContract);

      // Getters and setters should still work
      wrapped.value = 100;
      expect(wrapped.value).toBe(100);
    });

    it('should handle services with symbols', () => {
      const sym = Symbol('test');

      const service = {
        [sym]: 'symbol-value',
        async method(input: any) {
          return { value: this[sym] };
        },
      };

      const serviceContract = contract({
        method: {
          input: z.any(),
          output: z.object({ value: z.string() }),
        },
      });

      const wrapped = middleware.wrapService(service, serviceContract);

      expect((wrapped as any)[sym]).toBe('symbol-value');
    });

    it('should preserve non-enumerable properties', () => {
      const service = {
        async method(input: any) {
          return input;
        },
      };

      Object.defineProperty(service, 'hidden', {
        value: 'secret',
        enumerable: false,
      });

      const serviceContract = contract({
        method: {
          input: z.any(),
          output: z.any(),
        },
      });

      const wrapped = middleware.wrapService(service, serviceContract);

      expect((wrapped as any).hidden).toBe('secret');
    });
  });

  describe('handler lifecycle hooks', () => {
    it('should call hooks in correct order', async () => {
      const service = {
        async method(input: any) {
          return { processed: true, ...input };
        },
      };

      const serviceContract = contract({
        method: {
          input: z.object({ value: z.number() }),
          output: z.object({ processed: z.boolean(), value: z.number() }),
        },
      });

      const calls: string[] = [];

      const handler = middleware.createHandler(service, serviceContract, {
        beforeValidation: (method, input) => {
          calls.push(`before:${method}`);
        },
        afterValidation: (method, output) => {
          calls.push(`after:${method}`);
        },
      });

      await handler.method({ value: 42 });

      expect(calls).toEqual(['before:method', 'after:method']);
    });

    it('should call onError hook only on errors', async () => {
      const service = {
        async success(input: any) {
          return input;
        },
        async failure(input: any) {
          return { invalid: 'output' };
        },
      };

      const serviceContract = contract({
        success: {
          input: z.object({ value: z.number() }),
          output: z.object({ value: z.number() }),
        },
        failure: {
          input: z.object({ value: z.number() }),
          output: z.object({ value: z.number() }),
        },
      });

      const errors: string[] = [];

      const handler = middleware.createHandler(service, serviceContract, {
        onError: (method, error) => {
          errors.push(method);
        },
      });

      // Success - no error
      await handler.success({ value: 42 });
      expect(errors).toHaveLength(0);

      // Failure - error should be caught
      try {
        await handler.failure({ value: 42 });
      } catch (error) {
        // Expected
      }

      expect(errors).toEqual(['failure']);
    });

    it('should allow error hook to log but not suppress errors', async () => {
      const service = {
        async method(input: any) {
          return input;
        },
      };

      const serviceContract = contract({
        method: {
          input: z.object({ value: z.string() }),
          output: z.object({ value: z.string() }),
        },
      });

      let errorLogged = false;

      const handler = middleware.createHandler(service, serviceContract, {
        onError: (method, error) => {
          errorLogged = true;
        },
      });

      try {
        await handler.method({ value: 123 }); // Invalid type
        fail('Should have thrown');
      } catch (error) {
        expect(errorLogged).toBe(true);
        expect(error).toBeDefined();
      }
    });
  });

  describe('method resolution', () => {
    it('should handle methods with same name on different objects', () => {
      const service1 = {
        async method(input: any) {
          return { source: 'service1', ...input };
        },
      };

      const service2 = {
        async method(input: any) {
          return { source: 'service2', ...input };
        },
      };

      const methodContract = {
        input: z.object({ data: z.string() }),
        output: z.object({ source: z.string(), data: z.string() }),
      };

      const wrapped1 = middleware.wrapMethod(service1, 'method', methodContract);
      const wrapped2 = middleware.wrapMethod(service2, 'method', methodContract);

      expect(wrapped1).not.toBe(wrapped2);
    });

    it('should handle prototype chain correctly', async () => {
      class BaseService {
        async baseMethod(input: any) {
          return { type: 'base', ...input };
        }
      }

      class DerivedService extends BaseService {
        async derivedMethod(input: any) {
          return { type: 'derived', ...input };
        }
      }

      const service = new DerivedService();

      const serviceContract = contract({
        baseMethod: {
          input: z.object({ value: z.number() }),
          output: z.object({ type: z.string(), value: z.number() }),
        },
        derivedMethod: {
          input: z.object({ value: z.number() }),
          output: z.object({ type: z.string(), value: z.number() }),
        },
      });

      const wrapped = middleware.wrapService(service, serviceContract);

      const result1 = await wrapped.baseMethod({ value: 1 });
      const result2 = await wrapped.derivedMethod({ value: 2 });

      expect(result1.type).toBe('base');
      expect(result2.type).toBe('derived');
    });
  });

  describe('async generator edge cases', () => {
    it('should handle generator that throws after yielding', async () => {
      const service = {
        async *stream(input: any) {
          yield { value: 1 };
          yield { value: 2 };
          throw new Error('Generator error');
        },
      };

      const methodContract = {
        input: z.any(),
        output: z.object({ value: z.number() }),
        stream: true,
      };

      const wrapped = middleware.wrapMethod(service, 'stream', methodContract);

      const results: any[] = [];
      const generator = wrapped.call(service, {}) as AsyncGenerator;

      try {
        for await (const item of generator) {
          results.push(item);
        }
        fail('Should have thrown');
      } catch (error: any) {
        expect(results).toHaveLength(2);
        expect(error.message).toBe('Generator error');
      }
    });

    it('should handle early return from generator', async () => {
      const service = {
        async *stream(input: any) {
          yield { value: 1 };
          yield { value: 2 };
          yield { value: 3 };
          yield { value: 4 };
        },
      };

      const methodContract = {
        input: z.any(),
        output: z.object({ value: z.number() }),
        stream: true,
      };

      const wrapped = middleware.wrapMethod(service, 'stream', methodContract);

      const results: any[] = [];
      const generator = wrapped.call(service, {}) as AsyncGenerator;

      // Take only first 2 items
      for await (const item of generator) {
        results.push(item);
        if (results.length >= 2) {
          break;
        }
      }

      expect(results).toHaveLength(2);
    });
  });

  describe('metadata and reflection', () => {
    it('should handle missing reflection metadata gracefully', () => {
      const service = { method() {} };

      const shouldSkip = middleware.shouldSkipValidation(service, 'method');
      expect(shouldSkip).toBe(false);

      const contract = middleware.getMethodContract(service, 'method');
      expect(contract).toBeUndefined();
    });

    it('should respect skipValidation metadata', () => {
      const service = { method() {} };

      Reflect.defineMetadata('validation:disabled', true, service, 'method');

      const shouldSkip = middleware.shouldSkipValidation(service, 'method');
      expect(shouldSkip).toBe(true);
    });
  });
});
