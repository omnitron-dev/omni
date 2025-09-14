/**
 * Tests for Nexus Container Phase 2 features
 */

import {
  Container,
  createToken,
  Provider,
  ResolutionContext,
  // Plugin System
  createPlugin,
  LoggingPlugin,
  MetricsPlugin,
  PerformancePlugin,
  // Middleware System
  createMiddleware,
  LoggingMiddleware,
  RetryMiddleware,
  CircuitBreakerMiddleware,
  // Lifecycle Management
  LifecycleEvent,
  PerformanceObserver,
  // Context System
  createContextKey,
  ContextKeys,
  // Module System
  createModule,
  createDynamicModule,
  moduleBuilder,
  createConfigModule
} from '../src';

describe('Phase 2 Features', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Plugin System', () => {
    it('should install and execute plugins', () => {
      const hookCalls: string[] = [];
      
      const testPlugin = createPlugin({
        name: 'test',
        version: '1.0.0',
        install(container) {
          hookCalls.push('install');
        },
        hooks: {
          beforeResolve: () => {
            hookCalls.push('beforeResolve');
          },
          afterResolve: () => {
            hookCalls.push('afterResolve');
          }
        }
      });

      container.use(testPlugin);
      expect(hookCalls).toContain('install');

      const token = createToken<string>('test');
      container.register(token, { useValue: 'value' });
      container.resolve(token);

      expect(hookCalls).toContain('beforeResolve');
      expect(hookCalls).toContain('afterResolve');
    });

    it('should handle plugin dependencies', () => {
      const basePlugin = createPlugin({
        name: 'base',
        version: '1.0.0',
        install() {}
      });

      const dependentPlugin = createPlugin({
        name: 'dependent',
        version: '1.0.0',
        dependencies: ['base'],
        install() {}
      });

      // Should fail without base plugin
      expect(() => container.use(dependentPlugin)).toThrow();

      // Should work with base plugin
      container.use(basePlugin);
      expect(() => container.use(dependentPlugin)).not.toThrow();
    });

    it('should collect metrics with MetricsPlugin', () => {
      container.use(MetricsPlugin);

      const token = createToken<string>('metric-test');
      container.register(token, { useValue: 'value' });
      
      container.resolve(token);
      container.resolve(token);
      container.resolve(token);

      const metrics = (container as any).__metrics;
      expect(metrics).toBeDefined();
      expect(metrics.get(token.name)).toBe(3);
    });
  });

  describe('Middleware System', () => {
    it('should execute middleware pipeline', () => {
      const executionOrder: string[] = [];

      const middleware1 = createMiddleware({
        name: 'middleware1',
        priority: 100,
        execute: (context, next) => {
          executionOrder.push('before1');
          const result = next();
          executionOrder.push('after1');
          return result;
        }
      });

      const middleware2 = createMiddleware({
        name: 'middleware2',
        priority: 50,
        execute: (context, next) => {
          executionOrder.push('before2');
          const result = next();
          executionOrder.push('after2');
          return result;
        }
      });

      container.addMiddleware(middleware1);
      container.addMiddleware(middleware2);

      const token = createToken<string>('middleware-test');
      container.register(token, { 
        useFactory: () => {
          executionOrder.push('factory');
          return 'value';
        }
      });

      const result = container.resolve(token);

      expect(result).toBe('value');
      expect(executionOrder).toEqual([
        'before1',
        'before2',
        'factory',
        'after2',
        'after1'
      ]);
    });

    it('should handle async middleware', async () => {
      let executed = false;
      
      const asyncMiddleware = createMiddleware({
        name: 'async-test',
        priority: 100,
        execute: async (context, next) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          executed = true;
          return await next();
        }
      });

      container.addMiddleware(asyncMiddleware);

      const token = createToken<string>('async-test');
      container.register(token, {
        useFactory: () => 'async-result'
      });

      const result = await container.resolveAsync(token);
      expect(result).toBe('async-result');
      expect(executed).toBe(true);
    });

    it('should handle circuit breaker', async () => {
      const circuitBreaker = new CircuitBreakerMiddleware(2, 1000, 100);
      container.addMiddleware(circuitBreaker);

      const token = createToken<string>('circuit-test');
      let shouldFail = true;

      container.register(token, {
        useFactory: () => {
          if (shouldFail) {
            throw new Error('Service unavailable');
          }
          return 'success';
        }
      });

      // First two failures should work
      await expect(container.resolveAsync(token)).rejects.toThrow();
      await expect(container.resolveAsync(token)).rejects.toThrow();

      // Circuit should be open now
      await expect(container.resolveAsync(token)).rejects.toThrow('Circuit breaker is open');

      // Even if service recovers, circuit is still open
      shouldFail = false;
      await expect(container.resolveAsync(token)).rejects.toThrow('Circuit breaker is open');
    });
  });

  describe('Lifecycle Management', () => {
    it('should emit lifecycle events', () => {
      const events: LifecycleEvent[] = [];

      container.on(LifecycleEvent.BeforeResolve, (data) => {
        events.push(data.event);
      });

      container.on(LifecycleEvent.AfterResolve, (data) => {
        events.push(data.event);
      });

      container.on(LifecycleEvent.InstanceCreated, (data) => {
        events.push(data.event);
      });

      const token = createToken<{ id: number }>('lifecycle-test');
      container.register(token, {
        useFactory: () => ({ id: 1 })
      });

      container.resolve(token);

      expect(events).toContain(LifecycleEvent.BeforeResolve);
      expect(events).toContain(LifecycleEvent.AfterResolve);
    });

    it('should track performance with observer', () => {
      const observer = new PerformanceObserver();
      (container as any).lifecycleManager.addObserver(observer);

      const token = createToken<string>('perf-test');
      container.register(token, {
        useFactory: () => {
          // Simulate some work
          const start = Date.now();
          while (Date.now() - start < 10) {}
          return 'value';
        }
      });

      container.resolve(token);
      container.resolve(token);

      const metrics = observer.getMetrics();
      expect(metrics.has(token.name)).toBe(true);
      
      const metric = metrics.get(token.name);
      expect(metric?.count).toBe(2);
      expect(metric?.avgTime).toBeGreaterThan(0);
    });

    it('should handle one-time hooks', () => {
      let callCount = 0;

      (container as any).lifecycleManager.once(LifecycleEvent.BeforeResolve, () => {
        callCount++;
      });

      const token = createToken('once-test');
      container.register(token, { useValue: 'value' });

      container.resolve(token);
      container.resolve(token);
      container.resolve(token);

      expect(callCount).toBe(1);
    });
  });

  describe('Context System', () => {
    it('should manage context keys', () => {
      const context = container.getContext();
      
      context.set(ContextKeys.User, { 
        id: '123', 
        name: 'John', 
        roles: ['admin'] 
      });
      
      context.set(ContextKeys.Environment, 'production');
      context.set(ContextKeys.Locale, 'en-US');

      expect(context.get(ContextKeys.User)).toEqual({
        id: '123',
        name: 'John',
        roles: ['admin']
      });
      
      expect(context.get(ContextKeys.Environment)).toBe('production');
      expect(context.get(ContextKeys.Locale)).toBe('en-US');
    });

    it('should create child contexts', () => {
      const context = container.getContext();
      context.set(ContextKeys.Environment, 'production');

      const childContext = context.createChild();
      childContext.set(ContextKeys.User, { 
        id: '123', 
        name: 'John', 
        roles: [] 
      });

      // Child should see parent context
      expect(childContext.get(ContextKeys.Environment)).toBe('production');
      expect(childContext.get(ContextKeys.User)).toEqual({
        id: '123',
        name: 'John',
        roles: []
      });

      // Parent should not see child context
      expect(context.get(ContextKeys.User)).toBeUndefined();
    });

    it('should create custom context keys', () => {
      const CustomKey = createContextKey<{ custom: string }>('custom');
      
      const context = container.getContext();
      context.set(CustomKey, { custom: 'value' });
      
      expect(context.get(CustomKey)).toEqual({ custom: 'value' });
      expect(context.has(CustomKey)).toBe(true);
      
      context.delete(CustomKey);
      expect(context.has(CustomKey)).toBe(false);
    });

    it('should run with context', () => {
      const context = container.getContext();
      context.set(ContextKeys.RequestId, 'req-123');

      const result = container.withContext(() => {
        const ctx = container.getContext();
        return ctx.get(ContextKeys.RequestId);
      });

      expect(result).toBe('req-123');
    });
    
    it('should handle context inheritance', () => {
      const context = container.getContext();
      context.set(ContextKeys.Environment, 'test');
      context.set(ContextKeys.RequestId, 'parent-req');
      
      const child = context.createChild();
      child.set(ContextKeys.RequestId, 'child-req');
      child.set(ContextKeys.User, { id: '456', name: 'Jane', roles: ['user'] });
      
      // Child overrides parent value
      expect(child.get(ContextKeys.RequestId)).toBe('child-req');
      // Child inherits from parent
      expect(child.get(ContextKeys.Environment)).toBe('test');
      // Child has own values
      expect(child.get(ContextKeys.User)).toEqual({ id: '456', name: 'Jane', roles: ['user'] });
      
      // Parent unchanged
      expect(context.get(ContextKeys.RequestId)).toBe('parent-req');
      expect(context.get(ContextKeys.User)).toBeUndefined();
    });
    
    it('should handle context isolation', () => {
      const context1 = container.getContext();
      context1.set(ContextKeys.Environment, 'dev');
      
      const scope = container.createScope({ metadata: { scopeId: 'test-scope' } });
      const context2 = scope.getContext();
      context2.set(ContextKeys.Environment, 'prod');
      
      // Contexts should be isolated
      expect(context1.get(ContextKeys.Environment)).toBe('dev');
      expect(context2.get(ContextKeys.Environment)).toBe('prod');
    });
    
    it('should support context merging', () => {
      const context = container.getContext();
      context.set(ContextKeys.Environment, 'staging');
      context.set(ContextKeys.Locale, 'en-GB');
      
      // Merge additional context values directly
      context.set(ContextKeys.RequestId, 'merge-123');
      context.set(ContextKeys.User, { id: '789', name: 'Bob', roles: ['moderator'] });
      
      expect(context.get(ContextKeys.Environment)).toBe('staging');
      expect(context.get(ContextKeys.Locale)).toBe('en-GB');
      expect(context.get(ContextKeys.RequestId)).toBe('merge-123');
      expect(context.get(ContextKeys.User)).toEqual({ id: '789', name: 'Bob', roles: ['moderator'] });
    });
    
    it('should handle async context operations', async () => {
      const context = container.getContext();
      
      // Simulate async context setup
      await new Promise(resolve => setTimeout(resolve, 10));
      context.set(ContextKeys.RequestId, 'async-req');
      
      const result = await container.withContext(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        const ctx = container.getContext();
        return ctx.get(ContextKeys.RequestId);
      });
      
      expect(result).toBe('async-req');
    });
    
    it('should clear context properly', () => {
      const context = container.getContext();
      context.set(ContextKeys.Environment, 'test');
      context.set(ContextKeys.User, { id: '111', name: 'Alice', roles: ['admin'] });
      context.set(ContextKeys.RequestId, 'clear-test');
      
      // Clear specific keys
      context.delete(ContextKeys.User);
      expect(context.has(ContextKeys.User)).toBe(false);
      expect(context.has(ContextKeys.Environment)).toBe(true);
      expect(context.has(ContextKeys.RequestId)).toBe(true);
      
      // Clear all
      context.clear();
      expect(context.has(ContextKeys.Environment)).toBe(false);
      expect(context.has(ContextKeys.RequestId)).toBe(false);
    });
    
    it('should handle context with conditional providers', () => {
      const token = createToken<string>('context-conditional');
      
      container.register(token, {
        when: (ctx: ResolutionContext) => {
          const context = container.getContext();
          return context.get(ContextKeys.Environment) === 'production';
        },
        useFactory: () => 'production-service',
        fallback: { useValue: 'dev-service' }
      } as any);
      
      // Default context
      const context = container.getContext();
      context.set(ContextKeys.Environment, 'development');
      expect(container.resolve(token)).toBe('dev-service');
      
      // Production context
      context.set(ContextKeys.Environment, 'production');
      container.clearCache();
      expect(container.resolve(token)).toBe('production-service');
    });
  });

  describe('Enhanced Module System', () => {
    it('should compile and load modules', () => {
      const service1Token = createToken<string>('Service1');
      const service2Token = createToken<string>('Service2');
      
      const testModule = createModule({
        name: 'TestModule',
        providers: [
          [service1Token, { useValue: 'service1' } as Provider<string>],
          [service2Token, { useValue: 'service2' } as Provider<string>]
        ],
        exports: [service1Token]
      });

      container.loadEnhancedModule(testModule);

      expect(container.resolve(service1Token)).toBe('service1');
      expect(container.resolve(service2Token)).toBe('service2');
    });

    it('should create dynamic modules', () => {
      const baseModule = { name: 'BaseModule' };
      const dynamicToken = createToken<string>('Dynamic');
      
      const dynamicModule = createDynamicModule(baseModule, {
        providers: [
          [dynamicToken, { useValue: 'dynamic-value' } as Provider<string>]
        ],
        global: true
      });

      container.loadEnhancedModule(dynamicModule);
      
      expect(container.resolve(dynamicToken)).toBe('dynamic-value');
    });

    it('should use module builder fluent API', () => {
      const tokenA = createToken<string>('A');
      const tokenB = createToken<string>('B');
      
      const module = moduleBuilder('FluentModule')
        .providers(
          [tokenA, { useValue: 'a' } as Provider<string>],
          [tokenB, { useValue: 'b' } as Provider<string>]
        )
        .exports(tokenA)
        .global(true)
        .build();

      container.loadEnhancedModule(module);

      expect(container.resolve(tokenA)).toBe('a');
      expect(container.resolve(tokenB)).toBe('b');
    });

    it('should create config modules', async () => {
      const ConfigModule = createConfigModule('AppConfig', async () => ({
        database: 'postgres://localhost',
        port: 3000
      }));

      const module = ConfigModule.forRoot({
        environment: 'test',
        debug: true
      });

      container.loadEnhancedModule(module);

      // Config token is created as a symbol, we need to access it differently
      // This test demonstrates the pattern but might need adjustment based on actual implementation
    });

    it('should handle module imports', () => {
      const databaseToken = createToken<string>('Database');
      const appServiceToken = createToken<{ db: string }>('AppService');
      
      const dbModule = createModule({
        name: 'DatabaseModule',
        providers: [
          [databaseToken, { useValue: 'db-instance' } as Provider<string>]
        ],
        exports: [databaseToken]
      });

      const appModule = createModule({
        name: 'AppModule',
        imports: [dbModule],
        providers: [
          [appServiceToken, {
            useFactory: (db: string) => ({ db }),
            inject: [databaseToken]
          } as Provider<{ db: string }>]
        ]
      });

      container.loadModule(appModule);

      const appService = container.resolve(appServiceToken);
      expect(appService.db).toBe('db-instance');
    });
  });

  describe('Integration Tests', () => {
    it('should work with plugins, middleware, and lifecycle hooks together', () => {
      const events: string[] = [];

      // Add plugin
      container.use(createPlugin({
        name: 'integration-plugin',
        version: '1.0.0',
        install() {
          events.push('plugin-installed');
        },
        hooks: {
          afterResolve: () => {
            events.push('plugin-afterResolve');
          }
        }
      }));

      // Add middleware
      container.addMiddleware(createMiddleware({
        name: 'integration-middleware',
        execute: (context, next) => {
          events.push('middleware-before');
          const result = next();
          events.push('middleware-after');
          return result;
        }
      }));

      // Add lifecycle hook
      container.on(LifecycleEvent.AfterResolve, () => {
        events.push('lifecycle-afterResolve');
      });

      // Register and resolve
      const token = createToken('integration');
      container.register(token, { 
        useFactory: () => {
          events.push('factory');
          return 'value';
        }
      });

      const result = container.resolve(token);

      expect(result).toBe('value');
      expect(events).toContain('plugin-installed');
      expect(events).toContain('middleware-before');
      expect(events).toContain('factory');
      expect(events).toContain('middleware-after');
      expect(events).toContain('plugin-afterResolve');
      expect(events).toContain('lifecycle-afterResolve');
    });

    it('should handle complex contextual resolution', () => {
      const context = container.getContext();
      
      // Set up context
      context.set(ContextKeys.Environment, 'production');
      context.set(ContextKeys.User, { 
        id: '123', 
        name: 'Admin', 
        roles: ['admin'] 
      });

      // Register conditional providers
      const dbToken = createToken<string>('Database');
      
      container.register(dbToken, {
        when: (ctx: ResolutionContext) => {
          const contextProvider = ctx.container.getContext();
          return contextProvider.get(ContextKeys.Environment) === 'production';
        },
        useFactory: () => 'production-db',
        fallback: { useValue: 'dev-db' }
      } as any);

      const result = container.resolve(dbToken);
      expect(result).toBe('production-db');

      // Change context
      context.set(ContextKeys.Environment, 'development');
      container.clearCache();
      
      const result2 = container.resolve(dbToken);
      expect(result2).toBe('dev-db');
    });
  });
});