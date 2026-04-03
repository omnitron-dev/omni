/**
 * Provider Utilities Tests
 * Tests for provider utility functions in Nexus DI Container
 */

import { describe, it, expect } from 'vitest';
import {
  isConstructor,
  isAsyncProvider,
  createValueProvider,
  createFactoryProvider,
  createClassProvider,
  createTokenProvider,
  createMultiProvider,
  isMultiProvider,
  hasScope,
  createConditionalProvider,
} from '../../../src/nexus/provider-utils.js';
import { createToken, Scope } from '../../../src/nexus/index.js';
import type { Provider } from '../../../src/nexus/types.js';

describe('Provider Utilities', () => {
  describe('isConstructor', () => {
    // Note: isConstructor returns the prototype object (truthy) for constructors
    // and undefined/falsy for non-constructors, as a type guard pattern

    it('should return truthy for ES6 class', () => {
      class TestClass {
        value = 'test';
      }
      expect(isConstructor(TestClass)).toBeTruthy();
    });

    it('should return truthy for constructor function', () => {
      function TestConstructor(this: any) {
        this.value = 'test';
      }
      expect(isConstructor(TestConstructor)).toBeTruthy();
    });

    it('should return truthy for class with constructor parameters', () => {
      class ServiceWithDeps {
        constructor(
          public dep1: string,
          public dep2: number
        ) {}
      }
      expect(isConstructor(ServiceWithDeps)).toBeTruthy();
    });

    it('should return truthy for extended class', () => {
      class Base {}
      class Extended extends Base {}
      expect(isConstructor(Extended)).toBeTruthy();
    });

    it('should return falsy for arrow function', () => {
      const arrowFn = () => 'test';
      expect(isConstructor(arrowFn)).toBeFalsy();
    });

    it('should return falsy for bound function without prototype', () => {
      const boundFn = function testFunction() {}.bind(null);
      // Bound functions do not have a prototype property
      expect(typeof boundFn).toBe('function');
      expect(isConstructor(boundFn)).toBeFalsy();
    });

    it('should return falsy for non-function values', () => {
      expect(isConstructor('string')).toBeFalsy();
      expect(isConstructor(42)).toBeFalsy();
      expect(isConstructor(null)).toBeFalsy();
      expect(isConstructor(undefined)).toBeFalsy();
      expect(isConstructor({})).toBeFalsy();
      expect(isConstructor([])).toBeFalsy();
      expect(isConstructor(Symbol('test'))).toBeFalsy();
    });

    it('should return truthy for built-in constructors', () => {
      expect(isConstructor(Array)).toBeTruthy();
      expect(isConstructor(Object)).toBeTruthy();
      expect(isConstructor(Map)).toBeTruthy();
      expect(isConstructor(Set)).toBeTruthy();
      expect(isConstructor(Error)).toBeTruthy();
    });

    it('should work as a type guard in conditionals', () => {
      class MyClass {}
      const maybeConstructor: unknown = MyClass;

      if (isConstructor(maybeConstructor)) {
        // TypeScript should allow this inside the type guard
        const instance = new maybeConstructor();
        expect(instance).toBeInstanceOf(MyClass);
      } else {
        fail('Expected isConstructor to return truthy');
      }
    });
  });

  describe('isAsyncProvider', () => {
    it('should return true for provider with async: true flag', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        async: true,
      };
      expect(isAsyncProvider(provider)).toBe(true);
    });

    it('should return true for provider with async factory function', () => {
      const provider: Provider = {
        useFactory: async () => 'async-value',
      };
      expect(isAsyncProvider(provider)).toBe(true);
    });

    it('should return false for sync factory without async flag', () => {
      const provider: Provider = {
        useFactory: () => 'sync-value',
      };
      expect(isAsyncProvider(provider)).toBe(false);
    });

    it('should return false for value provider', () => {
      const provider: Provider = {
        useValue: 'static-value',
      };
      expect(isAsyncProvider(provider)).toBe(false);
    });

    it('should return false for class provider', () => {
      class TestService {}
      const provider: Provider = {
        useClass: TestService,
      };
      expect(isAsyncProvider(provider)).toBe(false);
    });

    it('should return false for token provider', () => {
      const token = createToken('Source');
      const provider: Provider = {
        useToken: token,
      };
      expect(isAsyncProvider(provider)).toBe(false);
    });

    it('should detect async arrow function factories', () => {
      const provider: Provider = {
        useFactory: async () => {
          await Promise.resolve();
          return 'result';
        },
      };
      expect(isAsyncProvider(provider)).toBe(true);
    });

    it('should return false when async flag is explicitly false', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        async: false,
      };
      expect(isAsyncProvider(provider)).toBe(false);
    });
  });

  describe('createValueProvider', () => {
    it('should create a basic value provider tuple', () => {
      const token = createToken<string>('StringValue');
      const value = 'test-value';

      const [resultToken, provider] = createValueProvider(token, value);

      expect(resultToken).toBe(token);
      expect(provider).toHaveProperty('useValue', value);
    });

    it('should create value provider for complex objects', () => {
      interface Config {
        host: string;
        port: number;
      }
      const token = createToken<Config>('Config');
      const config: Config = { host: 'localhost', port: 3000 };

      const [, provider] = createValueProvider(token, config);

      expect((provider as any).useValue).toEqual({ host: 'localhost', port: 3000 });
    });

    it('should create value provider with string validation', () => {
      const token = createToken<number>('Port');

      const [, provider] = createValueProvider(token, 8080, { validate: 'portValidator' });

      expect((provider as any).validate).toBe('portValidator');
    });

    it('should create value provider with function validation', () => {
      const validator = (value: number) => {
        if (value < 0) throw new Error('Invalid');
      };
      const token = createToken<number>('PositiveNumber');

      const [, provider] = createValueProvider(token, 42, { validate: validator });

      expect((provider as any).validate).toBe(validator);
    });

    it('should create value provider without validation when not provided', () => {
      const token = createToken<string>('NoValidation');

      const [, provider] = createValueProvider(token, 'value');

      expect(provider).not.toHaveProperty('validate');
    });

    it('should preserve null and undefined values', () => {
      const nullToken = createToken<null>('Null');
      const undefinedToken = createToken<undefined>('Undefined');

      const [, nullProvider] = createValueProvider(nullToken, null);
      const [, undefinedProvider] = createValueProvider(undefinedToken, undefined);

      expect((nullProvider as any).useValue).toBeNull();
      expect((undefinedProvider as any).useValue).toBeUndefined();
    });
  });

  describe('createFactoryProvider', () => {
    it('should create a basic factory provider tuple', () => {
      const token = createToken<number>('Counter');
      let count = 0;
      const factory = () => ++count;

      const [resultToken, provider] = createFactoryProvider(token, factory);

      expect(resultToken).toBe(token);
      expect((provider as any).useFactory).toBe(factory);
    });

    it('should create factory provider with inject dependencies', () => {
      const depToken = createToken<string>('Dep');
      const token = createToken<{ dep: string }>('Service');
      const factory = (dep: string) => ({ dep });

      const [, provider] = createFactoryProvider(token, factory, {
        inject: [depToken],
      });

      expect((provider as any).inject).toEqual([depToken]);
    });

    it('should create factory provider with singleton scope', () => {
      const token = createToken<object>('Singleton');

      const [, provider] = createFactoryProvider(token, () => ({}), {
        scope: Scope.Singleton,
      });

      expect((provider as any).scope).toBe(Scope.Singleton);
    });

    it('should create factory provider with transient scope', () => {
      const token = createToken<object>('Transient');

      const [, provider] = createFactoryProvider(token, () => ({}), {
        scope: Scope.Transient,
      });

      expect((provider as any).scope).toBe(Scope.Transient);
    });

    it('should create async factory provider', () => {
      const token = createToken<string>('AsyncResult');
      const asyncFactory = async () => 'async-result';

      const [, provider] = createFactoryProvider(token, asyncFactory, {
        async: true,
      });

      expect((provider as any).async).toBe(true);
    });

    it('should create factory provider with timeout', () => {
      const token = createToken<string>('TimedService');

      const [, provider] = createFactoryProvider(token, async () => 'result', {
        timeout: 5000,
      });

      expect((provider as any).timeout).toBe(5000);
    });

    it('should create factory provider with retry configuration', () => {
      const token = createToken<string>('RetryService');

      const [, provider] = createFactoryProvider(token, async () => 'result', {
        retry: { maxAttempts: 3, delay: 1000 },
      });

      expect((provider as any).retry).toEqual({ maxAttempts: 3, delay: 1000 });
    });

    it('should create factory provider with all options', () => {
      const depToken = createToken<string>('Dep');
      const token = createToken<{ dep: string }>('FullService');

      const [, provider] = createFactoryProvider(token, async (dep: string) => ({ dep }), {
        inject: [depToken],
        scope: Scope.Scoped,
        async: true,
        timeout: 10000,
        retry: { maxAttempts: 5, delay: 500 },
      });

      expect((provider as any).inject).toEqual([depToken]);
      expect((provider as any).scope).toBe(Scope.Scoped);
      expect((provider as any).async).toBe(true);
      expect((provider as any).timeout).toBe(10000);
      expect((provider as any).retry).toEqual({ maxAttempts: 5, delay: 500 });
    });

    it('should not include undefined options', () => {
      const token = createToken<string>('Minimal');

      const [, provider] = createFactoryProvider(token, () => 'value');

      expect(provider).not.toHaveProperty('inject');
      expect(provider).not.toHaveProperty('scope');
      expect(provider).not.toHaveProperty('async');
      expect(provider).not.toHaveProperty('timeout');
      expect(provider).not.toHaveProperty('retry');
    });
  });

  describe('createClassProvider', () => {
    it('should create a basic class provider tuple', () => {
      class TestService {
        getValue() {
          return 'service';
        }
      }
      const token = createToken<TestService>('TestService');

      const [resultToken, provider] = createClassProvider(token, TestService);

      expect(resultToken).toBe(token);
      expect((provider as any).useClass).toBe(TestService);
    });

    it('should create class provider with singleton scope', () => {
      class SingletonService {}
      const token = createToken<SingletonService>('Singleton');

      const [, provider] = createClassProvider(token, SingletonService, {
        scope: Scope.Singleton,
      });

      expect((provider as any).scope).toBe(Scope.Singleton);
    });

    it('should create class provider with inject dependencies', () => {
      const depToken = createToken<string>('Dep');

      class ServiceWithDeps {
        constructor(public dep: string) {}
      }
      const token = createToken<ServiceWithDeps>('ServiceWithDeps');

      const [, provider] = createClassProvider(token, ServiceWithDeps, {
        inject: [depToken],
      });

      expect((provider as any).inject).toEqual([depToken]);
    });

    it('should create class provider with both scope and inject', () => {
      const depToken = createToken<string>('Dep');

      class FullService {
        constructor(public dep: string) {}
      }
      const token = createToken<FullService>('FullService');

      const [, provider] = createClassProvider(token, FullService, {
        scope: Scope.Request,
        inject: [depToken],
      });

      expect((provider as any).scope).toBe(Scope.Request);
      expect((provider as any).inject).toEqual([depToken]);
    });

    it('should not include undefined options', () => {
      class MinimalService {}
      const token = createToken<MinimalService>('Minimal');

      const [, provider] = createClassProvider(token, MinimalService);

      expect(provider).not.toHaveProperty('scope');
      expect(provider).not.toHaveProperty('inject');
    });
  });

  describe('createTokenProvider', () => {
    it('should create a token alias provider tuple', () => {
      const sourceToken = createToken<string>('Source');
      const aliasToken = createToken<string>('Alias');

      const [resultToken, provider] = createTokenProvider(aliasToken, sourceToken);

      expect(resultToken).toBe(aliasToken);
      expect((provider as any).useToken).toBe(sourceToken);
    });

    it('should work with different token types', () => {
      interface Service {
        execute(): void;
      }
      const concreteToken = createToken<Service>('ConcreteService');
      const abstractToken = createToken<Service>('AbstractService');

      const [, provider] = createTokenProvider(abstractToken, concreteToken);

      expect((provider as any).useToken).toBe(concreteToken);
    });

    it('should allow chaining token aliases', () => {
      const token1 = createToken<string>('Token1');
      const token2 = createToken<string>('Token2');
      const token3 = createToken<string>('Token3');

      const [, provider1] = createTokenProvider(token2, token1);
      const [, provider2] = createTokenProvider(token3, token2);

      expect((provider1 as any).useToken).toBe(token1);
      expect((provider2 as any).useToken).toBe(token2);
    });
  });

  describe('createMultiProvider', () => {
    it('should create multi-provider array from value providers', () => {
      const token = createToken<string>('Handlers');
      const providers: Provider[] = [{ useValue: 'handler1' }, { useValue: 'handler2' }, { useValue: 'handler3' }];

      const result = createMultiProvider(token, providers);

      expect(result).toHaveLength(3);
      result.forEach(([t, p], index) => {
        expect(t).toBe(token);
        expect((p as any).multi).toBe(true);
        expect((p as any).useValue).toBe(`handler${index + 1}`);
      });
    });

    it('should create multi-provider array from factory providers', () => {
      const token = createToken<() => void>('Plugins');
      const providers: Provider[] = [
        { useFactory: () => () => console.log('plugin1') },
        { useFactory: () => () => console.log('plugin2') },
      ];

      const result = createMultiProvider(token, providers);

      expect(result).toHaveLength(2);
      result.forEach(([t, p]) => {
        expect(t).toBe(token);
        expect((p as any).multi).toBe(true);
        expect((p as any).useFactory).toBeDefined();
      });
    });

    it('should create multi-provider array from class providers', () => {
      class Handler1 {}
      class Handler2 {}
      const token = createToken<object>('EventHandlers');
      const providers: Provider[] = [{ useClass: Handler1 }, { useClass: Handler2 }];

      const result = createMultiProvider(token, providers);

      expect(result).toHaveLength(2);
      expect((result[0][1] as any).useClass).toBe(Handler1);
      expect((result[1][1] as any).useClass).toBe(Handler2);
      expect((result[0][1] as any).multi).toBe(true);
      expect((result[1][1] as any).multi).toBe(true);
    });

    it('should handle empty providers array', () => {
      const token = createToken<string>('Empty');
      const providers: Provider[] = [];

      const result = createMultiProvider(token, providers);

      expect(result).toEqual([]);
    });

    it('should handle mixed provider types', () => {
      class ClassHandler {}
      const token = createToken<any>('MixedHandlers');
      const providers: Provider[] = [
        { useValue: 'value-handler' },
        { useClass: ClassHandler },
        { useFactory: () => 'factory-handler' },
      ];

      const result = createMultiProvider(token, providers);

      expect(result).toHaveLength(3);
      expect((result[0][1] as any).useValue).toBe('value-handler');
      expect((result[1][1] as any).useClass).toBe(ClassHandler);
      expect((result[2][1] as any).useFactory).toBeDefined();
      result.forEach(([, p]) => {
        expect((p as any).multi).toBe(true);
      });
    });

    it('should preserve existing provider options', () => {
      const token = createToken<string>('ConfiguredHandlers');
      const providers: Provider[] = [
        { useValue: 'handler', scope: Scope.Singleton } as any,
        { useFactory: () => 'handler2', scope: Scope.Transient } as any,
      ];

      const result = createMultiProvider(token, providers);

      expect((result[0][1] as any).scope).toBe(Scope.Singleton);
      expect((result[1][1] as any).scope).toBe(Scope.Transient);
    });
  });

  describe('isMultiProvider', () => {
    it('should return true for provider with multi: true', () => {
      const provider: Provider = {
        useValue: 'test',
        multi: true,
      };
      expect(isMultiProvider(provider)).toBe(true);
    });

    it('should return false for provider with multi: false', () => {
      const provider: Provider = {
        useValue: 'test',
        multi: false,
      };
      expect(isMultiProvider(provider)).toBe(false);
    });

    it('should return false for provider without multi property', () => {
      const provider: Provider = {
        useValue: 'test',
      };
      expect(isMultiProvider(provider)).toBe(false);
    });

    it('should return false for class provider without multi', () => {
      class TestService {}
      const provider: Provider = {
        useClass: TestService,
      };
      expect(isMultiProvider(provider)).toBe(false);
    });

    it('should return true for factory provider with multi: true', () => {
      const provider: Provider = {
        useFactory: () => 'result',
        multi: true,
      };
      expect(isMultiProvider(provider)).toBe(true);
    });

    it('should return true for token provider with multi: true', () => {
      const token = createToken('Source');
      const provider: Provider = {
        useToken: token,
        multi: true,
      };
      expect(isMultiProvider(provider)).toBe(true);
    });
  });

  describe('hasScope', () => {
    it('should return true for matching singleton scope', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        scope: Scope.Singleton,
      };
      expect(hasScope(provider, Scope.Singleton)).toBe(true);
    });

    it('should return true for matching transient scope', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        scope: Scope.Transient,
      };
      expect(hasScope(provider, Scope.Transient)).toBe(true);
    });

    it('should return true for matching scoped scope', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        scope: Scope.Scoped,
      };
      expect(hasScope(provider, Scope.Scoped)).toBe(true);
    });

    it('should return true for matching request scope', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        scope: Scope.Request,
      };
      expect(hasScope(provider, Scope.Request)).toBe(true);
    });

    it('should return false for non-matching scope', () => {
      const provider: Provider = {
        useFactory: () => 'value',
        scope: Scope.Singleton,
      };
      expect(hasScope(provider, Scope.Transient)).toBe(false);
    });

    it('should return false for provider without scope', () => {
      const provider: Provider = {
        useValue: 'test',
      };
      expect(hasScope(provider, Scope.Singleton)).toBe(false);
    });

    it('should work with class providers', () => {
      class TestService {}
      const provider: Provider = {
        useClass: TestService,
        scope: Scope.Singleton,
      };
      expect(hasScope(provider, Scope.Singleton)).toBe(true);
      expect(hasScope(provider, Scope.Transient)).toBe(false);
    });
  });

  describe('createConditionalProvider', () => {
    it('should create conditional provider with value provider', () => {
      const token = createToken<string>('Conditional');
      const provider: Provider = { useValue: 'test' };
      const condition = (ctx: any) => ctx.env === 'production';

      const [resultToken, resultProvider] = createConditionalProvider(token, provider, condition);

      expect(resultToken).toBe(token);
      expect((resultProvider as any).useValue).toBe('test');
      expect((resultProvider as any).condition).toBe(condition);
    });

    it('should create conditional provider with factory provider', () => {
      const token = createToken<string>('ConditionalFactory');
      const factory = () => 'factory-result';
      const provider: Provider = { useFactory: factory };
      const condition = (ctx: any) => ctx.enabled;

      const [, resultProvider] = createConditionalProvider(token, provider, condition);

      expect((resultProvider as any).useFactory).toBe(factory);
      expect((resultProvider as any).condition).toBe(condition);
    });

    it('should create conditional provider with class provider', () => {
      class TestService {}
      const token = createToken<TestService>('ConditionalClass');
      const provider: Provider = { useClass: TestService };
      const condition = (ctx: any) => !!ctx.useTestService;

      const [, resultProvider] = createConditionalProvider(token, provider, condition);

      expect((resultProvider as any).useClass).toBe(TestService);
      expect((resultProvider as any).condition).toBe(condition);
    });

    it('should create conditional provider with constructor function', () => {
      class DirectClass {}
      const token = createToken<DirectClass>('DirectConstructor');
      const condition = (ctx: any) => ctx.useDirect;

      const [, resultProvider] = createConditionalProvider(token, DirectClass as any, condition);

      expect((resultProvider as any).useClass).toBe(DirectClass);
      expect((resultProvider as any).condition).toBe(condition);
    });

    it('should create conditional provider with fallback', () => {
      const token = createToken<string>('WithFallback');
      const provider: Provider = { useValue: 'primary' };
      const fallback: Provider = { useValue: 'fallback' };
      const condition = (ctx: any) => ctx.usePrimary;

      const [, resultProvider] = createConditionalProvider(token, provider, condition, fallback);

      expect((resultProvider as any).useValue).toBe('primary');
      expect((resultProvider as any).condition).toBe(condition);
      expect((resultProvider as any).fallback).toBe(fallback);
    });

    it('should create conditional provider with factory fallback', () => {
      const token = createToken<string>('FactoryFallback');
      const provider: Provider = { useFactory: () => 'main' };
      const fallback: Provider = { useFactory: () => 'backup' };
      const condition = (ctx: any) => ctx.useMain;

      const [, resultProvider] = createConditionalProvider(token, provider, condition, fallback);

      expect((resultProvider as any).useFactory).toBeDefined();
      expect((resultProvider as any).fallback).toBe(fallback);
    });

    it('should preserve other provider options', () => {
      const token = createToken<string>('PreserveOptions');
      const provider: Provider = {
        useFactory: () => 'value',
        scope: Scope.Singleton,
      };
      const condition = (ctx: any) => true;

      const [, resultProvider] = createConditionalProvider(token, provider, condition);

      expect((resultProvider as any).scope).toBe(Scope.Singleton);
      expect((resultProvider as any).condition).toBe(condition);
    });

    it('should not add fallback when not provided', () => {
      const token = createToken<string>('NoFallback');
      const provider: Provider = { useValue: 'only' };
      const condition = (ctx: any) => true;

      const [, resultProvider] = createConditionalProvider(token, provider, condition);

      expect(resultProvider).not.toHaveProperty('fallback');
    });

    it('should handle complex condition functions', () => {
      const token = createToken<string>('ComplexCondition');
      const provider: Provider = { useValue: 'complex' };
      const condition = (ctx: any) => ctx.env === 'production' && ctx.feature.enabled && ctx.user?.role === 'admin';

      const [, resultProvider] = createConditionalProvider(token, provider, condition);

      expect((resultProvider as any).condition).toBe(condition);

      // Test the condition function works correctly
      expect(
        condition({
          env: 'production',
          feature: { enabled: true },
          user: { role: 'admin' },
        })
      ).toBe(true);

      expect(
        condition({
          env: 'development',
          feature: { enabled: true },
          user: { role: 'admin' },
        })
      ).toBe(false);
    });
  });

  describe('Integration scenarios', () => {
    it('should work together for complete provider configuration', () => {
      // Create tokens
      const configToken = createToken<{ url: string }>('Config');
      const serviceToken = createToken<{ config: { url: string } }>('Service');
      const handlerToken = createToken<string>('Handlers');

      // Create providers using utilities
      const [, configProvider] = createValueProvider(configToken, { url: 'http://api.example.com' });

      const [, serviceProvider] = createFactoryProvider(serviceToken, (config: { url: string }) => ({ config }), {
        inject: [configToken],
        scope: Scope.Singleton,
      });

      const multiProviders = createMultiProvider(handlerToken, [{ useValue: 'handler1' }, { useValue: 'handler2' }]);

      // Verify all providers are correctly configured
      expect((configProvider as any).useValue.url).toBe('http://api.example.com');
      expect((serviceProvider as any).inject).toEqual([configToken]);
      expect((serviceProvider as any).scope).toBe(Scope.Singleton);
      expect(multiProviders).toHaveLength(2);
      multiProviders.forEach(([, p]) => expect(isMultiProvider(p)).toBe(true));
    });

    it('should support conditional multi-provider setup', () => {
      const token = createToken<string>('ConditionalHandlers');

      const providers: Provider[] = [{ useValue: 'always-handler' }, { useValue: 'conditional-handler' }];

      const multiProviders = createMultiProvider(token, providers);

      // Add condition to specific providers
      const condition = (ctx: any) => ctx.includeConditional;
      const [_condToken, condProvider] = createConditionalProvider(token, multiProviders[1][1], condition);

      expect((condProvider as any).condition).toBe(condition);
      expect((condProvider as any).multi).toBe(true);
    });

    it('should verify provider types correctly', () => {
      class TestClass {}

      const providers: Array<{ provider: Provider; expectedMulti: boolean; expectedScope: Scope | undefined }> = [
        { provider: { useValue: 'v', multi: true }, expectedMulti: true, expectedScope: undefined },
        {
          provider: { useFactory: () => 'f', scope: Scope.Singleton },
          expectedMulti: false,
          expectedScope: Scope.Singleton,
        },
        {
          provider: { useClass: TestClass, scope: Scope.Transient },
          expectedMulti: false,
          expectedScope: Scope.Transient,
        },
        { provider: { useValue: 'v2' }, expectedMulti: false, expectedScope: undefined },
      ];

      providers.forEach(({ provider, expectedMulti, expectedScope }) => {
        expect(isMultiProvider(provider)).toBe(expectedMulti);
        if (expectedScope !== undefined) {
          expect(hasScope(provider, expectedScope)).toBe(true);
        }
      });
    });
  });
});
