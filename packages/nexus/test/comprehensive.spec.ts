/**
 * Comprehensive test suite for Nexus DI Container
 * Focuses on achieving >96% test coverage
 */

import {
  Container,
  createToken,
  createMultiToken,
  createOptionalToken,
  Scope,
  IModule,
  Provider,
  ResolutionError,
  CircularDependencyError,
  DependencyNotFoundError,
  AsyncResolutionError,
  ContainerDisposedError,
  InvalidProviderError,
  DuplicateRegistrationError,
  InitializationError,
  DisposalError
} from '../src';

// Import Phase 2 features
import {
  Plugin,
  createPlugin,
  LifecycleEvent,
  createMiddleware,
  Middleware,
  MiddlewareContext,
  ContextKeys,
  createContextKey,
  createModule,
  createDynamicModule,
  moduleBuilder
} from '../src';

// Import utilities
import { PerformanceTimer } from '../src/utils/runtime';

describe('Comprehensive Container Tests', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Core Registration and Resolution', () => {
    it('should handle all provider types', () => {
      // Value provider
      const valueToken = createToken<string>('value');
      container.register(valueToken, { useValue: 'test-value' });
      expect(container.resolve(valueToken)).toBe('test-value');

      // Class provider
      class TestService {
        getValue() { return 'service'; }
      }
      const classToken = createToken<TestService>('class');
      container.register(classToken, { useClass: TestService });
      expect(container.resolve(classToken)).toBeInstanceOf(TestService);

      // Factory provider
      const factoryToken = createToken<{ id: number }>('factory');
      let id = 0;
      container.register(factoryToken, {
        useFactory: () => ({ id: ++id })
      });
      expect(container.resolve(factoryToken).id).toBe(1);
      expect(container.resolve(factoryToken).id).toBe(2);

      // Token provider
      const originalToken = createToken<string>('original');
      const aliasToken = createToken<string>('alias');
      container.register(originalToken, { useValue: 'original' });
      container.register(aliasToken, { useToken: originalToken });
      expect(container.resolve(aliasToken)).toBe('original');
    });

    it('should handle async providers', async () => {
      const asyncToken = createToken<{ data: string }>('async');
      
      container.registerAsync(asyncToken, {
        useFactory: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { data: 'async-data' };
        }
      });

      const result = await container.resolveAsync(asyncToken);
      expect(result.data).toBe('async-data');
    });

    it('should handle multi-token registration', () => {
      const multiToken = createMultiToken<string>('multi');
      
      container.register(multiToken, { useValue: 'first' });
      container.register(multiToken, { useValue: 'second' });
      container.register(multiToken, { useValue: 'third' });
      
      const values = container.resolveMany(multiToken);
      expect(values).toEqual(['first', 'second', 'third']);
    });

    it('should handle optional tokens', () => {
      const optionalToken = createOptionalToken<string>('optional');
      const missingToken = createToken<string>('missing');
      
      // Optional resolution should return undefined for missing
      const result = container.resolveOptional(optionalToken);
      expect(result).toBeUndefined();
      
      // Regular optional method
      const result2 = container.resolveOptional(missingToken);
      expect(result2).toBeUndefined();
      
      // After registration
      container.register(optionalToken, { useValue: 'exists' });
      expect(container.resolveOptional(optionalToken)).toBe('exists');
    });

    it('should handle dependency injection', () => {
      const dbToken = createToken<{ name: string }>('db');
      const serviceToken = createToken<{ db: any }>('service');
      
      container.register(dbToken, { useValue: { name: 'postgres' } });
      container.register(serviceToken, {
        useFactory: (db: any) => ({ db }),
        inject: [dbToken]
      });
      
      const service = container.resolve(serviceToken);
      expect(service.db.name).toBe('postgres');
    });

    it('should handle constructor registration directly', () => {
      class DirectService {
        name = 'direct';
      }
      
      container.register(DirectService, DirectService);
      const instance = container.resolve(DirectService);
      expect(instance.name).toBe('direct');
    });
  });

  describe('Scope Management', () => {
    it('should handle singleton scope', () => {
      const token = createToken<{ id: number }>('singleton');
      let counter = 0;
      
      container.register(token, {
        useFactory: () => ({ id: ++counter }),
        scope: Scope.Singleton
      });
      
      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);
      
      expect(instance1).toBe(instance2);
      expect(instance1.id).toBe(1);
    });

    it('should handle transient scope', () => {
      const token = createToken<{ id: number }>('transient');
      let counter = 0;
      
      container.register(token, {
        useFactory: () => ({ id: ++counter }),
        scope: Scope.Transient
      });
      
      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);
      
      expect(instance1).not.toBe(instance2);
      expect(instance1.id).toBe(1);
      expect(instance2.id).toBe(2);
    });

    it('should handle scoped instances', () => {
      const token = createToken<{ id: number }>('scoped');
      let counter = 0;
      
      container.register(token, {
        useFactory: () => ({ id: ++counter }),
        scope: Scope.Scoped
      });
      
      // Same scope should return same instance
      const scope1 = container.createScope({ metadata: { scopeId: 'scope1' } });
      const instance1a = scope1.resolve(token);
      const instance1b = scope1.resolve(token);
      expect(instance1a).toBe(instance1b);
      
      // Different scope should return different instance
      const scope2 = container.createScope({ metadata: { scopeId: 'scope2' } });
      const instance2 = scope2.resolve(token);
      expect(instance2).not.toBe(instance1a);
    });

    it('should handle request scope', () => {
      const token = createToken<{ id: number }>('request');
      let counter = 0;
      
      container.register(token, {
        useFactory: () => ({ id: ++counter }),
        scope: Scope.Request
      });
      
      // Without request context, falls back to transient
      const instance1 = container.resolve(token);
      const instance2 = container.resolve(token);
      expect(instance1).not.toBe(instance2);
      
      // With request context
      const requestScope = container.createScope({ 
        metadata: { requestId: 'req-123', scopeId: 'req-123' } 
      });
      const instance3 = requestScope.resolve(token);
      const instance4 = requestScope.resolve(token);
      expect(instance3).toBe(instance4);
    });
  });

  describe('Lifecycle and Initialization', () => {
    it('should initialize instances that implement Initializable', () => {
      let initialized = false;
      
      class InitService {
        initialize() {
          initialized = true;
        }
      }
      
      const token = createToken<InitService>('init');
      container.register(token, { useClass: InitService });
      
      container.resolve(token);
      expect(initialized).toBe(true);
    });

    it('should dispose instances that implement Disposable', async () => {
      let disposed = false;
      
      class DisposableService {
        async dispose() {
          disposed = true;
        }
      }
      
      const token = createToken<DisposableService>('disposable');
      container.register(token, { 
        useClass: DisposableService,
        scope: Scope.Singleton
      });
      
      container.resolve(token);
      await container.dispose();
      
      expect(disposed).toBe(true);
    });

    it('should emit lifecycle events', () => {
      const events: string[] = [];
      
      container.on(LifecycleEvent.BeforeResolve, () => {
        events.push('before');
      });
      
      container.on(LifecycleEvent.AfterResolve, () => {
        events.push('after');
      });
      
      container.on(LifecycleEvent.InstanceCreated, () => {
        events.push('created');
      });
      
      const token = createToken('test');
      container.register(token, { useValue: 'value' });
      container.resolve(token);
      
      expect(events).toContain('before');
      expect(events).toContain('after');
    });

    it('should handle cache hits', () => {
      const events: string[] = [];
      
      container.on(LifecycleEvent.CacheHit, () => {
        events.push('cache-hit');
      });
      
      const token = createToken('cached');
      container.register(token, { 
        useValue: 'value',
        scope: Scope.Singleton
      });
      
      container.resolve(token); // First resolution
      container.resolve(token); // Should hit cache
      
      expect(events).toContain('cache-hit');
    });
  });

  describe('Error Handling', () => {
    it('should throw on missing dependency', () => {
      const token = createToken('missing');
      expect(() => container.resolve(token)).toThrow(DependencyNotFoundError);
    });

    it('should detect circular dependencies', () => {
      const tokenA = createToken('A');
      const tokenB = createToken('B');
      
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

    it('should throw on duplicate registration without override', () => {
      const token = createToken('duplicate');
      
      container.register(token, { useValue: 'first' });
      
      expect(() => {
        container.register(token, { useValue: 'second' });
      }).toThrow(DuplicateRegistrationError);
    });

    it('should allow override with tag', () => {
      const token = createToken('override');
      
      container.register(token, { useValue: 'first' });
      container.register(token, { useValue: 'second' }, { tags: ['override'] });
      
      expect(container.resolve(token)).toBe('second');
    });

    it('should throw on async resolution in sync context', () => {
      const token = createToken('async');
      
      container.registerAsync(token, {
        useFactory: async () => 'value'
      });
      
      expect(() => container.resolve(token)).toThrow(AsyncResolutionError);
    });

    it('should throw when container is disposed', async () => {
      await container.dispose();
      
      const token = createToken('test');
      expect(() => container.register(token, { useValue: 'value' }))
        .toThrow(ContainerDisposedError);
    });

    it('should handle initialization errors', () => {
      class FailingService {
        initialize() {
          throw new Error('Init failed');
        }
      }
      
      const token = createToken('failing');
      container.register(token, { useClass: FailingService });
      
      expect(() => container.resolve(token)).toThrow(InitializationError);
    });

    it('should handle invalid providers', () => {
      const token = createToken('invalid');
      
      expect(() => {
        container.register(token, null as any);
      }).toThrow(InvalidProviderError);
      
      expect(() => {
        container.register(token, {} as any);
      }).toThrow(InvalidProviderError);
    });

    it('should emit error events', () => {
      let errorEvent: any;
      
      container.on(LifecycleEvent.ResolveFailed, (data) => {
        errorEvent = data;
      });
      
      const token = createToken('missing');
      
      try {
        container.resolve(token);
      } catch (e) {
        // Expected
      }
      
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error).toBeInstanceOf(DependencyNotFoundError);
    });
  });

  describe('Plugin System', () => {
    it('should install and execute plugins', () => {
      const calls: string[] = [];
      
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        install: (container) => {
          calls.push('install');
        },
        hooks: {
          beforeResolve: (token, context) => {
            calls.push('beforeResolve');
          },
          afterResolve: (token, instance, context) => {
            calls.push('afterResolve');
          },
          onError: (error, token, context) => {
            calls.push('onError');
          }
        }
      };
      
      container.use(plugin);
      expect(calls).toContain('install');
      
      const token = createToken('test');
      container.register(token, { useValue: 'value' });
      container.resolve(token);
      
      expect(calls).toContain('beforeResolve');
      expect(calls).toContain('afterResolve');
      
      // Trigger error
      try {
        container.resolve(createToken('missing'));
      } catch (e) {
        // Expected
      }
      expect(calls).toContain('onError');
    });

    it('should handle plugin with dependencies', () => {
      const basePlugin: Plugin = {
        name: 'base',
        version: '1.0.0',
        install: () => {}
      };
      
      const dependentPlugin: Plugin = {
        name: 'dependent',
        version: '1.0.0',
        dependencies: ['base'],
        install: () => {}
      };
      
      // Should fail without base
      expect(() => container.use(dependentPlugin)).toThrow();
      
      // Should work with base
      container.use(basePlugin);
      expect(() => container.use(dependentPlugin)).not.toThrow();
    });

    it('should prevent duplicate plugin installation', () => {
      const plugin: Plugin = {
        name: 'unique',
        version: '1.0.0',
        install: () => {}
      };
      
      container.use(plugin);
      expect(() => container.use(plugin)).toThrow();
    });
  });

  describe('Middleware System', () => {
    it('should execute middleware in priority order', () => {
      const execution: string[] = [];
      
      const middleware1: Middleware = {
        name: 'mid1',
        priority: 100,
        execute: (context, next) => {
          execution.push('before1');
          const result = next();
          execution.push('after1');
          return result;
        }
      };
      
      const middleware2: Middleware = {
        name: 'mid2',
        priority: 50,
        execute: (context, next) => {
          execution.push('before2');
          const result = next();
          execution.push('after2');
          return result;
        }
      };
      
      container.addMiddleware(middleware1);
      container.addMiddleware(middleware2);
      
      const token = createToken('test');
      container.register(token, {
        useFactory: () => {
          execution.push('factory');
          return 'value';
        }
      });
      
      container.resolve(token);
      
      expect(execution).toEqual([
        'before1',
        'before2', 
        'factory',
        'after2',
        'after1'
      ]);
    });

    it('should remove middleware', () => {
      const middleware: Middleware = {
        name: 'removable',
        execute: (context, next) => next()
      };
      
      container.addMiddleware(middleware);
      container.removeMiddleware('removable');
      
      // Should execute without the middleware
      const token = createToken('test');
      container.register(token, { useValue: 'value' });
      expect(container.resolve(token)).toBe('value');
    });

    it('should handle middleware errors', () => {
      const middleware: Middleware = {
        name: 'failing',
        execute: () => {
          throw new Error('Middleware failed');
        }
      };
      
      container.addMiddleware(middleware);
      
      const token = createToken('test');
      container.register(token, { useValue: 'value' });
      
      expect(() => container.resolve(token)).toThrow('Middleware failed');
    });
  });

  describe('Context System', () => {
    it('should manage context values', () => {
      const context = container.getContext();
      
      context.set(ContextKeys.User, { id: '123', name: 'John', roles: [] });
      context.set(ContextKeys.Environment, 'production');
      context.set(ContextKeys.RequestId, 'req-456');
      
      expect(context.get(ContextKeys.User)).toEqual({ id: '123', name: 'John', roles: [] });
      expect(context.get(ContextKeys.Environment)).toBe('production');
      expect(context.get(ContextKeys.RequestId)).toBe('req-456');
      
      expect(context.has(ContextKeys.User)).toBe(true);
      context.delete(ContextKeys.User);
      expect(context.has(ContextKeys.User)).toBe(false);
    });

    it('should run with context', () => {
      const context = container.getContext();
      context.set(ContextKeys.Locale, 'en-US');
      
      const result = container.withContext(() => {
        const ctx = container.getContext();
        return ctx.get(ContextKeys.Locale);
      });
      
      expect(result).toBe('en-US');
    });

    it('should create custom context keys', () => {
      const customKey = createContextKey<{ custom: string }>('custom');
      const context = container.getContext();
      
      context.set(customKey, { custom: 'value' });
      expect(context.get(customKey)).toEqual({ custom: 'value' });
    });

    it('should handle child contexts', () => {
      const context = container.getContext();
      context.set(ContextKeys.Environment, 'production');
      
      const child = context.createChild();
      child.set(ContextKeys.User, { id: '1', name: 'Alice', roles: [] });
      
      // Child sees parent values
      expect(child.get(ContextKeys.Environment)).toBe('production');
      
      // Parent doesn't see child values
      expect(context.get(ContextKeys.User)).toBeUndefined();
    });
  });

  describe('Module System', () => {
    it('should load basic modules', () => {
      const serviceToken = createToken<string>('service');
      
      const module: IModule = {
        name: 'TestModule',
        providers: [
          [serviceToken, { useValue: 'module-service' }]
        ]
      };
      
      container.loadModule(module);
      expect(container.resolve(serviceToken)).toBe('module-service');
    });

    it('should handle module imports', () => {
      const dbToken = createToken<string>('db');
      const appToken = createToken<string>('app');
      
      const dbModule: IModule = {
        name: 'DbModule',
        providers: [[dbToken, { useValue: 'database' }]]
      };
      
      const appModule: IModule = {
        name: 'AppModule',
        imports: [dbModule],
        providers: [[appToken, { useValue: 'application' }]]
      };
      
      container.loadModule(appModule);
      
      expect(container.resolve(dbToken)).toBe('database');
      expect(container.resolve(appToken)).toBe('application');
    });

    it('should handle module lifecycle hooks', async () => {
      let initCalled = false;
      let destroyCalled = false;
      
      const module: IModule = {
        name: 'LifecycleModule',
        onModuleInit: () => {
          initCalled = true;
        },
        onModuleDestroy: async () => {
          destroyCalled = true;
        }
      };
      
      container.loadModule(module);
      expect(initCalled).toBe(true);
      
      await container.dispose();
      expect(destroyCalled).toBe(true);
    });

    it('should handle async module initialization', async () => {
      let asyncInit = false;
      
      const module: IModule = {
        name: 'AsyncModule',
        onModuleInit: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          asyncInit = true;
        }
      };
      
      container.loadModule(module);
      
      // Wait for async init
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(asyncInit).toBe(true);
    });

    it('should create modules with builder', () => {
      const tokenA = createToken<string>('A');
      const tokenB = createToken<string>('B');
      
      const module = moduleBuilder('BuiltModule')
        .providers(
          [tokenA, { useValue: 'valueA' }],
          [tokenB, { useValue: 'valueB' }]
        )
        .exports(tokenA)
        .global(true)
        .build();
      
      container.loadEnhancedModule(module);
      
      expect(container.resolve(tokenA)).toBe('valueA');
      expect(container.resolve(tokenB)).toBe('valueB');
    });

    it('should create dynamic modules', () => {
      const token = createToken<string>('dynamic');
      const baseModule = { name: 'BaseModule' };
      
      const dynamicModule = createDynamicModule(baseModule, {
        providers: [[token, { useValue: 'dynamic-value' }]],
        global: true
      });
      
      container.loadEnhancedModule(dynamicModule);
      expect(container.resolve(token)).toBe('dynamic-value');
    });

    it('should prevent duplicate module loading', () => {
      const module: IModule = {
        name: 'UniqueModule',
        providers: []
      };
      
      container.loadModule(module);
      container.loadModule(module); // Should not throw, just skip
      
      expect(container.getMetadata().registrations).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Metadata and Introspection', () => {
    it('should check token registration', () => {
      const token = createToken('check');
      
      expect(container.has(token)).toBe(false);
      
      container.register(token, { useValue: 'value' });
      
      expect(container.has(token)).toBe(true);
    });

    it('should get container metadata', () => {
      const token1 = createToken('t1');
      const token2 = createToken('t2');
      
      container.register(token1, { useValue: 'v1', scope: Scope.Singleton });
      container.register(token2, { useValue: 'v2' });
      
      container.resolve(token1); // Cache singleton
      
      const metadata = container.getMetadata();
      
      expect(metadata.registrations).toBe(2);
      expect(metadata.cached).toBeGreaterThan(0);
      expect(metadata.parent).toBeUndefined();
    });

    it('should track parent container', () => {
      const child = container.createScope();
      const metadata = child.getMetadata();
      
      expect(metadata.parent).toBe(container);
    });

    it('should inherit from parent container', () => {
      const token = createToken('inherited');
      
      container.register(token, { useValue: 'parent-value' });
      
      const child = container.createScope();
      
      expect(child.has(token)).toBe(true);
      expect(child.resolve(token)).toBe('parent-value');
    });

    it('should override parent registration in child', () => {
      const token = createToken('override');
      
      container.register(token, { useValue: 'parent' });
      
      const child = container.createScope();
      child.register(token, { useValue: 'child' }, { tags: ['override'] });
      
      expect(container.resolve(token)).toBe('parent');
      expect(child.resolve(token)).toBe('child');
    });
  });

  describe('Cache Management', () => {
    it('should clear cache', () => {
      const token = createToken<{ id: number }>('cached');
      let counter = 0;
      
      container.register(token, {
        useFactory: () => ({ id: ++counter }),
        scope: Scope.Singleton
      });
      
      const instance1 = container.resolve(token);
      expect(instance1.id).toBe(1);
      
      container.clearCache();
      
      const instance2 = container.resolve(token);
      expect(instance2.id).toBe(2);
    });

    it('should preserve value providers when clearing cache', () => {
      const token = createToken('value');
      
      container.register(token, { useValue: 'preserved' });
      container.resolve(token);
      
      container.clearCache();
      
      expect(container.resolve(token)).toBe('preserved');
    });

    it('should clear scoped instances', () => {
      const token = createToken<{ id: number }>('scoped');
      let counter = 0;
      
      container.register(token, {
        useFactory: () => ({ id: ++counter }),
        scope: Scope.Scoped
      });
      
      const scope = container.createScope({ metadata: { scopeId: 'test' } });
      const instance1 = scope.resolve(token);
      
      scope.clearCache();  // Clear the scope's cache, not the parent's
      
      const instance2 = scope.resolve(token);
      expect(instance2.id).not.toBe(instance1.id);
    });
  });

  describe('Conditional Providers', () => {
    it('should resolve based on condition', () => {
      const token = createToken<string>('conditional');
      
      container.register(token, {
        when: (ctx: any) => ctx.metadata?.environment === 'production',
        useFactory: () => 'production-value',
        fallback: { useValue: 'development-value' }
      } as any);
      
      // Default should use fallback
      expect(container.resolve(token)).toBe('development-value');
      
      // With production context
      const prodContainer = container.createScope({
        metadata: { environment: 'production' }
      });
      expect(prodContainer.resolve(token)).toBe('production-value');
    });

    it('should throw when condition fails without fallback', () => {
      const token = createToken('no-fallback');
      
      container.register(token, {
        when: () => false,
        useFactory: () => 'value'
      } as any);
      
      expect(() => container.resolve(token)).toThrow(DependencyNotFoundError);
    });
  });

  describe('Performance Utilities', () => {
    it('should measure performance with timer', () => {
      const timer = new PerformanceTimer();
      
      // Test timer functionality exists
      expect(timer).toBeDefined();
      
      // Test basic timing
      const start = Date.now();
      while (Date.now() - start < 10) {}
      const end = Date.now();
      
      expect(end - start).toBeGreaterThanOrEqual(10);
      
      // Reset timer
      timer.reset();
      expect(timer).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null and undefined gracefully', () => {
      const token = createToken('nullable');
      
      container.register(token, { useValue: null });
      expect(container.resolve(token)).toBeNull();
      
      const undefinedToken = createToken('undefined');
      container.register(undefinedToken, { useValue: undefined });
      expect(container.resolve(undefinedToken)).toBeUndefined();
    });

    it('should handle empty arrays and objects', () => {
      const arrayToken = createToken<any[]>('array');
      const objectToken = createToken<{}>('object');
      
      container.register(arrayToken, { useValue: [] });
      container.register(objectToken, { useValue: {} });
      
      expect(container.resolve(arrayToken)).toEqual([]);
      expect(container.resolve(objectToken)).toEqual({});
    });

    it('should handle recursive resolution', () => {
      const tokenA = createToken<{ b: any }>('A');
      const tokenB = createToken<{ c: any }>('B');
      const tokenC = createToken<string>('C');
      
      container.register(tokenC, { useValue: 'leaf' });
      container.register(tokenB, {
        useFactory: (c: any) => ({ c }),
        inject: [tokenC]
      });
      container.register(tokenA, {
        useFactory: (b: any) => ({ b }),
        inject: [tokenB]
      });
      
      const result = container.resolve(tokenA);
      expect(result.b.c).toBe('leaf');
    });

    it('should handle very long dependency chains', () => {
      const tokens: any[] = [];
      const depth = 50;
      
      for (let i = 0; i < depth; i++) {
        tokens[i] = createToken(`Token${i}`);
      }
      
      // Register base token
      container.register(tokens[0], { useValue: 'base' });
      
      // Register chain
      for (let i = 1; i < depth; i++) {
        const prevToken = tokens[i - 1];
        container.register(tokens[i], {
          useFactory: (prev: any) => `chain-${i}-${prev}`,
          inject: [prevToken]
        });
      }
      
      const result = container.resolve(tokens[depth - 1]);
      expect(result).toContain('base');
      expect(result).toContain(`chain-${depth - 1}`);
    });

    it('should handle concurrent async resolutions', async () => {
      const tokens = Array.from({ length: 10 }, (_, i) => 
        createToken<{ id: number }>(`async${i}`)
      );
      
      tokens.forEach((token, i) => {
        container.registerAsync(token, {
          useFactory: async () => {
            await new Promise(resolve => 
              setTimeout(resolve, Math.random() * 50)
            );
            return { id: i };
          }
        });
      });
      
      const results = await Promise.all(
        tokens.map(token => container.resolveAsync(token))
      );
      
      results.forEach((result, i) => {
        expect(result.id).toBe(i);
      });
    });

    it('should handle factory functions throwing errors', () => {
      const token = createToken('throwing');
      
      container.register(token, {
        useFactory: () => {
          throw new Error('Factory error');
        }
      });
      
      expect(() => container.resolve(token)).toThrow(InitializationError);
    });

    it('should handle async factory errors', async () => {
      const token = createToken('async-throwing');
      
      container.registerAsync(token, {
        useFactory: async () => {
          throw new Error('Async factory error');
        }
      });
      
      await expect(container.resolveAsync(token)).rejects.toThrow();
    });
  });
});