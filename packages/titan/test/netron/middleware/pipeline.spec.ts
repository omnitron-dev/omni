/**
 * Comprehensive tests for Netron Middleware Pipeline
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  type NetronMiddlewareContext,
  type MiddlewareFunction,
  type MiddlewareConfig
} from '../../../src/netron/middleware/index.js';

describe('MiddlewarePipeline', () => {
  let pipeline: MiddlewarePipeline;
  let mockContext: NetronMiddlewareContext;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    mockContext = {
      peer: {} as any,
      serviceName: 'TestService',
      methodName: 'testMethod',
      metadata: new Map(),
      timing: {
        start: Date.now(),
        middlewareTimes: new Map()
      }
    };
  });

  describe('Middleware Registration', () => {
    it('should register global middleware', () => {
      const middleware: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });

      pipeline.use(middleware, { name: 'test-middleware' });

      const registered = pipeline.getMiddleware();
      expect(registered).toHaveLength(1);
      expect(registered[0].config.name).toBe('test-middleware');
    });

    it('should register middleware with specific stage', () => {
      const middleware: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });

      pipeline.use(middleware, { name: 'pre-process' }, MiddlewareStage.PRE_PROCESS);
      pipeline.use(middleware, { name: 'post-process' }, MiddlewareStage.POST_PROCESS);

      const preProcess = pipeline.getMiddleware(undefined, undefined, MiddlewareStage.PRE_PROCESS);
      const postProcess = pipeline.getMiddleware(undefined, undefined, MiddlewareStage.POST_PROCESS);

      expect(preProcess).toHaveLength(1);
      expect(preProcess[0].config.name).toBe('pre-process');
      expect(postProcess).toHaveLength(1);
      expect(postProcess[0].config.name).toBe('post-process');
    });

    it('should register service-specific middleware', () => {
      const middleware: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });

      pipeline.useForService('UserService', middleware, { name: 'user-middleware' });

      const registered = pipeline.getMiddleware('UserService');
      expect(registered).toHaveLength(1);
      expect(registered[0].config.name).toBe('user-middleware');

      const otherService = pipeline.getMiddleware('OtherService');
      expect(otherService).toHaveLength(0);
    });

    it('should register method-specific middleware', () => {
      const middleware: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });

      pipeline.useForMethod('UserService', 'getUser', middleware, { name: 'get-user-middleware' });

      const registered = pipeline.getMiddleware('UserService', 'getUser');
      expect(registered).toHaveLength(1);
      expect(registered[0].config.name).toBe('get-user-middleware');

      const otherMethod = pipeline.getMiddleware('UserService', 'createUser');
      expect(otherMethod).toHaveLength(0);
    });

    it('should sort middleware by priority', () => {
      const middleware1: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });
      const middleware2: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });
      const middleware3: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });

      pipeline.use(middleware1, { name: 'high', priority: 10 });
      pipeline.use(middleware2, { name: 'low', priority: 30 });
      pipeline.use(middleware3, { name: 'medium', priority: 20 });

      const registered = pipeline.getMiddleware();
      expect(registered[0].config.name).toBe('high');
      expect(registered[1].config.name).toBe('medium');
      expect(registered[2].config.name).toBe('low');
    });
  });

  describe('Middleware Execution', () => {
    it('should execute middleware in order', async () => {
      const executionOrder: string[] = [];

      const middleware1: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('middleware1-before');
        await next();
        executionOrder.push('middleware1-after');
      };

      const middleware2: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('middleware2-before');
        await next();
        executionOrder.push('middleware2-after');
      };

      pipeline.use(middleware1, { name: 'middleware1', priority: 1 });
      pipeline.use(middleware2, { name: 'middleware2', priority: 2 });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      expect(executionOrder).toEqual([
        'middleware1-before',
        'middleware2-before',
        'middleware2-after',
        'middleware1-after'
      ]);
    });

    it('should skip middleware based on condition', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'conditional',
        condition: (ctx) => ctx.serviceName === 'SkipService'
      });

      // Should skip
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);

      // Should execute
      mockContext.serviceName = 'SkipService';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);
    });

    it('should filter middleware by service name', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'service-filter',
        services: ['UserService', 'AuthService']
      });

      // Should not execute for TestService
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);

      // Should execute for UserService
      mockContext.serviceName = 'UserService';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);
    });

    it('should filter middleware by service regex', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'service-regex',
        services: /^User/
      });

      // Should not execute for TestService
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);

      // Should execute for UserService
      mockContext.serviceName = 'UserService';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);
    });

    it('should filter middleware by method name', async () => {
      const executionCount = { count: 0 };

      const middleware: MiddlewareFunction = async (ctx, next) => {
        executionCount.count++;
        await next();
      };

      pipeline.use(middleware, {
        name: 'method-filter',
        methods: ['getUser', 'getUsers']
      });

      // Should not execute for testMethod
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(0);

      // Should execute for getUser
      mockContext.methodName = 'getUser';
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      expect(executionCount.count).toBe(1);
    });

    it('should support skipRemaining flag', async () => {
      const executionOrder: string[] = [];

      const middleware1: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('middleware1');
        ctx.skipRemaining = true;
        await next();
      };

      const middleware2: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('middleware2');
        await next();
      };

      pipeline.use(middleware1, { name: 'middleware1', priority: 1 });
      pipeline.use(middleware2, { name: 'middleware2', priority: 2 });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      expect(executionOrder).toEqual(['middleware1']);
    });

    it('should handle middleware errors', async () => {
      const errorHandler = jest.fn();

      const middleware: MiddlewareFunction = async (ctx, next) => {
        throw new Error('Middleware error');
      };

      pipeline.use(middleware, {
        name: 'error-middleware',
        onError: errorHandler
      });

      await expect(
        pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE)
      ).rejects.toThrow('Middleware error');

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Middleware error' }),
        mockContext
      );
    });

    it('should track middleware execution time', async () => {
      const middleware: MiddlewareFunction = async (ctx, next) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        await next();
      };

      pipeline.use(middleware, { name: 'timed-middleware' });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      expect(mockContext.timing.middlewareTimes.has('timed-middleware')).toBe(true);
      const time = mockContext.timing.middlewareTimes.get('timed-middleware');
      expect(time).toBeGreaterThan(9);
    });
  });

  describe('Metrics', () => {
    it('should track execution metrics', async () => {
      const middleware: MiddlewareFunction = async (ctx, next) => {
        await next();
      };

      pipeline.use(middleware, { name: 'metrics-middleware' });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      const metrics = pipeline.getMetrics();
      expect(metrics.executions).toBe(2);
      expect(metrics.avgTime).toBeGreaterThan(0);
      expect(metrics.errors).toBe(0);
      expect(metrics.byMiddleware.has('metrics-middleware')).toBe(true);

      const middlewareMetrics = metrics.byMiddleware.get('metrics-middleware');
      expect(middlewareMetrics?.executions).toBe(2);
    });

    it('should track error metrics', async () => {
      const middleware: MiddlewareFunction = async (ctx, next) => {
        throw new Error('Test error');
      };

      pipeline.use(middleware, {
        name: 'error-middleware',
        onError: () => {} // Suppress error
      });

      try {
        await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      } catch (error) {
        // Expected
      }

      const metrics = pipeline.getMetrics();
      expect(metrics.errors).toBe(1);
      expect(metrics.byMiddleware.get('error-middleware')?.errors).toBe(1);
    });

    it('should track skip metrics', async () => {
      const middleware: MiddlewareFunction = async (ctx, next) => {
        await next();
      };

      pipeline.use(middleware, {
        name: 'skip-middleware',
        condition: () => false
      });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      const metrics = pipeline.getMetrics();
      expect(metrics.skips).toBe(1);
    });
  });

  describe('Clear', () => {
    it('should clear all middleware', () => {
      const middleware: MiddlewareFunction = jest.fn(async (ctx, next) => {
        await next();
      });

      pipeline.use(middleware, { name: 'test' });
      pipeline.useForService('Service', middleware);
      pipeline.useForMethod('Service', 'method', middleware);

      expect(pipeline.getMiddleware()).not.toHaveLength(0);

      pipeline.clear();

      expect(pipeline.getMiddleware()).toHaveLength(0);
      expect(pipeline.getMiddleware('Service')).toHaveLength(0);
      expect(pipeline.getMiddleware('Service', 'method')).toHaveLength(0);
    });

    it('should reset metrics on clear', async () => {
      const middleware: MiddlewareFunction = async (ctx, next) => {
        await next();
      };

      pipeline.use(middleware, { name: 'test' });
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      const metricsBefore = pipeline.getMetrics();
      expect(metricsBefore.executions).toBe(1);

      pipeline.clear();

      const metricsAfter = pipeline.getMetrics();
      expect(metricsAfter.executions).toBe(0);
      expect(metricsAfter.byMiddleware.size).toBe(0);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed global, service, and method middleware', async () => {
      const executionOrder: string[] = [];

      const globalMiddleware: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('global');
        await next();
      };

      const serviceMiddleware: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('service');
        await next();
      };

      const methodMiddleware: MiddlewareFunction = async (ctx, next) => {
        executionOrder.push('method');
        await next();
      };

      pipeline.use(globalMiddleware, { name: 'global', priority: 10 });
      pipeline.useForService('TestService', serviceMiddleware, { name: 'service', priority: 20 });
      pipeline.useForMethod('TestService', 'testMethod', methodMiddleware, { name: 'method', priority: 30 });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      expect(executionOrder).toEqual(['global', 'service', 'method']);
    });

    it('should handle multiple stages correctly', async () => {
      const stageExecutions: string[] = [];

      const preProcessMiddleware: MiddlewareFunction = async (ctx, next) => {
        stageExecutions.push('pre-process');
        await next();
      };

      const preInvokeMiddleware: MiddlewareFunction = async (ctx, next) => {
        stageExecutions.push('pre-invoke');
        await next();
      };

      const postInvokeMiddleware: MiddlewareFunction = async (ctx, next) => {
        stageExecutions.push('post-invoke');
        await next();
      };

      const errorMiddleware: MiddlewareFunction = async (ctx, next) => {
        stageExecutions.push('error');
        await next();
      };

      pipeline.use(preProcessMiddleware, { name: 'pre-process' }, MiddlewareStage.PRE_PROCESS);
      pipeline.use(preInvokeMiddleware, { name: 'pre-invoke' }, MiddlewareStage.PRE_INVOKE);
      pipeline.use(postInvokeMiddleware, { name: 'post-invoke' }, MiddlewareStage.POST_INVOKE);
      pipeline.use(errorMiddleware, { name: 'error' }, MiddlewareStage.ERROR);

      await pipeline.execute(mockContext, MiddlewareStage.PRE_PROCESS);
      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);
      await pipeline.execute(mockContext, MiddlewareStage.POST_INVOKE);
      await pipeline.execute(mockContext, MiddlewareStage.ERROR);

      expect(stageExecutions).toEqual(['pre-process', 'pre-invoke', 'post-invoke', 'error']);
    });

    it('should handle async middleware correctly', async () => {
      const results: number[] = [];

      const middleware1: MiddlewareFunction = async (ctx, next) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        results.push(1);
        await next();
        results.push(4);
      };

      const middleware2: MiddlewareFunction = async (ctx, next) => {
        results.push(2);
        await next();
        results.push(3);
      };

      pipeline.use(middleware1, { name: 'async1', priority: 1 });
      pipeline.use(middleware2, { name: 'async2', priority: 2 });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      expect(results).toEqual([1, 2, 3, 4]);
    });

    it('should handle context modifications', async () => {
      const middleware1: MiddlewareFunction = async (ctx, next) => {
        ctx.metadata.set('key1', 'value1');
        await next();
      };

      const middleware2: MiddlewareFunction = async (ctx, next) => {
        expect(ctx.metadata.get('key1')).toBe('value1');
        ctx.metadata.set('key2', 'value2');
        await next();
      };

      pipeline.use(middleware1, { name: 'context1', priority: 1 });
      pipeline.use(middleware2, { name: 'context2', priority: 2 });

      await pipeline.execute(mockContext, MiddlewareStage.PRE_INVOKE);

      expect(mockContext.metadata.get('key1')).toBe('value1');
      expect(mockContext.metadata.get('key2')).toBe('value2');
    });
  });
});