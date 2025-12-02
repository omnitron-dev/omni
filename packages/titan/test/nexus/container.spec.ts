/**
 * Comprehensive Container Tests
 * Tests for the core DI container implementation covering all features
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import 'reflect-metadata';

import {
  Container,
  createToken,
  Scope,
  ResolutionError,
  AsyncResolutionError,
  CircularDependencyError,
  DependencyNotFoundError,
  ContainerDisposedError,
  InvalidProviderError,
  DuplicateRegistrationError,
  LifecycleEvent,
  isToken,
  isMultiToken,
  createMultiToken,
} from '../../src/nexus/index.js';

import {
  Injectable,
  Inject,
  Optional,
  Singleton,
  Transient,
} from '../../src/decorators/index.js';

describe('Container - Comprehensive Tests', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    if (container && !container['disposed']) {
      await container.dispose();
    }
  });

  describe('Registration', () => {
    it('should register value provider', () => {
      const token = createToken<string>('TestValue');
      container.register(token, { useValue: 'test-value' });
      
      expect(container.resolve(token)).toBe('test-value');
      expect(container.has(token)).toBe(true);
    });

    it('should register factory provider', () => {
      const token = createToken<number>('TestFactory');
      container.register(token, { useFactory: () => 42 });
      
      expect(container.resolve(token)).toBe(42);
    });

    it('should register class provider', () => {
      @Injectable()
      class TestService {
        getValue() {
          return 'service-value';
        }
      }

      container.register(TestService);
      const service = container.resolve(TestService);
      
      expect(service).toBeInstanceOf(TestService);
      expect(service.getValue()).toBe('service-value');
    });

    it('should register with token aliasing (useToken)', () => {
      const originalToken = createToken<string>('Original');
      const aliasToken = createToken<string>('Alias');

      container.register(originalToken, { useValue: 'original-value' });
      container.register(aliasToken, { useToken: originalToken });

      expect(container.resolve(aliasToken)).toBe('original-value');
    });

    it('should prevent duplicate registration without override', () => {
      const token = createToken<string>('Duplicate');
      container.register(token, { useValue: 'first' });

      expect(() => {
        container.register(token, { useValue: 'second' });
      }).toThrow(DuplicateRegistrationError);
    });

    it('should allow override when specified', () => {
      const token = createToken<string>('Override');
      container.register(token, { useValue: 'first' });
      container.register(token, { useValue: 'second' }, { override: true });

      expect(container.resolve(token)).toBe('second');
    });

    it('should throw on invalid provider', () => {
      const token = createToken<any>('Invalid');
      
      expect(() => {
        container.register(token, {} as any);
      }).toThrow(InvalidProviderError);
    });

    it('should handle multi-token registration', () => {
      const multiToken = createMultiToken<string>('Multi');

      container.register(multiToken, { useValue: 'first' }, { multi: true });
      container.register(multiToken, { useValue: 'second' }, { multi: true });
      container.register(multiToken, { useValue: 'third' }, { multi: true });

      const all = container.resolveAll(multiToken);
      expect(all).toContain('first');
      expect(all).toContain('second');
      expect(all).toContain('third');
      expect(all.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Resolution', () => {
    it('should resolve with constructor injection', () => {
      const depToken = createToken<string>('Dependency');
      
      @Injectable()
      class ServiceWithDependency {
        constructor(@Inject(depToken) public dep: string) {}
      }

      container.register(depToken, { useValue: 'dep-value' });
      container.register(ServiceWithDependency);

      const service = container.resolve(ServiceWithDependency);
      expect(service.dep).toBe('dep-value');
    });

    it('should resolve with factory injection', () => {
      const depToken = createToken<string>('Dependency');
      const serviceToken = createToken<{ dep: string }>('Service');

      container.register(depToken, { useValue: 'dep-value' });
      container.register(serviceToken, {
        useFactory: (dep: string) => ({ dep }),
        inject: [depToken],
      });

      const service = container.resolve(serviceToken);
      expect(service.dep).toBe('dep-value');
    });

    it('should resolve optional dependencies', () => {
      const optionalToken = createToken<string>('Optional');
      
      @Injectable()
      class ServiceWithOptional {
        constructor(
          @Optional() @Inject(optionalToken) public opt?: string
        ) {}
      }

      container.register(ServiceWithOptional);
      const service = container.resolve(ServiceWithOptional);
      
      expect(service.opt).toBeUndefined();
    });

    it.skip('should resolve property injection', () => {
      // Property injection not yet implemented
      const depToken = createToken<string>('Dependency');

      @Injectable()
      class ServiceWithProperty {
        @Inject(depToken)
        public dep!: string;
      }

      container.register(depToken, { useValue: 'property-value' });
      container.register(ServiceWithProperty);

      const service = container.resolve(ServiceWithProperty);
      expect(service.dep).toBe('property-value');
    });

    it('should throw DependencyNotFoundError for unregistered token', () => {
      const unknownToken = createToken<any>('Unknown');
      
      expect(() => container.resolve(unknownToken)).toThrow(DependencyNotFoundError);
    });

    it('should detect circular dependencies', () => {
      const tokenA = createToken<any>('A');
      const tokenB = createToken<any>('B');

      container.register(tokenA, {
        useFactory: (b: any) => ({ b }),
        inject: [tokenB],
      });

      container.register(tokenB, {
        useFactory: (a: any) => ({ a }),
        inject: [tokenA],
      });

      expect(() => container.resolve(tokenA)).toThrow(CircularDependencyError);
    });

    it('should detect indirect circular dependencies', () => {
      const tokenA = createToken<any>('A');
      const tokenB = createToken<any>('B');
      const tokenC = createToken<any>('C');

      container.register(tokenA, {
        useFactory: (b: any) => ({ b }),
        inject: [tokenB],
      });

      container.register(tokenB, {
        useFactory: (c: any) => ({ c }),
        inject: [tokenC],
      });

      container.register(tokenC, {
        useFactory: (a: any) => ({ a }),
        inject: [tokenA],
      });

      expect(() => container.resolve(tokenA)).toThrow(CircularDependencyError);
    });

    it('should resolve with context', () => {
      const contextToken = createToken<string>('Context');

      container.register(contextToken, {
        useFactory: (context: any) => context.value,
        inject: [{ token: 'CONTEXT', type: 'context' }],
      });

      const result = container.resolve(contextToken, { value: 'context-value' });
      expect(result).toBe('context-value');
    });

    it('should resolve multiple tokens', () => {
      const token = createToken<string>('Multi');
      
      container.register(token, { useValue: 'first' }, { multi: true });
      container.register(token, { useValue: 'second' }, { multi: true });

      const results = container.resolveMany(token);
      expect(results).toEqual(['first', 'second']);
    });

    it('should return empty array for non-existent multi-token', () => {
      const token = createToken<string>('NonExistent');
      const results = container.resolveMany(token);
      
      expect(results).toEqual([]);
    });
  });

  describe('Scoping', () => {
    it('should handle singleton scope correctly', () => {
      let counter = 0;
      const token = createToken<number>('Singleton');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Singleton,
      });

      const first = container.resolve(token);
      const second = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(1);
      expect(counter).toBe(1);
    });

    it('should handle transient scope correctly', () => {
      let counter = 0;
      const token = createToken<number>('Transient');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Transient,
      });

      const first = container.resolve(token);
      const second = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(2);
      expect(counter).toBe(2);
    });

    it('should handle scoped instances', () => {
      let counter = 0;
      const token = createToken<number>('Scoped');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Scoped,
      });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const fromScope1a = scope1.resolve(token);
      const fromScope1b = scope1.resolve(token);
      const fromScope2 = scope2.resolve(token);

      expect(fromScope1a).toBe(1);
      expect(fromScope1b).toBe(1); // Same instance in same scope
      expect(fromScope2).toBe(2); // Different instance in different scope
    });

    it('should handle request scope', () => {
      let counter = 0;
      const token = createToken<number>('Request');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Request,
      });

      const req1 = container.createScope({ request: { id: 'req1' } });
      const req2 = container.createScope({ request: { id: 'req2' } });

      const fromReq1 = req1.resolve(token);
      const fromReq1Again = req1.resolve(token);
      const fromReq2 = req2.resolve(token);

      expect(fromReq1).toBe(1);
      expect(fromReq1Again).toBe(1);
      expect(fromReq2).toBe(2);
    });
  });

  describe('Async Resolution', () => {
    it('should resolve async factory', async () => {
      const token = createToken<string>('AsyncFactory');

      container.register(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async-value';
        },
      });

      const result = await container.resolveAsync(token);
      expect(result).toBe('async-value');
    });

    it('should throw AsyncResolutionError when using sync resolve on async provider', () => {
      const token = createToken<string>('AsyncFactory');

      container.register(token, {
        useFactory: async () => 'async-value',
      });

      expect(() => container.resolve(token)).toThrow(AsyncResolutionError);
    });

    it('should handle async dependencies', async () => {
      const depToken = createToken<string>('AsyncDep');
      const serviceToken = createToken<string>('Service');

      container.register(depToken, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'async-dep';
        },
      });

      container.register(serviceToken, {
        useFactory: (dep: string) => `service-${dep}`,
        inject: [depToken],
      });

      const result = await container.resolveAsync(serviceToken);
      expect(result).toBe('service-async-dep');
    });

    it('should handle async onInit lifecycle', async () => {
      const initSpy = jest.fn();

      @Injectable()
      class AsyncService {
        async onInit() {
          await new Promise(resolve => setTimeout(resolve, 10));
          initSpy();
        }
      }

      container.register(AsyncService);
      await container.resolveAsync(AsyncService);

      expect(initSpy).toHaveBeenCalled();
    });

    it('should support retry logic for async providers', async () => {
      let attempts = 0;
      const token = createToken<string>('RetryFactory');

      container.register(token, {
        useFactory: async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Temporary failure');
          }
          return 'success';
        },
        retry: { maxAttempts: 3, delay: 10 },
      });

      const result = await container.resolveAsync(token);
      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should support timeout for async providers', async () => {
      const token = createToken<string>('TimeoutFactory');

      container.register(token, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 'value';
        },
        timeout: 50,
      });

      await expect(container.resolveAsync(token)).rejects.toThrow();
    });

    it('should resolve parallel dependencies', async () => {
      const token1 = createToken<number>('Token1');
      const token2 = createToken<number>('Token2');
      const token3 = createToken<number>('Token3');

      container.register(token1, { useValue: 1 });
      container.register(token2, { useValue: 2 });
      container.register(token3, { useValue: 3 });

      const results = await container.resolveParallel([token1, token2, token3]);
      expect(results).toEqual([1, 2, 3]);
    });

    it('should handle batch resolution with object map', async () => {
      const token1 = createToken<number>('Token1');
      const token2 = createToken<string>('Token2');

      container.register(token1, { useValue: 42 });
      container.register(token2, { useValue: 'hello' });

      const results = await container.resolveBatch({
        num: token1,
        str: token2,
      });

      expect(results.num).toBe(42);
      expect(results.str).toBe('hello');
    });
  });

  describe('Lifecycle Management', () => {
    it('should call initialize lifecycle hook', async () => {
      const initSpy = jest.fn();

      @Injectable()
      class ServiceWithInit {
        initialize() {
          initSpy();
        }
      }

      container.register(ServiceWithInit);
      container.resolve(ServiceWithInit);
      await container.initialize();

      expect(initSpy).toHaveBeenCalled();
    });

    it('should call onDestroy lifecycle hook', async () => {
      const destroySpy = jest.fn();

      @Injectable()
      class ServiceWithDestroy {
        async onDestroy() {
          destroySpy();
        }
      }

      container.register(ServiceWithDestroy, { useClass: ServiceWithDestroy, scope: Scope.Singleton });
      container.resolve(ServiceWithDestroy);
      await container.dispose();

      expect(destroySpy).toHaveBeenCalled();
    });

    it('should dispose in reverse dependency order', async () => {
      const disposeOrder: string[] = [];

      @Injectable()
      class ServiceA {
        async onDestroy() {
          disposeOrder.push('A');
        }
      }

      @Injectable()
      class ServiceB {
        constructor(@Inject(ServiceA) public a: ServiceA) {}
        
        async onDestroy() {
          disposeOrder.push('B');
        }
      }

      container.register(ServiceA, { useClass: ServiceA, scope: Scope.Singleton });
      container.register(ServiceB, { useClass: ServiceB, scope: Scope.Singleton });

      container.resolve(ServiceB);
      await container.dispose();

      expect(disposeOrder).toEqual(['B', 'A']);
    });

    it('should emit lifecycle events', () => {
      const events: LifecycleEvent[] = [];

      container.on(LifecycleEvent.BeforeResolve, () => events.push(LifecycleEvent.BeforeResolve));
      container.on(LifecycleEvent.AfterResolve, () => events.push(LifecycleEvent.AfterResolve));

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(events).toContain(LifecycleEvent.BeforeResolve);
      expect(events).toContain(LifecycleEvent.AfterResolve);
    });

    it('should call dispose on Disposable instances', async () => {
      const disposeSpy = jest.fn();

      @Injectable()
      class DisposableService {
        async dispose() {
          disposeSpy();
        }
      }

      container.register(DisposableService, { useClass: DisposableService, scope: Scope.Singleton });
      container.resolve(DisposableService);
      await container.dispose();

      expect(disposeSpy).toHaveBeenCalled();
    });
  });

  describe('Child Containers', () => {
    it('should create child container', () => {
      const child = container.createChildContainer();
      expect(child).toBeDefined();
      expect(child).not.toBe(container);
    });

    it('should resolve from parent container', () => {
      const token = createToken<string>('ParentToken');
      container.register(token, { useValue: 'parent-value' });

      const child = container.createChildContainer();
      expect(child.resolve(token)).toBe('parent-value');
    });

    it('should override parent registrations', () => {
      const token = createToken<string>('Token');
      container.register(token, { useValue: 'parent-value' });

      const child = container.createChildContainer();
      child.register(token, { useValue: 'child-value' }, { override: true });

      expect(child.resolve(token)).toBe('child-value');
      expect(container.resolve(token)).toBe('parent-value');
    });

    it('should isolate scoped instances in child containers', () => {
      let counter = 0;
      const token = createToken<number>('Scoped');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Scoped,
      });

      const child1 = container.createChildContainer();
      const child2 = container.createChildContainer();

      const fromChild1 = child1.resolve(token);
      const fromChild2 = child2.resolve(token);

      expect(fromChild1).toBe(1);
      expect(fromChild2).toBe(2);
    });
  });

  describe('Module System', () => {
    it('should load module with providers', () => {
      const TestToken = createToken<string>('TestService');

      const testModule = {
        name: 'TestModule',
        providers: [
          [TestToken, { useValue: 'test-value' }],
        ],
      };

      container.loadModule(testModule);
      expect(container.resolve(TestToken)).toBe('test-value');
    });

    it('should handle module exports', () => {
      const ExportedToken = createToken<string>('Exported');
      const InternalToken = createToken<string>('Internal');

      const testModule = {
        name: 'TestModule',
        providers: [
          [ExportedToken, { useValue: 'exported' }],
          [InternalToken, { useValue: 'internal' }],
        ],
        exports: [ExportedToken],
      };

      container.loadModule(testModule);
      expect(container.resolve(ExportedToken)).toBe('exported');
    });

    it('should handle module imports', () => {
      const SharedToken = createToken<string>('Shared');

      const sharedModule = {
        name: 'SharedModule',
        providers: [[SharedToken, { useValue: 'shared-value' }]],
        exports: [SharedToken],
      };

      const consumerModule = {
        name: 'ConsumerModule',
        imports: [sharedModule],
      };

      container.loadModule(sharedModule);
      container.loadModule(consumerModule);
      
      expect(container.resolve(SharedToken)).toBe('shared-value');
    });

    it('should detect circular module dependencies', () => {
      const moduleA: any = {
        name: 'ModuleA',
        imports: [],
      };

      const moduleB: any = {
        name: 'ModuleB',
        imports: [moduleA],
      };

      moduleA.imports = [moduleB]; // Create circular reference

      expect(() => container.loadModule(moduleA)).toThrow(/circular/i);
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      let counter = 0;
      const token = createToken<number>('Cached');

      container.register(token, {
        useFactory: () => ++counter,
        scope: Scope.Singleton,
      });

      const first = container.resolve(token);
      container.clearCache();
      const second = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(2);
    });

    it('should preserve value registrations after cache clear', () => {
      const token = createToken<string>('Value');
      container.register(token, { useValue: 'preserved' });

      const before = container.resolve(token);
      container.clearCache();
      const after = container.resolve(token);

      expect(before).toBe('preserved');
      expect(after).toBe('preserved');
    });
  });

  describe('Plugins and Middleware', () => {
    it('should install plugin', () => {
      const plugin = {
        name: 'TestPlugin',
        install: jest.fn(),
      };

      container.use(plugin);
      expect(container.hasPlugin('TestPlugin')).toBe(true);
      expect(plugin.install).toHaveBeenCalled();
    });

    it('should execute plugin hooks', () => {
      const beforeResolve = jest.fn();
      const afterResolve = jest.fn();

      const plugin = {
        name: 'HookPlugin',
        install(container: Container) {
          container.addHook('beforeResolve', beforeResolve);
          container.addHook('afterResolve', afterResolve);
        },
      };

      container.use(plugin);
      
      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(beforeResolve).toHaveBeenCalled();
      expect(afterResolve).toHaveBeenCalled();
    });

    it('should add middleware', () => {
      const middleware = {
        name: 'TestMiddleware',
        execute: jest.fn((context, next) => next()),
      };

      container.addMiddleware(middleware);
      
      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(middleware.execute).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should throw ContainerDisposedError when accessing disposed container', async () => {
      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      
      await container.dispose();

      expect(() => container.resolve(token)).toThrow(ContainerDisposedError);
      expect(() => container.register(token, { useValue: 'new' })).toThrow(ContainerDisposedError);
    });

    it('should wrap factory errors in ResolutionError', () => {
      const token = createToken<any>('ErrorFactory');

      container.register(token, {
        useFactory: () => {
          throw new Error('Factory error');
        },
      });

      expect(() => container.resolve(token)).toThrow(ResolutionError);
    });

    it('should handle errors in lifecycle hooks gracefully', async () => {
      @Injectable()
      class ErrorService {
        async onInit() {
          throw new Error('Init error');
        }
      }

      container.register(ErrorService);
      container.resolve(ErrorService);

      await expect(container.initialize()).rejects.toThrow();
    });
  });

  describe('Metadata and Introspection', () => {
    it('should provide container metadata', () => {
      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      const metadata = container.getMetadata();
      expect(metadata.registrations).toBeGreaterThan(0);
      expect(metadata.cached).toBeGreaterThan(0);
    });

    it('should check if token is registered', () => {
      const token = createToken<string>('Test');
      
      expect(container.has(token)).toBe(false);
      
      container.register(token, { useValue: 'test' });
      
      expect(container.has(token)).toBe(true);
    });
  });

  describe('Lazy Resolution', () => {
    it('should create lazy proxy', () => {
      const resolveSpy = jest.fn(() => ({ getValue: () => 'lazy-value' }));
      const token = createToken<{ getValue: () => string }>('Lazy');

      container.register(token, { useFactory: resolveSpy });

      const proxy = container.resolveLazy(token);
      expect(resolveSpy).not.toHaveBeenCalled();

      const value = proxy.getValue();
      expect(resolveSpy).toHaveBeenCalled();
      expect(value).toBe('lazy-value');
    });

    it.skip('should create async lazy proxy', async () => {
      // resolveLazyAsync not yet implemented
      const token = createToken<{ getValue: () => string }>('AsyncLazy');

      container.register(token, {
        useFactory: async () => ({ getValue: () => 'async-lazy-value' }),
      });

      const proxy = await container.resolveLazyAsync(token);
      const value = await proxy.getValue();

      expect(value).toBe('async-lazy-value');
    });
  });

  describe('Stream Providers', () => {
    it('should register stream provider', () => {
      const token = createToken<AsyncIterable<number>>('Stream');
      
      async function* generator() {
        yield 1;
        yield 2;
        yield 3;
      }

      container.registerStream(token, {
        useFactory: () => generator(),
      });

      const stream = container.resolveStream(token);
      expect(stream).toBeDefined();
    });

    it('should resolve stream with filtering', async () => {
      const token = createToken<AsyncIterable<number>>('FilteredStream');
      
      async function* generator() {
        yield 1;
        yield 2;
        yield 3;
        yield 4;
      }

      container.registerStream(token, {
        useFactory: () => generator(),
        filter: (x: number) => x % 2 === 0,
      } as any);

      const stream = container.resolveStream(token);
      const results: number[] = [];
      
      for await (const value of stream) {
        results.push(value as number);
      }

      expect(results).toEqual([2, 4]);
    });
  });

  describe('Context Management', () => {
    it('should provide context', () => {
      const context = container.getContext();
      expect(context).toBeDefined();
    });

    it('should run code within context', () => {
      const result = container.withContext(() => {
        return 'context-result';
      });

      expect(result).toBe('context-result');
    });
  });

  describe('Auto Registration', () => {
    it('should auto-register decorated class', () => {
      @Injectable()
      @Singleton()
      class AutoService {
        getValue() {
          return 'auto';
        }
      }

      container.autoRegister(AutoService);
      const service = container.resolve(createToken<AutoService>('AutoService'));
      
      expect(service).toBeInstanceOf(AutoService);
      expect(service.getValue()).toBe('auto');
    });
  });
});
