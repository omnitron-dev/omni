/**
 * Plugin and Middleware System Tests
 * Tests for plugin installation, middleware composition, and interceptors
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import {
  Container,
  createToken,
  createPlugin,
  createMiddleware,
  Plugin,
  Middleware,
  MiddlewareContext,
  ResolutionContext,
  LoggingPlugin,
  MetricsPlugin,
  PerformancePlugin,
  ValidationPlugin,
  CachingPlugin,
  LoggingMiddleware,
  RetryMiddlewareClass,
  CircuitBreakerMiddleware,
  CacheMiddleware,
  ValidationMiddlewareClass
} from '../../../src/nexus/index.js';

describe('Plugin System', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Plugin Installation', () => {
    it('should install a basic plugin', () => {
      const installed = jest.fn();

      const plugin = createPlugin({
        name: 'TestPlugin',
        version: '1.0.0',
        install: (container) => {
          installed(container);
        }
      });

      container.use(plugin);
      expect(installed).toHaveBeenCalledWith(container);
    });

    it('should prevent duplicate plugin installation', () => {
      const plugin = createPlugin({
        name: 'UniquePlugin',
        version: '1.0.0',
        install: jest.fn()
      });

      container.use(plugin);
      expect(() => container.use(plugin)).toThrow('Plugin UniquePlugin is already installed');
    });

    it('should check plugin compatibility', () => {
      const plugin = createPlugin({
        name: 'IncompatiblePlugin',
        version: '1.0.0',
        requires: { nexus: '^3.0.0' }, // Incompatible version
        install: jest.fn()
      });

      expect(() => container.use(plugin)).toThrow('Plugin IncompatiblePlugin requires');
    });

    it('should install plugins with dependencies', () => {
      const basePlugin = createPlugin({
        name: 'BasePlugin',
        version: '1.0.0',
        install: jest.fn()
      });

      const dependentPlugin = createPlugin({
        name: 'DependentPlugin',
        version: '1.0.0',
        dependencies: ['BasePlugin'],
        install: jest.fn()
      });

      // Should fail without base plugin
      expect(() => container.use(dependentPlugin)).toThrow('Plugin DependentPlugin depends on BasePlugin');

      // Should work with base plugin
      container.use(basePlugin);
      container.use(dependentPlugin);

      expect(container.hasPlugin('BasePlugin')).toBe(true);
      expect(container.hasPlugin('DependentPlugin')).toBe(true);
    });
  });

  describe('Plugin Hooks', () => {
    it('should register and execute hooks', () => {
      const beforeResolve = jest.fn();
      const afterResolve = jest.fn();

      const plugin = createPlugin({
        name: 'HookPlugin',
        version: '1.0.0',
        install: (container) => {
          container.addHook('beforeResolve', beforeResolve);
          container.addHook('afterResolve', afterResolve);
        }
      });

      container.use(plugin);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      const result = container.resolve(token);

      expect(beforeResolve).toHaveBeenCalledWith(token, expect.any(Object));
      expect(afterResolve).toHaveBeenCalledWith(token, result, expect.any(Object));
    });

    it('should handle async hooks', async () => {
      const asyncHook = jest.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
      });

      const plugin = createPlugin({
        name: 'AsyncHookPlugin',
        version: '1.0.0',
        install: (container) => {
          container.addHook('beforeResolve', asyncHook);
        }
      });

      container.use(plugin);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      await container.resolveAsync(token);
      expect(asyncHook).toHaveBeenCalled();
    });

    it('should allow hook modification of resolution', () => {
      const plugin = createPlugin({
        name: 'ModifyingPlugin',
        version: '1.0.0',
        install: (container) => {
          container.addHook('afterResolve', (token, instance, context) => {
            if (typeof instance === 'string') {
              return instance.toUpperCase();
            }
            return instance;
          });
        }
      });

      container.use(plugin);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'lowercase' });

      const result = container.resolve(token);
      expect(result).toBe('LOWERCASE');
    });
  });

  describe('Built-in Plugins', () => {
    it('should use LoggingPlugin', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      container.use(LoggingPlugin({ level: 'debug' }));

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should use MetricsPlugin', () => {
      const metricsPlugin = MetricsPlugin();
      container.use(metricsPlugin);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      // Resolve multiple times
      for (let i = 0; i < 5; i++) {
        container.resolve(token);
      }

      const metrics = metricsPlugin.getMetrics();
      expect(metrics.resolutionCounts[token.name]).toBe(5);
    });

    it('should use PerformancePlugin', () => {
      const perfPlugin = PerformancePlugin({ threshold: 10 });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      container.use(perfPlugin);

      const token = createToken<string>('SlowService');
      container.register(token, {
        useFactory: () => {
          // Simulate slow initialization
          const start = Date.now();
          while (Date.now() - start < 15) {
            // Busy wait
          }
          return 'slow';
        }
      });

      container.resolve(token);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('SlowService took'));
      warnSpy.mockRestore();
    });

    it('should use ValidationPlugin', () => {
      interface User {
        name: string;
        age: number;
      }

      const validateUser = (user: User) => {
        if (!user.name || user.name.length < 3) {
          throw new Error('Name must be at least 3 characters');
        }
        if (user.age < 0 || user.age > 150) {
          throw new Error('Invalid age');
        }
      };

      container.use(ValidationPlugin());

      const token = createToken<User>('User');
      container.register(token, {
        useValue: { name: 'ab', age: 30 }, // Invalid name
        validate: validateUser
      });

      expect(() => container.resolve(token)).toThrow('Name must be at least 3 characters');
    });

    it('should use CachingPlugin', () => {
      let counter = 0;
      const cachingPlugin = CachingPlugin({ ttl: 100 });

      container.use(cachingPlugin);

      const token = createToken<number>('Cached');
      container.register(token, {
        useFactory: () => ++counter,
        scope: 'singleton' // Use singleton scope for caching behavior
      });

      const first = container.resolve(token);
      const second = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(1); // Cached
      expect(counter).toBe(1); // Factory called only once
    });
  });
});

describe('Middleware System', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Middleware Creation and Execution', () => {
    it('should create and apply middleware', async () => {
      const beforeExecute = jest.fn();
      const afterExecute = jest.fn();

      const middleware = createMiddleware({
        name: 'TestMiddleware',
        execute(context, next) {
          beforeExecute(context);
          const result = next();
          afterExecute(result);
          return result;
        }
      });

      container.addMiddleware(middleware);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      const result = container.resolve(token);

      expect(beforeExecute).toHaveBeenCalled();
      expect(afterExecute).toHaveBeenCalledWith('test');
      expect(result).toBe('test');
    });

    it('should compose multiple middleware', () => {
      const executionOrder: string[] = [];

      const middleware1 = createMiddleware({
        name: 'First',
        execute(context, next) {
          executionOrder.push('first-before');
          const result = next();
          executionOrder.push('first-after');
          return result;
        }
      });

      const middleware2 = createMiddleware({
        name: 'Second',
        execute(context, next) {
          executionOrder.push('second-before');
          const result = next();
          executionOrder.push('second-after');
          return result;
        }
      });

      container.addMiddleware(middleware1);
      container.addMiddleware(middleware2);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(executionOrder).toEqual([
        'first-before',
        'second-before',
        'second-after',
        'first-after'
      ]);
    });

    it('should allow middleware to modify result', async () => {
      const transformMiddleware = createMiddleware({
        name: 'Transform',
        async execute(context, next) {
          const result = await next();
          if (typeof result === 'string') {
            return result.toUpperCase();
          }
          return result;
        }
      });

      container.addMiddleware(transformMiddleware);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'lowercase' });

      const result = await container.resolveAsync(token);
      expect(result).toBe('LOWERCASE');
    });

    it('should handle middleware errors', async () => {
      const errorMiddleware = createMiddleware({
        name: 'Error',
        async execute(context, next) {
          throw new Error('Middleware error');
        }
      });

      container.addMiddleware(errorMiddleware);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      await expect(container.resolveAsync(token)).rejects.toThrow('Middleware error');
    });
  });

  describe('Built-in Middleware', () => {
    it('should use LoggingMiddleware', () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation();

      container.addMiddleware(LoggingMiddleware);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Test'));
      logSpy.mockRestore();
    });

    it('should use RetryMiddleware', async () => {
      let attempts = 0;
      const retryMiddleware = new RetryMiddlewareClass({
        maxAttempts: 3,
        delay: 10
      });

      container.addMiddleware(retryMiddleware);

      const token = createToken<string>('Flaky');
      container.register(token, {
        useFactory: () => {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return 'success';
        }
      });

      const result = await container.resolveAsync(token);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should use CircuitBreakerMiddleware', () => {
      const circuitBreaker = new CircuitBreakerMiddleware({
        threshold: 2,
        resetTimeout: 100
      });

      container.addMiddleware(circuitBreaker);

      const token = createToken<string>('Unreliable');
      let shouldFail = true;

      container.register(token, {
        useFactory: () => {
          if (shouldFail) {
            throw new Error('Service unavailable');
          }
          return 'success';
        }
      });

      // First two attempts should fail and open the circuit
      expect(() => container.resolve(token)).toThrow();
      expect(() => container.resolve(token)).toThrow();

      // Circuit should be open now
      expect(() => container.resolve(token)).toThrow('Circuit breaker is open');

      // Fix the service
      shouldFail = false;

      // Wait for reset timeout
      setTimeout(() => {
        const result = container.resolve(token);
        expect(result).toBe('success');
      }, 150);
    });

    it('should use CacheMiddleware', () => {
      let counter = 0;
      const cacheMiddleware = new CacheMiddleware({
        ttl: 100,
        keyGenerator: (context) => context.token.name
      });

      container.addMiddleware(cacheMiddleware);

      const token = createToken<number>('Cached');
      container.register(token, {
        useFactory: () => ++counter
      });

      const first = container.resolve(token);
      const second = container.resolve(token);
      const third = container.resolve(token);

      expect(first).toBe(1);
      expect(second).toBe(1); // From cache
      expect(third).toBe(1); // From cache
      expect(counter).toBe(1);
    });

    it('should use ValidationMiddleware', () => {
      const validationMiddleware = new ValidationMiddlewareClass({
        validators: {
          email: (value: string) => {
            if (!value.includes('@')) {
              throw new Error('Invalid email');
            }
          },
          age: (value: number) => {
            if (value < 0 || value > 150) {
              throw new Error('Invalid age');
            }
          }
        }
      });

      container.addMiddleware(validationMiddleware);

      const emailToken = createToken<string>('Email');
      container.register(emailToken, {
        useValue: 'invalid-email',
        validate: 'email'
      });

      expect(() => container.resolve(emailToken)).toThrow('Invalid email');

      const ageToken = createToken<number>('Age');
      container.register(ageToken, {
        useValue: 200,
        validate: 'age'
      });

      expect(() => container.resolve(ageToken)).toThrow('Invalid age');
    });
  });

  describe('Middleware Context', () => {
    it('should provide context to middleware', () => {
      let capturedContext: MiddlewareContext | null = null;

      const contextMiddleware = createMiddleware({
        name: 'ContextCapture',
        execute(context, next) {
          capturedContext = context;
          return next();
        }
      });

      container.addMiddleware(contextMiddleware);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.token).toBe(token);
      expect(capturedContext?.container).toBe(container);
      expect(capturedContext?.metadata).toBeDefined();
    });

    it('should allow middleware to modify context', () => {
      const enrichMiddleware = createMiddleware({
        name: 'Enrich',
        execute(context, next) {
          context.metadata.enriched = true;
          context.metadata.timestamp = Date.now();
          return next();
        }
      });

      const validateMiddleware = createMiddleware({
        name: 'Validate',
        execute(context, next) {
          if (!context.metadata.enriched) {
            throw new Error('Context not enriched');
          }
          return next();
        }
      });

      container.addMiddleware(enrichMiddleware);
      container.addMiddleware(validateMiddleware);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });

      expect(() => container.resolve(token)).not.toThrow();
    });
  });

  describe('Conditional Middleware', () => {
    it('should apply middleware conditionally', () => {
      const conditionalMiddleware = createMiddleware({
        name: 'Conditional',
        condition: (context) => context.token.name.startsWith('Special'),
        execute(context, next) {
          const result = next();
          return `[SPECIAL] ${result}`;
        }
      });

      container.addMiddleware(conditionalMiddleware);

      const specialToken = createToken<string>('SpecialService');
      const normalToken = createToken<string>('NormalService');

      container.register(specialToken, { useValue: 'special' });
      container.register(normalToken, { useValue: 'normal' });

      expect(container.resolve(specialToken)).toBe('[SPECIAL] special');
      expect(container.resolve(normalToken)).toBe('normal');
    });
  });

  describe('Middleware Priority', () => {
    it('should execute middleware in priority order', () => {
      const executionOrder: string[] = [];

      const highPriority = createMiddleware({
        name: 'High',
        priority: 100,
        execute(context, next) {
          executionOrder.push('high');
          return next();
        }
      });

      const lowPriority = createMiddleware({
        name: 'Low',
        priority: 1,
        execute(context, next) {
          executionOrder.push('low');
          return next();
        }
      });

      const mediumPriority = createMiddleware({
        name: 'Medium',
        priority: 50,
        execute(context, next) {
          executionOrder.push('medium');
          return next();
        }
      });

      // Add in random order
      container.addMiddleware(lowPriority);
      container.addMiddleware(highPriority);
      container.addMiddleware(mediumPriority);

      const token = createToken<string>('Test');
      container.register(token, { useValue: 'test' });
      container.resolve(token);

      expect(executionOrder).toEqual(['high', 'medium', 'low']);
    });
  });
});
