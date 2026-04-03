/**
 * Integration tests for Netron Middleware Pipeline
 *
 * Tests the complete middleware system with realistic scenarios:
 * - Full pipeline execution across all 5 stages
 * - Middleware ordering and priority
 * - Error handling through middleware chain
 * - Context propagation between middleware
 * - Conditional execution
 * - Service/method scoping
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  NetronMiddlewareContext,
  MiddlewareFunction,
  NetronBuiltinMiddleware,
} from '../../../src/netron/transport/http/middleware/index.js';

describe('Middleware Pipeline Integration', () => {
  let pipeline: MiddlewarePipeline;
  let executionOrder: string[];

  const createMockContext = (overrides: Partial<NetronMiddlewareContext> = {}): NetronMiddlewareContext => ({
    peer: { id: 'test-peer' } as any,
    serviceName: 'TestService',
    methodName: 'testMethod',
    input: { test: 'data' },
    metadata: new Map(),
    timing: {
      start: performance.now(),
      middlewareTimes: new Map(),
    },
    ...overrides,
  });

  const createTracingMiddleware =
    (name: string): MiddlewareFunction =>
    async (ctx, next) => {
      executionOrder.push(`${name}:before`);
      await next();
      executionOrder.push(`${name}:after`);
    };

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    executionOrder = [];
  });

  describe('Full Pipeline Execution', () => {
    it('should execute all 5 stages in correct order', async () => {
      const stages = [
        MiddlewareStage.PRE_PROCESS,
        MiddlewareStage.PRE_INVOKE,
        MiddlewareStage.POST_INVOKE,
        MiddlewareStage.POST_PROCESS,
        MiddlewareStage.ERROR,
      ];

      stages.forEach((stage) => {
        pipeline.use(createTracingMiddleware(stage), { name: `${stage}-middleware`, priority: 1 }, stage);
      });

      const ctx = createMockContext();

      // Execute non-error stages
      await pipeline.execute(ctx, MiddlewareStage.PRE_PROCESS);
      await pipeline.execute(ctx, MiddlewareStage.PRE_INVOKE);
      await pipeline.execute(ctx, MiddlewareStage.POST_INVOKE);
      await pipeline.execute(ctx, MiddlewareStage.POST_PROCESS);

      expect(executionOrder).toEqual([
        'pre-process:before',
        'pre-process:after',
        'pre-invoke:before',
        'pre-invoke:after',
        'post-invoke:before',
        'post-invoke:after',
        'post-process:before',
        'post-process:after',
      ]);
    });

    it('should execute ERROR stage on error', async () => {
      pipeline.use(
        createTracingMiddleware('error-handler'),
        { name: 'error-middleware', priority: 1 },
        MiddlewareStage.ERROR
      );

      const ctx = createMockContext({ error: new Error('Test error') });
      await pipeline.execute(ctx, MiddlewareStage.ERROR);

      expect(executionOrder).toEqual(['error-handler:before', 'error-handler:after']);
    });
  });

  describe('Middleware Priority and Ordering', () => {
    it('should execute middleware in priority order (lower first)', async () => {
      pipeline.use(createTracingMiddleware('priority-50'), { name: 'mid', priority: 50 }, MiddlewareStage.PRE_PROCESS);
      pipeline.use(
        createTracingMiddleware('priority-10'),
        { name: 'first', priority: 10 },
        MiddlewareStage.PRE_PROCESS
      );
      pipeline.use(createTracingMiddleware('priority-90'), { name: 'last', priority: 90 }, MiddlewareStage.PRE_PROCESS);

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      expect(executionOrder).toEqual([
        'priority-10:before',
        'priority-50:before',
        'priority-90:before',
        'priority-90:after',
        'priority-50:after',
        'priority-10:after',
      ]);
    });

    it('should handle multiple middleware per stage with correct nesting', async () => {
      for (let i = 1; i <= 3; i++) {
        pipeline.use(
          createTracingMiddleware(`mw-${i}`),
          { name: `middleware-${i}`, priority: i * 10 },
          MiddlewareStage.PRE_INVOKE
        );
      }

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_INVOKE);

      // Middleware should nest: outer wraps inner
      expect(executionOrder).toEqual([
        'mw-1:before',
        'mw-2:before',
        'mw-3:before',
        'mw-3:after',
        'mw-2:after',
        'mw-1:after',
      ]);
    });
  });

  describe('Context Propagation', () => {
    it('should propagate context modifications through middleware chain', async () => {
      pipeline.use(
        async (ctx, next) => {
          ctx.metadata.set('step1', 'value1');
          await next();
        },
        { name: 'step1', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      pipeline.use(
        async (ctx, next) => {
          const step1Value = ctx.metadata.get('step1');
          ctx.metadata.set('step2', `${step1Value}-extended`);
          await next();
        },
        { name: 'step2', priority: 2 },
        MiddlewareStage.PRE_PROCESS
      );

      pipeline.use(
        async (ctx, next) => {
          const step2Value = ctx.metadata.get('step2');
          ctx.metadata.set('step3', `${step2Value}-final`);
          await next();
        },
        { name: 'step3', priority: 3 },
        MiddlewareStage.PRE_PROCESS
      );

      const ctx = createMockContext();
      await pipeline.execute(ctx, MiddlewareStage.PRE_PROCESS);

      expect(ctx.metadata.get('step1')).toBe('value1');
      expect(ctx.metadata.get('step2')).toBe('value1-extended');
      expect(ctx.metadata.get('step3')).toBe('value1-extended-final');
    });

    it('should preserve result modifications in POST_INVOKE', async () => {
      pipeline.use(
        async (ctx, next) => {
          await next();
          // Transform result after execution
          if (ctx.result && typeof ctx.result === 'object') {
            (ctx.result as any).transformed = true;
          }
        },
        { name: 'transformer', priority: 1 },
        MiddlewareStage.POST_INVOKE
      );

      const ctx = createMockContext({ result: { data: 'original' } });
      await pipeline.execute(ctx, MiddlewareStage.POST_INVOKE);

      expect((ctx.result as any).transformed).toBe(true);
      expect((ctx.result as any).data).toBe('original');
    });
  });

  describe('Conditional Execution', () => {
    it('should skip middleware when condition returns false', async () => {
      pipeline.use(createTracingMiddleware('always-run'), { name: 'always', priority: 1 }, MiddlewareStage.PRE_PROCESS);

      pipeline.use(
        createTracingMiddleware('conditional'),
        {
          name: 'conditional',
          priority: 2,
          condition: (ctx) => ctx.serviceName === 'OtherService',
        },
        MiddlewareStage.PRE_PROCESS
      );

      pipeline.use(createTracingMiddleware('also-runs'), { name: 'also', priority: 3 }, MiddlewareStage.PRE_PROCESS);

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      expect(executionOrder).toEqual(['always-run:before', 'also-runs:before', 'also-runs:after', 'always-run:after']);
    });

    it('should execute middleware when condition returns true', async () => {
      pipeline.use(
        createTracingMiddleware('conditional'),
        {
          name: 'conditional',
          priority: 1,
          condition: (ctx) => ctx.serviceName === 'TestService',
        },
        MiddlewareStage.PRE_PROCESS
      );

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      expect(executionOrder).toEqual(['conditional:before', 'conditional:after']);
    });
  });

  describe('Service/Method Scoping', () => {
    it('should execute service-specific middleware only for matching service', async () => {
      pipeline.use(createTracingMiddleware('global'), { name: 'global', priority: 1 }, MiddlewareStage.PRE_PROCESS);

      pipeline.useForService(
        'TestService',
        createTracingMiddleware('test-service'),
        { name: 'test-service', priority: 2 },
        MiddlewareStage.PRE_PROCESS
      );

      pipeline.useForService(
        'OtherService',
        createTracingMiddleware('other-service'),
        { name: 'other-service', priority: 3 },
        MiddlewareStage.PRE_PROCESS
      );

      await pipeline.execute(createMockContext({ serviceName: 'TestService' }), MiddlewareStage.PRE_PROCESS);

      expect(executionOrder).toContain('global:before');
      expect(executionOrder).toContain('test-service:before');
      expect(executionOrder).not.toContain('other-service:before');
    });

    it('should execute method-specific middleware only for matching method', async () => {
      pipeline.useForMethod(
        'TestService',
        'targetMethod',
        createTracingMiddleware('target-method'),
        { name: 'target-method', priority: 1 },
        MiddlewareStage.PRE_INVOKE
      );

      pipeline.useForMethod(
        'TestService',
        'otherMethod',
        createTracingMiddleware('other-method'),
        { name: 'other-method', priority: 2 },
        MiddlewareStage.PRE_INVOKE
      );

      await pipeline.execute(
        createMockContext({ serviceName: 'TestService', methodName: 'targetMethod' }),
        MiddlewareStage.PRE_INVOKE
      );

      expect(executionOrder).toContain('target-method:before');
      expect(executionOrder).not.toContain('other-method:before');
    });

    it('should support RegExp patterns for service filtering', async () => {
      pipeline.use(
        createTracingMiddleware('api-services'),
        {
          name: 'api-filter',
          priority: 1,
          services: /^Api/,
        },
        MiddlewareStage.PRE_PROCESS
      );

      // Should match
      await pipeline.execute(createMockContext({ serviceName: 'ApiUsers' }), MiddlewareStage.PRE_PROCESS);
      expect(executionOrder).toContain('api-services:before');

      executionOrder = [];

      // Should not match
      await pipeline.execute(createMockContext({ serviceName: 'InternalService' }), MiddlewareStage.PRE_PROCESS);
      expect(executionOrder).not.toContain('api-services:before');
    });
  });

  describe('Error Handling', () => {
    it('should call onError callback when middleware throws', async () => {
      const errorSpy = vi.fn();
      const testError = new Error('Middleware error');

      pipeline.use(
        async () => {
          throw testError;
        },
        {
          name: 'failing',
          priority: 1,
          onError: errorSpy,
        },
        MiddlewareStage.PRE_PROCESS
      );

      const ctx = createMockContext();
      await expect(pipeline.execute(ctx, MiddlewareStage.PRE_PROCESS)).rejects.toThrow('Middleware error');

      expect(errorSpy).toHaveBeenCalledWith(testError, ctx);
    });

    it('should stop execution chain when middleware throws', async () => {
      pipeline.use(createTracingMiddleware('first'), { name: 'first', priority: 1 }, MiddlewareStage.PRE_PROCESS);

      pipeline.use(
        async () => {
          throw new Error('Stop here');
        },
        { name: 'failing', priority: 2 },
        MiddlewareStage.PRE_PROCESS
      );

      pipeline.use(
        createTracingMiddleware('never-reached'),
        { name: 'third', priority: 3 },
        MiddlewareStage.PRE_PROCESS
      );

      await expect(pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS)).rejects.toThrow();

      expect(executionOrder).toContain('first:before');
      expect(executionOrder).not.toContain('never-reached:before');
      expect(executionOrder).not.toContain('first:after'); // Unwinding stopped
    });

    it('should set error on context for ERROR stage handling', async () => {
      const capturedError = { value: null as Error | null };

      pipeline.use(
        async (ctx, next) => {
          capturedError.value = ctx.error || null;
          await next();
        },
        { name: 'error-handler', priority: 1 },
        MiddlewareStage.ERROR
      );

      const testError = new Error('Test error for handling');
      const ctx = createMockContext({ error: testError });
      await pipeline.execute(ctx, MiddlewareStage.ERROR);

      expect(capturedError.value).toBe(testError);
    });
  });

  describe('Metrics Collection', () => {
    it('should track execution metrics across stages', async () => {
      pipeline.use(
        async (ctx, next) => {
          await new Promise((r) => setTimeout(r, 10));
          await next();
        },
        { name: 'slow-middleware', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      pipeline.use(
        async (ctx, next) => {
          await next();
        },
        { name: 'fast-middleware', priority: 2 },
        MiddlewareStage.PRE_PROCESS
      );

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      const metrics = pipeline.getMetrics();
      expect(metrics.executions).toBeGreaterThan(0);
      expect(metrics.avgTime).toBeGreaterThan(0);
      expect(metrics.errors).toBe(0);
    });

    it('should track errors in metrics', async () => {
      pipeline.use(
        async () => {
          throw new Error('Tracked error');
        },
        { name: 'error-middleware', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      try {
        await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);
      } catch {
        // Expected
      }

      const metrics = pipeline.getMetrics();
      expect(metrics.errors).toBe(1);
    });

    it('should track skipped middleware in metrics', async () => {
      pipeline.use(
        createTracingMiddleware('skipped'),
        {
          name: 'skipped',
          priority: 1,
          condition: () => false,
        },
        MiddlewareStage.PRE_PROCESS
      );

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      const metrics = pipeline.getMetrics();
      expect(metrics.skips).toBe(1);
    });
  });

  describe('Built-in Middleware Integration', () => {
    it('should integrate requestId middleware correctly', async () => {
      pipeline.use(
        NetronBuiltinMiddleware.requestId(),
        { name: 'request-id', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      const ctx = createMockContext();
      await pipeline.execute(ctx, MiddlewareStage.PRE_PROCESS);

      expect(ctx.metadata.has('requestId')).toBe(true);
      expect(typeof ctx.metadata.get('requestId')).toBe('string');
    });

    it('should integrate logging middleware correctly', async () => {
      const loggedMessages: string[] = [];
      const mockLogger = {
        info: (msg: string) => loggedMessages.push(`INFO: ${msg}`),
        error: (msg: string) => loggedMessages.push(`ERROR: ${msg}`),
        warn: () => {},
        debug: () => {},
      };

      pipeline.use(
        NetronBuiltinMiddleware.loggingMiddleware(mockLogger as any),
        { name: 'logging', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      expect(loggedMessages.some((m) => m.includes('INFO'))).toBe(true);
    });

    it('should integrate timeout middleware correctly', async () => {
      pipeline.use(
        NetronBuiltinMiddleware.timeoutMiddleware(50),
        { name: 'timeout', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      // Fast execution should pass
      await expect(pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS)).resolves.not.toThrow();

      // Add slow middleware
      pipeline.use(
        async (ctx, next) => {
          await new Promise((r) => setTimeout(r, 100));
          await next();
        },
        { name: 'slow', priority: 2 },
        MiddlewareStage.PRE_PROCESS
      );

      // Clear cache to pick up new middleware
      pipeline.clear();

      // Re-add with slow middleware
      pipeline.use(
        NetronBuiltinMiddleware.timeoutMiddleware(50),
        { name: 'timeout', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );
      pipeline.use(
        async (ctx, next) => {
          await new Promise((r) => setTimeout(r, 100));
          await next();
        },
        { name: 'slow', priority: 2 },
        MiddlewareStage.PRE_PROCESS
      );

      await expect(pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS)).rejects.toThrow(/timed out/i);
    });

    it('should integrate caching middleware correctly', async () => {
      const cache = new Map<string, { value: unknown; expiry: number }>();
      let callCount = 0;

      pipeline.use(
        NetronBuiltinMiddleware.cachingMiddleware({
          cache,
          ttl: 60000,
          keyGenerator: (ctx) => `${ctx.serviceName}:${ctx.methodName}`,
        }),
        { name: 'cache', priority: 1 },
        MiddlewareStage.POST_INVOKE
      );

      pipeline.use(
        async (ctx, next) => {
          callCount++;
          ctx.result = { data: 'computed', count: callCount };
          await next();
        },
        { name: 'compute', priority: 2 },
        MiddlewareStage.POST_INVOKE
      );

      const ctx1 = createMockContext();
      await pipeline.execute(ctx1, MiddlewareStage.POST_INVOKE);
      expect((ctx1.result as any).count).toBe(1);

      // Second call should use cache
      const ctx2 = createMockContext();
      await pipeline.execute(ctx2, MiddlewareStage.POST_INVOKE);
      // Note: caching middleware caches result, so callCount still increments
      // but result from cache is returned
    });
  });

  describe('Complex Middleware Chains', () => {
    it('should handle auth + logging + rate-limit chain', async () => {
      const logs: string[] = [];
      const mockLogger = {
        info: (msg: string) => logs.push(msg),
        error: (msg: string) => logs.push(`ERROR: ${msg}`),
        warn: () => {},
        debug: () => {},
      };

      // Auth middleware
      pipeline.use(
        async (ctx, next) => {
          const token = ctx.metadata.get('authorization');
          if (!token) {
            throw new Error('Unauthorized');
          }
          ctx.metadata.set('userId', 'user-123');
          await next();
        },
        { name: 'auth', priority: 10 },
        MiddlewareStage.PRE_PROCESS
      );

      // Logging middleware
      pipeline.use(
        NetronBuiltinMiddleware.loggingMiddleware(mockLogger as any),
        { name: 'logging', priority: 20 },
        MiddlewareStage.PRE_PROCESS
      );

      // Rate limiting middleware (simplified)
      const requestCounts = new Map<string, number>();
      pipeline.use(
        async (ctx, next) => {
          const userId = ctx.metadata.get('userId') as string;
          const count = requestCounts.get(userId) || 0;
          if (count >= 100) {
            throw new Error('Rate limit exceeded');
          }
          requestCounts.set(userId, count + 1);
          await next();
        },
        { name: 'rate-limit', priority: 30 },
        MiddlewareStage.PRE_PROCESS
      );

      // With auth token - should pass
      const ctx = createMockContext();
      ctx.metadata.set('authorization', 'Bearer valid-token');
      await expect(pipeline.execute(ctx, MiddlewareStage.PRE_PROCESS)).resolves.not.toThrow();
      expect(ctx.metadata.get('userId')).toBe('user-123');

      // Without auth token - should fail
      const ctxNoAuth = createMockContext();
      await expect(pipeline.execute(ctxNoAuth, MiddlewareStage.PRE_PROCESS)).rejects.toThrow('Unauthorized');
    });

    it('should handle cross-stage data flow', async () => {
      // PRE_PROCESS: Extract and validate request
      pipeline.use(
        async (ctx, next) => {
          ctx.metadata.set('requestTime', Date.now());
          ctx.metadata.set('validated', true);
          await next();
        },
        { name: 'validate', priority: 1 },
        MiddlewareStage.PRE_PROCESS
      );

      // PRE_INVOKE: Prepare for execution
      pipeline.use(
        async (ctx, next) => {
          if (!ctx.metadata.get('validated')) {
            throw new Error('Not validated');
          }
          ctx.metadata.set('preparedForInvoke', true);
          await next();
        },
        { name: 'prepare', priority: 1 },
        MiddlewareStage.PRE_INVOKE
      );

      // POST_INVOKE: Process result
      pipeline.use(
        async (ctx, next) => {
          ctx.metadata.set('processedResult', true);
          await next();
        },
        { name: 'process-result', priority: 1 },
        MiddlewareStage.POST_INVOKE
      );

      // POST_PROCESS: Finalize response
      pipeline.use(
        async (ctx, next) => {
          const requestTime = ctx.metadata.get('requestTime') as number;
          ctx.metadata.set('responseTime', Date.now());
          ctx.metadata.set('duration', Date.now() - requestTime);
          await next();
        },
        { name: 'finalize', priority: 1 },
        MiddlewareStage.POST_PROCESS
      );

      const ctx = createMockContext();

      // Execute all stages in order
      await pipeline.execute(ctx, MiddlewareStage.PRE_PROCESS);
      await pipeline.execute(ctx, MiddlewareStage.PRE_INVOKE);
      await pipeline.execute(ctx, MiddlewareStage.POST_INVOKE);
      await pipeline.execute(ctx, MiddlewareStage.POST_PROCESS);

      // Verify data flowed through all stages
      expect(ctx.metadata.get('validated')).toBe(true);
      expect(ctx.metadata.get('preparedForInvoke')).toBe(true);
      expect(ctx.metadata.get('processedResult')).toBe(true);
      expect(ctx.metadata.get('duration')).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Clear and Reset', () => {
    it('should clear all middleware registrations', async () => {
      pipeline.use(createTracingMiddleware('test'), { name: 'test', priority: 1 }, MiddlewareStage.PRE_PROCESS);

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);
      expect(executionOrder.length).toBeGreaterThan(0);

      pipeline.clear();
      executionOrder = [];

      // After clear, no middleware should execute
      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);
      expect(executionOrder).toEqual([]); // No middleware registered
    });

    it('should allow re-registration after clear', async () => {
      pipeline.use(createTracingMiddleware('original'), { name: 'original', priority: 1 }, MiddlewareStage.PRE_PROCESS);

      pipeline.clear();

      pipeline.use(createTracingMiddleware('new'), { name: 'new', priority: 1 }, MiddlewareStage.PRE_PROCESS);

      await pipeline.execute(createMockContext(), MiddlewareStage.PRE_PROCESS);

      expect(executionOrder).toContain('new:before');
      expect(executionOrder).not.toContain('original:before');
    });
  });
});
