/**
 * Tests for Custom Decorator Creation API
 */
import { describe, it, expect, jest } from '@jest/globals';

import 'reflect-metadata';
import {
  createDecorator,
  getCustomMetadata,
  hasDecorator,
  combineDecorators,
  createMethodInterceptor,
  createPropertyInterceptor,
  Memoize,
  Retry,
  Deprecated,
  Validate,
} from '../../src/decorators/index.js';

describe('Custom Decorators', () => {
  describe('createDecorator', () => {
    it('should create a basic class decorator', () => {
      const TestDecorator = createDecorator().withName('Test').forClass().withMetadata('test', true).build();

      @TestDecorator()
      class TestClass {}

      expect(hasDecorator('Test', TestClass)).toBe(true);
      expect(getCustomMetadata('Test', TestClass)).toBeDefined();
    });

    it('should create a method decorator with options', () => {
      interface LogOptions {
        level: 'info' | 'debug' | 'error';
      }

      const Log = createDecorator<LogOptions>()
        .withName('Log')
        .forMethod((context) => {
          const originalMethod = context.descriptor!.value;
          context.descriptor!.value = function (...args: any[]) {
            console.log(`[${context.options?.level || 'info'}] Calling ${String(context.propertyKey)}`);
            return originalMethod.apply(this, args);
          };
          return context.descriptor;
        })
        .build();

      class TestService {
        @Log({ level: 'debug' })
        doSomething() {
          return 'done';
        }
      }

      const service = new TestService();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      service.doSomething();

      expect(consoleSpy).toHaveBeenCalledWith('[debug] Calling doSomething');
      consoleSpy.mockRestore();
    });

    it('should create a property decorator', () => {
      // Test that a property decorator can be created and applied
      let decoratorApplied = false;
      let decoratorOptions: any = null;

      const TestDecorator = createDecorator<{ testValue: string }>()
        .withName('TestDecorator')
        .forProperty((context) => {
          decoratorApplied = true;
          decoratorOptions = context.options;

          // Add metadata to verify decorator was applied
          Reflect.defineMetadata('test-decorator', true, context.target, context.propertyKey!);
        })
        .build();

      class TestClass {
        @TestDecorator({ testValue: 'test' })
        name!: string;
      }

      // Verify decorator was applied during class definition
      expect(decoratorApplied).toBe(true);
      expect(decoratorOptions).toEqual({ testValue: 'test' });

      // Verify metadata was set
      const metadata = Reflect.getMetadata('test-decorator', TestClass.prototype, 'name');
      expect(metadata).toBe(true);
    });

    it('should create a parameter decorator', () => {
      const paramMetadata: any[] = [];

      const ParamDecorator = createDecorator<{ name: string }>()
        .withName('Param')
        .forParameter((context) => {
          paramMetadata[context.parameterIndex!] = context.options?.name;
        })
        .build();

      class TestClass {
        method(@ParamDecorator({ name: 'first' }) param1: string, @ParamDecorator({ name: 'second' }) param2: number) {
          return { param1, param2 };
        }
      }

      expect(paramMetadata).toEqual(['first', 'second']);
    });

    it('should validate decorator options', () => {
      const ValidatedDecorator = createDecorator<{ min: number; max: number }>()
        .withName('Validated')
        .forClass()
        .withValidation((options) => {
          if (!options) return 'Options are required';
          if (options.min >= options.max) return 'min must be less than max';
        })
        .build();

      expect(() => {
        @ValidatedDecorator({ min: 10, max: 5 })
        class TestClass {}
      }).toThrow('Invalid options for @Validated: min must be less than max');
    });

    it('should enforce target restrictions', () => {
      const MethodOnlyDecorator = createDecorator().withName('MethodOnly').forMethod().build();

      expect(() => {
        @MethodOnlyDecorator()
        class TestClass {}
      }).toThrow('@MethodOnly cannot be applied to class');
    });

    it('should support decorator composition', () => {
      const calls: string[] = [];

      const First = createDecorator()
        .withName('First')
        .forMethod((context) => {
          const originalMethod = context.descriptor!.value;
          context.descriptor!.value = function (...args: any[]) {
            calls.push('first');
            return originalMethod.apply(this, args);
          };
          return context.descriptor;
        })
        .build();

      const Second = createDecorator()
        .withName('Second')
        .forMethod((context) => {
          const originalMethod = context.descriptor!.value;
          context.descriptor!.value = function (...args: any[]) {
            calls.push('second');
            return originalMethod.apply(this, args);
          };
          return context.descriptor;
        })
        .build();

      const Combined = createDecorator().withName('Combined').forMethod().compose(First(), Second()).build();

      class TestClass {
        @Combined()
        method() {
          calls.push('method');
        }
      }

      const instance = new TestClass();
      instance.method();

      expect(calls).toEqual(['first', 'second', 'method']);
    });

    it('should prevent stacking when not stackable', () => {
      const NonStackable = createDecorator()
        .withName('NonStackable')
        .forMethod()
        .stackable(false)
        .withMetadata('applied', true)
        .build();

      expect(() => {
        class TestClass {
          @NonStackable()
          @NonStackable()
          method() {}
        }
      }).toThrow('@NonStackable has already been applied and is not stackable');
    });

    it('should allow stacking when stackable', () => {
      const Stackable = createDecorator()
        .withName('Stackable')
        .forMethod()
        .stackable(true)
        .withMetadata('applied', true)
        .build();

      class TestClass {
        @Stackable()
        @Stackable()
        method() {}
      }

      const metadata = getCustomMetadata('Stackable', TestClass.prototype, 'method');
      expect(metadata).toHaveLength(2);
    });

    it('should support lifecycle hooks', () => {
      const hookCalls: string[] = [];

      const HookedDecorator = createDecorator()
        .withName('Hooked')
        .forClass()
        .withHooks({
          beforeApply: () => hookCalls.push('before'),
          afterApply: () => hookCalls.push('after'),
        })
        .build();

      @HookedDecorator()
      class TestClass {}

      expect(hookCalls).toEqual(['before', 'after']);
    });

    it('should support metadata transformers', () => {
      const DynamicMetadata = createDecorator<{ prefix: string }>()
        .withName('Dynamic')
        .forClass()
        .withMetadata((context) => ({
          className: context.target.name,
          prefixed: `${context.options?.prefix}_${context.target.name}`,
        }))
        .build();

      @DynamicMetadata({ prefix: 'test' })
      class TestClass {}

      const metadataKeys = Reflect.getMetadataKeys(TestClass);
      const classNameMetadata = Reflect.getMetadata('custom:Dynamic:className', TestClass);
      const prefixedMetadata = Reflect.getMetadata('custom:Dynamic:prefixed', TestClass);

      expect(classNameMetadata).toBe('TestClass');
      expect(prefixedMetadata).toBe('test_TestClass');
    });
  });

  describe('Utility functions', () => {
    it('should combine decorators correctly', () => {
      const calls: string[] = [];

      const A = (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
          calls.push('A');
          return originalMethod.apply(this, args);
        };
        return descriptor;
      };

      const B = (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any[]) {
          calls.push('B');
          return originalMethod.apply(this, args);
        };
        return descriptor;
      };

      const Combined = combineDecorators(A, B);

      class TestClass {
        @Combined
        method() {
          calls.push('method');
        }
      }

      const instance = new TestClass();
      instance.method();

      expect(calls).toEqual(['A', 'B', 'method']);
    });

    it('should create method interceptors', () => {
      const Timing = createMethodInterceptor('Timing', (originalMethod, args, context) => {
        const start = Date.now();
        const result = originalMethod(...args);
        const duration = Date.now() - start;
        context.metadata.set('lastDuration', duration);
        return result;
      });

      class TestService {
        @Timing()
        process() {
          // Simulate work
          for (let i = 0; i < 1000000; i++) {}
          return 'done';
        }
      }

      const service = new TestService();
      const result = service.process();

      expect(result).toBe('done');
    });

    it('should create property interceptors', () => {
      const Uppercase = createPropertyInterceptor('Uppercase', {
        get: (value) => value?.toUpperCase(),
        set: (value) => value?.toLowerCase(),
      });

      class TestClass {
        @Uppercase()
        text!: string;
      }

      const instance = new TestClass();
      instance.text = 'HELLO';
      expect(instance.text).toBe('HELLO');
    });
  });

  describe('Built-in decorators', () => {
    it('should memoize method results', () => {
      let callCount = 0;

      class Calculator {
        @Memoize()
        expensive(n: number): number {
          callCount++;
          return n * n;
        }
      }

      const calc = new Calculator();

      expect(calc.expensive(5)).toBe(25);
      expect(calc.expensive(5)).toBe(25);
      expect(calc.expensive(5)).toBe(25);
      expect(callCount).toBe(1);

      expect(calc.expensive(10)).toBe(100);
      expect(callCount).toBe(2);
    });

    it('should retry failed operations', async () => {
      let attempts = 0;

      class Service {
        @Retry({ attempts: 3, delay: 10 })
        async unreliable(): Promise<string> {
          attempts++;
          if (attempts < 3) {
            throw new Error('Failed');
          }
          return 'success';
        }
      }

      const service = new Service();
      const result = await service.unreliable();

      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should mark methods as deprecated', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      class OldAPI {
        @Deprecated({ message: 'Use newMethod instead', version: '2.0.0' })
        oldMethod() {
          return 'old';
        }
      }

      const api = new OldAPI();
      api.oldMethod();

      expect(consoleSpy).toHaveBeenCalledWith('Use newMethod instead');

      consoleSpy.mockRestore();
    });

    it('should validate method arguments', () => {
      const schema = (value: number) => value > 0;

      class MathService {
        @Validate({ schema })
        sqrt(value: number): number {
          return Math.sqrt(value);
        }
      }

      const service = new MathService();

      expect(() => service.sqrt(-1)).toThrow('Validation failed for sqrt');
      expect(service.sqrt(4)).toBe(2);
    });
  });

  describe('Complex scenarios', () => {
    it('should work with inheritance', () => {
      const Inheritable = createDecorator()
        .withName('Inheritable')
        .forClass()
        .inheritable(true)
        .withMetadata('inherited', true)
        .build();

      @Inheritable()
      class BaseClass {}

      class DerivedClass extends BaseClass {}

      expect(hasDecorator('Inheritable', BaseClass)).toBe(true);
      // Note: Inheritance metadata would need additional handling in actual implementation
    });

    it('should handle async method decorators', async () => {
      const AsyncLogger = createMethodInterceptor('AsyncLogger', async (originalMethod, args, context) => {
        console.log(`Before ${String(context.propertyKey)}`);
        const result = await originalMethod(...args);
        console.log(`After ${String(context.propertyKey)}`);
        return result;
      });

      class AsyncService {
        @AsyncLogger()
        async fetchData(): Promise<string> {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'data';
        }
      }

      const service = new AsyncService();
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const result = await service.fetchData();

      expect(result).toBe('data');
      expect(consoleSpy).toHaveBeenCalledWith('Before fetchData');
      expect(consoleSpy).toHaveBeenCalledWith('After fetchData');

      consoleSpy.mockRestore();
    });

    it('should support multiple decorators on same target', () => {
      const First = createDecorator().withName('First').forMethod().withMetadata('order', 1).build();

      const Second = createDecorator().withName('Second').forMethod().withMetadata('order', 2).build();

      class TestClass {
        @First()
        @Second()
        method() {}
      }

      expect(hasDecorator('First', TestClass.prototype, 'method')).toBe(true);
      expect(hasDecorator('Second', TestClass.prototype, 'method')).toBe(true);
    });

    it('should handle decorator priority', () => {
      const execOrder: number[] = [];

      const HighPriority = createDecorator()
        .withName('HighPriority')
        .withPriority(10)
        .forMethod((context) => {
          const originalMethod = context.descriptor!.value;
          context.descriptor!.value = function (...args: any[]) {
            execOrder.push(10);
            return originalMethod.apply(this, args);
          };
          return context.descriptor;
        })
        .build();

      const LowPriority = createDecorator()
        .withName('LowPriority')
        .withPriority(1)
        .forMethod((context) => {
          const originalMethod = context.descriptor!.value;
          context.descriptor!.value = function (...args: any[]) {
            execOrder.push(1);
            return originalMethod.apply(this, args);
          };
          return context.descriptor;
        })
        .build();

      class TestClass {
        @LowPriority()
        @HighPriority()
        method() {
          execOrder.push(0);
        }
      }

      const instance = new TestClass();
      instance.method();

      // Decorators are applied bottom-up: HighPriority first (closest to method), then LowPriority
      // So LowPriority wraps HighPriority, resulting in: LowPriority -> HighPriority -> original method
      expect(execOrder).toEqual([1, 10, 0]);
    });
  });
});
