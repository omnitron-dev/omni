/**
 * Core Container Tests
 * Tests for the fundamental container functionality including registration, resolution, and lifecycle
 */

import {
  Container,
  createToken,
  Provider,
  Scope,
  ResolutionError,
  CircularDependencyError,
  DependencyNotFoundError,
  ContainerDisposedError,
  InvalidProviderError,
  DuplicateRegistrationError
} from '../../src/index.js';

describe('Core Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Registration', () => {
    it('should register value provider', () => {
      const token = createToken<string>('TestValue');
      const value = 'test-value';

      container.register(token, { useValue: value });
      const resolved = container.resolve(token);

      expect(resolved).toBe(value);
    });

    it('should register factory provider', () => {
      const token = createToken<number>('TestFactory');

      container.register(token, {
        useFactory: () => 42
      });

      const resolved = container.resolve(token);
      expect(resolved).toBe(42);
    });

    it('should register class provider', () => {
      class TestService {
        getValue() { return 'service-value'; }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, { useClass: TestService });

      const resolved = container.resolve(token);
      expect(resolved).toBeInstanceOf(TestService);
      expect(resolved.getValue()).toBe('service-value');
    });

    it('should register token provider (aliasing)', () => {
      const originalToken = createToken<string>('Original');
      const aliasToken = createToken<string>('Alias');

      container.register(originalToken, { useValue: 'original-value' });
      container.register(aliasToken, { useToken: originalToken });

      expect(container.resolve(aliasToken)).toBe('original-value');
    });

    it('should prevent duplicate registration by default', () => {
      const token = createToken<string>('Duplicate');

      container.register(token, { useValue: 'first' });

      expect(() => {
        container.register(token, { useValue: 'second' });
      }).toThrow(DuplicateRegistrationError);
    });

    it('should allow duplicate registration with override option', () => {
      const token = createToken<string>('Override');

      container.register(token, { useValue: 'first' });
      container.register(token, { useValue: 'second' }, { override: true });

      expect(container.resolve(token)).toBe('second');
    });

    it('should validate provider structure', () => {
      const token = createToken<any>('Invalid');

      expect(() => {
        container.register(token, {} as Provider<any>);
      }).toThrow(InvalidProviderError);
    });
  });

  describe('Resolution', () => {
    it('should resolve dependencies with inject array', () => {
      const depToken = createToken<string>('Dependency');
      const serviceToken = createToken<{ dep: string }>('Service');

      container.register(depToken, { useValue: 'dep-value' });
      container.register(serviceToken, {
        useFactory: (dep: string) => ({ dep }),
        inject: [depToken]
      });

      const resolved = container.resolve(serviceToken);
      expect(resolved.dep).toBe('dep-value');
    });

    it('should resolve optional dependencies', () => {
      const optionalToken = createToken<string | undefined>('Optional');
      const serviceToken = createToken<{ opt?: string }>('Service');

      container.register(serviceToken, {
        useFactory: (opt?: string) => ({ opt }),
        inject: [{ token: optionalToken, optional: true }]
      });

      const resolved = container.resolve(serviceToken);
      expect(resolved.opt).toBeUndefined();
    });

    it('should resolve many (multi-token)', () => {
      const multiToken = createToken<string>('Multi');

      container.register(multiToken, { useValue: 'first' }, { multi: true });
      container.register(multiToken, { useValue: 'second' }, { multi: true });
      container.register(multiToken, { useValue: 'third' }, { multi: true });

      const resolved = container.resolveMany(multiToken);
      expect(resolved).toEqual(['first', 'second', 'third']);
    });

    it('should detect circular dependencies', () => {
      const tokenA = createToken<any>('A');
      const tokenB = createToken<any>('B');

      container.register(tokenA, {
        useFactory: (b: any) => ({ b }),
        inject: [tokenB]
      });

      container.register(tokenB, {
        useFactory: (a: any) => ({ a }),
        inject: [tokenA]
      });

      expect(() => container.resolve(tokenA)).toThrow(CircularDependencyError);
    });

    it('should throw for unregistered dependencies', () => {
      const unknownToken = createToken<any>('Unknown');

      expect(() => container.resolve(unknownToken)).toThrow(DependencyNotFoundError);
    });

    it('should handle resolution with context', () => {
      const contextToken = createToken<string>('Context');

      container.register(contextToken, {
        useFactory: (context) => context.value,
        inject: [{ token: 'CONTEXT', type: 'context' }]
      });

      const resolved = container.resolve(contextToken, { value: 'context-value' });
      expect(resolved).toBe('context-value');
    });
  });

  describe('Scoping', () => {
    it('should handle singleton scope', () => {
      let counter = 0;
      const token = createToken<number>('Singleton');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Singleton
      });

      const first = container.resolve(token);
      const second = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(1);
      expect(first).toBe(second);
    });

    it('should handle transient scope', () => {
      let counter = 0;
      const token = createToken<number>('Transient');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Transient
      });

      const first = container.resolve(token);
      const second = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(2);
      expect(first).not.toBe(second);
    });

    it('should handle scoped scope', () => {
      let counter = 0;
      const token = createToken<number>('Scoped');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Scoped
      });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const fromScope1First = scope1.resolve(token);
      const fromScope1Second = scope1.resolve(token);
      const fromScope2 = scope2.resolve(token);

      expect(fromScope1First).toBe(1);
      expect(fromScope1Second).toBe(1);
      expect(fromScope2).toBe(2);
    });

    it('should handle request scope', () => {
      let counter = 0;
      const token = createToken<number>('Request');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Request
      });

      const request1 = container.createScope({ request: { id: 'req1' } });
      const request2 = container.createScope({ request: { id: 'req2' } });

      const fromReq1 = request1.resolve(token);
      const fromReq1Again = request1.resolve(token);
      const fromReq2 = request2.resolve(token);

      expect(fromReq1).toBe(1);
      expect(fromReq1Again).toBe(1);
      expect(fromReq2).toBe(2);
    });
  });

  describe('Lifecycle Management', () => {
    it('should call onInit lifecycle hook', async () => {
      const onInit = jest.fn();

      class TestService {
        async onInit() {
          onInit();
        }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, { useClass: TestService });

      const instance = container.resolve(token);
      await container.initialize();

      expect(onInit).toHaveBeenCalled();
    });

    it('should call onDestroy lifecycle hook', async () => {
      const onDestroy = jest.fn();

      class TestService {
        async onDestroy() {
          onDestroy();
        }
      }

      const token = createToken<TestService>('TestService');
      container.register(token, {
        useClass: TestService,
        scope: Scope.Singleton
      });

      container.resolve(token);
      await container.dispose();

      expect(onDestroy).toHaveBeenCalled();
    });

    it('should dispose in reverse dependency order', async () => {
      const disposeOrder: string[] = [];

      class ServiceA {
        async onDestroy() {
          disposeOrder.push('A');
        }
      }

      class ServiceB {
        constructor(public a: ServiceA) { }
        async onDestroy() {
          disposeOrder.push('B');
        }
      }

      const tokenA = createToken<ServiceA>('A');
      const tokenB = createToken<ServiceB>('B');

      container.register(tokenA, { useClass: ServiceA, scope: Scope.Singleton });
      container.register(tokenB, {
        useFactory: (a) => new ServiceB(a),
        inject: [tokenA],
        scope: Scope.Singleton
      });

      container.resolve(tokenB);
      await container.dispose();

      expect(disposeOrder).toEqual(['B', 'A']);
    });

    it('should prevent resolution after disposal', async () => {
      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      await container.dispose();

      expect(() => container.resolve(token)).toThrow(ContainerDisposedError);
    });
  });

  describe('Child Containers and Scopes', () => {
    it('should inherit registrations from parent', () => {
      const token = createToken<string>('Inherited');
      container.register(token, { useValue: 'parent-value' });

      const child = container.createScope();
      const resolved = child.resolve(token);

      expect(resolved).toBe('parent-value');
    });

    it('should allow child to override parent registrations', () => {
      const token = createToken<string>('Override');
      container.register(token, { useValue: 'parent-value' });

      const child = container.createScope();
      child.register(token, { useValue: 'child-value' });

      expect(container.resolve(token)).toBe('parent-value');
      expect(child.resolve(token)).toBe('child-value');
    });

    it('should maintain separate scope instances', () => {
      let counter = 0;
      const token = createToken<number>('Scoped');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Scoped
      });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      expect(scope1.resolve(token)).toBe(1);
      expect(scope2.resolve(token)).toBe(2);
    });

    it('should propagate context to child scopes', () => {
      const contextKey = 'testContext';
      const contextValue = 'context-value';

      const child = container.createScope({ [contextKey]: contextValue });

      const token = createToken<string>('ContextAware');
      child.register(token, {
        useFactory: (ctx) => ctx[contextKey],
        inject: [{ token: 'CONTEXT', type: 'context' }]
      });

      expect(child.resolve(token)).toBe(contextValue);
    });
  });

  describe('Error Handling', () => {
    it('should provide detailed error messages with resolution chain', () => {
      const tokenA = createToken<any>('ServiceA');
      const tokenB = createToken<any>('ServiceB');
      const tokenC = createToken<any>('ServiceC');

      container.register(tokenA, {
        useFactory: (b) => ({ b }),
        inject: [tokenB]
      });

      container.register(tokenB, {
        useFactory: (c) => ({ c }),
        inject: [tokenC]
      });

      try {
        container.resolve(tokenA);
      } catch (error) {
        expect(error).toBeInstanceOf(ResolutionError);
        expect(error.message).toContain('ServiceA');
        expect(error.message).toContain('ServiceB');
        expect(error.message).toContain('ServiceC');
        expect(error.chain).toEqual([tokenA, tokenB, tokenC]);
      }
    });

    it('should handle factory errors gracefully', () => {
      const token = createToken<any>('Failing');
      const errorMessage = 'Factory failed';

      container.register(token, {
        useFactory: () => {
          throw new Error(errorMessage);
        }
      });

      expect(() => container.resolve(token)).toThrow(ResolutionError);

      try {
        container.resolve(token);
      } catch (error) {
        expect(error.cause?.message).toBe(errorMessage);
      }
    });

    it('should validate token types', () => {
      expect(() => createToken('')).toThrow('Token name cannot be empty');

      const token = createToken<string>('Test');
      expect(token.name).toBe('Test');
      expect(token.toString()).toBe('[Token: Test]');
    });
  });

  describe('Performance Optimizations', () => {
    it('should cache singleton instances', () => {
      const factory = jest.fn(() => ({ value: 'cached' }));
      const token = createToken<{ value: string }>('Cached');

      container.register(token, {
        useFactory: factory,
        scope: Scope.Singleton
      });

      container.resolve(token);
      container.resolve(token);
      container.resolve(token);

      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should handle large dependency graphs efficiently', () => {
      const tokens: any[] = [];
      const depth = 100;

      // Create a deep dependency chain
      for (let i = 0; i < depth; i++) {
        const token = createToken<{ level: number }>(`Level${i}`);
        tokens.push(token);

        if (i === 0) {
          container.register(token, {
            useValue: { level: i }
          });
        } else {
          container.register(token, {
            useFactory: (prev) => ({ level: i, prev }),
            inject: [tokens[i - 1]]
          });
        }
      }

      const start = performance.now();
      const result = container.resolve(tokens[depth - 1]);
      const duration = performance.now() - start;

      expect(result.level).toBe(depth - 1);
      expect(duration).toBeLessThan(100); // Should resolve in less than 100ms
    });
  });
});