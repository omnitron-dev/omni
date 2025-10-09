/**
 * Tests for Validation Decorators - TDD approach
 */

import 'reflect-metadata';
import { z } from 'zod';
import { Contract, Validate, NoValidation, WithValidationOptions } from '../../src/decorators/validation.js';
import { contract } from '../../src/validation/contract.js';
import { ValidationMiddleware } from '../../src/validation/validation-middleware.js';
import { ValidationEngine } from '../../src/validation/validation-engine.js';

describe('Validation Decorators', () => {
  let engine: ValidationEngine;
  let middleware: ValidationMiddleware;

  beforeEach(() => {
    engine = new ValidationEngine();
    middleware = new ValidationMiddleware(engine);
  });

  describe('@Contract decorator', () => {
    it('should apply contract to service class', () => {
      const UserContract = contract({
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        },
        getUser: {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        }
      });

      @Contract(UserContract)
      class UserService {
        async createUser(input: any) {
          return { id: '123', ...input };
        }

        async getUser(id: string) {
          return { id, name: 'Test User' };
        }
      }

      const metadata = Reflect.getMetadata('validation:contract', UserService);
      expect(metadata).toBeDefined();
      expect(metadata).toBe(UserContract);
    });

    it('should store contract metadata on prototype', () => {
      const TestContract = contract({
        method1: { input: z.string(), output: z.string() }
      });

      @Contract(TestContract)
      class TestService {
        method1(input: string) { return input; }
      }

      const service = new TestService();
      const metadata = Reflect.getMetadata('validation:contract', service.constructor);
      expect(metadata).toBe(TestContract);
    });
  });

  describe('@Validate decorator', () => {
    it('should apply validation to specific method', () => {
      class TestService {
        @Validate({
          input: z.object({ value: z.number() }),
          output: z.object({ result: z.number() })
        })
        async calculate(input: any) {
          return { result: input.value * 2 };
        }
      }

      const metadata = Reflect.getMetadata('validation:method', TestService.prototype, 'calculate');
      expect(metadata).toBeDefined();
      expect(metadata.input).toBeDefined();
      expect(metadata.output).toBeDefined();
    });

    it('should support validation options', () => {
      class TestService {
        @Validate({
          input: z.any(),
          output: z.any(),
          options: {
            mode: 'strip',
            coerce: true,
            abortEarly: false
          }
        })
        async process(input: any) {
          return input;
        }
      }

      const metadata = Reflect.getMetadata('validation:method', TestService.prototype, 'process');
      expect(metadata.options).toBeDefined();
      expect(metadata.options.mode).toBe('strip');
      expect(metadata.options.coerce).toBe(true);
      expect(metadata.options.abortEarly).toBe(false);
    });

    it('should override class-level contract', () => {
      const ServiceContract = contract({
        method1: {
          input: z.string(),
          output: z.string()
        }
      });

      @Contract(ServiceContract)
      class TestService {
        @Validate({
          input: z.number(), // Override with number
          output: z.number()
        })
        method1(input: any) {
          return input;
        }
      }

      const classMetadata = Reflect.getMetadata('validation:contract', TestService);
      const methodMetadata = Reflect.getMetadata('validation:method', TestService.prototype, 'method1');

      expect(classMetadata).toBe(ServiceContract);
      expect(methodMetadata.input).toBeDefined();
      // Method-level validation should take precedence
    });

    it('should support streaming validation', () => {
      class StreamService {
        @Validate({
          input: z.object({ limit: z.number() }),
          output: z.object({ value: z.number() }),
          stream: true
        })
        async *generate(input: any) {
          for (let i = 0; i < input.limit; i++) {
            yield { value: i };
          }
        }
      }

      const metadata = Reflect.getMetadata('validation:method', StreamService.prototype, 'generate');
      expect(metadata.stream).toBe(true);
    });
  });

  describe('@NoValidation decorator', () => {
    it('should disable validation for method', () => {
      const ServiceContract = contract({
        method1: { input: z.string(), output: z.string() },
        method2: { input: z.string(), output: z.string() }
      });

      @Contract(ServiceContract)
      class TestService {
        method1(input: any) { return input; }

        @NoValidation()
        method2(input: any) { return input; }
      }

      const metadata = Reflect.getMetadata('validation:disabled', TestService.prototype, 'method2');
      expect(metadata).toBe(true);
    });

    it('should skip validation when applied', async () => {
      @Contract(contract({
        process: {
          input: z.string().email(),
          output: z.string()
        }
      }))
      class TestService {
        @NoValidation()
        async process(input: any) {
          return input; // Should accept any input
        }
      }

      const metadata = Reflect.getMetadata('validation:disabled', TestService.prototype, 'process');
      expect(metadata).toBe(true);

      // When middleware processes this, it should skip validation
      const service = new TestService();
      const result = await service.process('not-an-email');
      expect(result).toBe('not-an-email');
    });
  });

  describe('@WithValidationOptions decorator', () => {
    it('should apply global validation options to service', () => {
      @WithValidationOptions({
        cacheValidators: true,
        lazyCompilation: true,
        stripUnknown: true,
        coerceTypes: true,
        parseAsync: false,
        abortEarly: true
      })
      class OptimizedService {
        async process(input: any) {
          return input;
        }
      }

      const metadata = Reflect.getMetadata('validation:options', OptimizedService);
      expect(metadata).toBeDefined();
      expect(metadata.cacheValidators).toBe(true);
      expect(metadata.stripUnknown).toBe(true);
      expect(metadata.coerceTypes).toBe(true);
    });

    it('should be inherited by methods', () => {
      @WithValidationOptions({
        mode: 'strip',
        coerce: true
      })
      @Contract(contract({
        method1: { input: z.object({ value: z.number() }) }
      }))
      class TestService {
        method1(input: any) { return input; }
      }

      const classOptions = Reflect.getMetadata('validation:options', TestService);
      expect(classOptions.mode).toBe('strip');
      expect(classOptions.coerce).toBe(true);
    });
  });

  describe('Integration with ValidationMiddleware', () => {
    it('should work with middleware wrapping', async () => {
      const UserContract = contract({
        createUser: {
          input: z.object({
            email: z.string().email(),
            name: z.string().min(2)
          }),
          output: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string()
          })
        }
      });

      @Contract(UserContract)
      class UserService {
        async createUser(input: any) {
          return { id: '123', ...input };
        }
      }

      const service = new UserService();
      const contractMetadata = Reflect.getMetadata('validation:contract', service.constructor);
      const wrappedService = middleware.wrapService(service, contractMetadata);

      // Valid input
      const result = await wrappedService.createUser({
        email: 'test@example.com',
        name: 'Test User'
      });

      expect(result.id).toBe('123');
      expect(result.email).toBe('test@example.com');

      // Invalid input
      await expect(wrappedService.createUser({
        email: 'invalid',
        name: 'a'
      })).rejects.toThrow();
    });

    it('should handle method-level validation override', async () => {
      const ServiceContract = contract({
        process: {
          input: z.string(),
          output: z.string()
        }
      });

      @Contract(ServiceContract)
      class TestService {
        @Validate({
          input: z.number(), // Override to number
          output: z.number()
        })
        async process(input: any) {
          return input * 2;
        }
      }

      const service = new TestService();
      const contractMetadata = Reflect.getMetadata('validation:contract', service.constructor);
      const methodMetadata = Reflect.getMetadata('validation:method', service, 'process');

      // Create wrapped method with method-level validation
      const wrapped = middleware.wrapMethod(service, 'process', methodMetadata);

      // Should accept number (method override), not string (contract)
      const result = await wrapped.call(service, 5);
      expect(result).toBe(10);

      // String should fail (even though contract expects string)
      await expect(wrapped.call(service, '5')).rejects.toThrow();
    });

    it('should skip validation with @NoValidation', async () => {
      @Contract(contract({
        strict: {
          input: z.string().email(),
          output: z.string()
        },
        noCheck: {
          input: z.string().email(),
          output: z.string()
        }
      }))
      class TestService {
        async strict(input: any) {
          return input;
        }

        @NoValidation()
        async noCheck(input: any) {
          return input;
        }
      }

      const service = new TestService();
      const isDisabled = Reflect.getMetadata('validation:disabled', service, 'noCheck');

      expect(isDisabled).toBe(true);

      // When middleware checks this, it should skip validation
      const result = await service.noCheck('not-an-email');
      expect(result).toBe('not-an-email');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle nested contracts and validations', () => {
      const BaseContract = contract({
        base: { input: z.string(), output: z.string() }
      });

      const ExtendedContract = contract({
        ...BaseContract.definition,
        extended: { input: z.number(), output: z.number() }
      });

      @Contract(ExtendedContract)
      class ExtendedService {
        @Validate({
          input: z.boolean(),
          output: z.boolean()
        })
        base(input: any) { return !input; }

        extended(input: any) { return input * 2; }

        @NoValidation()
        bypass(input: any) { return input; }
      }

      const contractMeta = Reflect.getMetadata('validation:contract', ExtendedService);
      const baseMeta = Reflect.getMetadata('validation:method', ExtendedService.prototype, 'base');
      const bypassMeta = Reflect.getMetadata('validation:disabled', ExtendedService.prototype, 'bypass');

      expect(contractMeta).toBe(ExtendedContract);
      expect(baseMeta.input).toBeDefined();
      expect(bypassMeta).toBe(true);
    });

    it('should handle inheritance', () => {
      const BaseContract = contract({
        method1: { input: z.string(), output: z.string() }
      });

      @Contract(BaseContract)
      class BaseService {
        method1(input: any) { return input; }
      }

      const ExtendedContract = contract({
        method1: { input: z.string(), output: z.string() },
        method2: { input: z.number(), output: z.number() }
      });

      @Contract(ExtendedContract)
      class ExtendedService extends BaseService {
        method2(input: any) { return input * 2; }
      }

      const baseMeta = Reflect.getMetadata('validation:contract', BaseService);
      const extendedMeta = Reflect.getMetadata('validation:contract', ExtendedService);

      expect(baseMeta).toBe(BaseContract);
      expect(extendedMeta).toBe(ExtendedContract);
    });
  });
});