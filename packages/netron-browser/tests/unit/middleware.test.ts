/**
 * Middleware System Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  type ClientMiddlewareContext,
  createAuthMiddleware,
  SimpleTokenProvider,
  StorageTokenProvider,
  createLoggingMiddleware,
  ConsoleLogger,
  createTimingMiddleware,
  InMemoryMetricsCollector,
  createErrorTransformMiddleware,
  defaultErrorTransformer,
  CommonErrorMessages,
  isRetryableError,
  isClientError,
  isServerError,
} from '../../src/middleware/index.js';

describe('MiddlewarePipeline', () => {
  let pipeline: MiddlewarePipeline;
  let ctx: ClientMiddlewareContext;

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    ctx = {
      service: 'TestService',
      method: 'testMethod',
      args: [1, 2, 3],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };
  });

  describe('basic middleware execution', () => {
    it('should execute middleware in order', async () => {
      const order: number[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push(1);
          await next();
          order.push(4);
        },
        { name: 'middleware-1', priority: 1 }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push(2);
          await next();
          order.push(3);
        },
        { name: 'middleware-2', priority: 2 }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual([1, 2, 3, 4]);
    });

    it('should respect priority order', async () => {
      const order: string[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push('low');
          await next();
        },
        { name: 'low-priority', priority: 100 }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push('high');
          await next();
        },
        { name: 'high-priority', priority: 1 }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['high', 'low']);
    });

    it('should handle skipRemaining flag', async () => {
      const order: string[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push('first');
          ctx.skipRemaining = true;
          await next();
        },
        { name: 'first' }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push('second');
          await next();
        },
        { name: 'second' }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['first']);
    });

    it('should propagate errors', async () => {
      pipeline.use(async (ctx, next) => {
        throw new Error('Middleware error');
      });

      await expect(pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST)).rejects.toThrow('Middleware error');
    });
  });

  describe('service and method specific middleware', () => {
    it('should apply service-specific middleware', async () => {
      const order: string[] = [];

      pipeline.use(async (ctx, next) => {
        order.push('global');
        await next();
      });

      pipeline.useForService('TestService', async (ctx, next) => {
        order.push('service');
        await next();
      });

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['global', 'service']);
    });

    it('should apply method-specific middleware', async () => {
      const order: string[] = [];

      pipeline.use(async (ctx, next) => {
        order.push('global');
        await next();
      });

      pipeline.useForMethod('TestService', 'testMethod', async (ctx, next) => {
        order.push('method');
        await next();
      });

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['global', 'method']);
    });
  });

  describe('conditional middleware', () => {
    it('should skip middleware based on condition', async () => {
      const order: string[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push('always');
          await next();
        },
        { name: 'always' }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push('conditional');
          await next();
        },
        {
          name: 'conditional',
          condition: (ctx) => ctx.service === 'OtherService',
        }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['always']);
    });

    it('should filter by service pattern', async () => {
      const order: string[] = [];

      pipeline.use(
        async (ctx, next) => {
          order.push('matched');
          await next();
        },
        {
          name: 'matched',
          services: ['TestService'],
        }
      );

      pipeline.use(
        async (ctx, next) => {
          order.push('not-matched');
          await next();
        },
        {
          name: 'not-matched',
          services: ['OtherService'],
        }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      expect(order).toEqual(['matched']);
    });
  });

  describe('metrics', () => {
    it('should track execution metrics', async () => {
      pipeline.use(async (ctx, next) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await next();
      });

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      const metrics = pipeline.getMetrics();
      expect(metrics.executions).toBe(1);
      expect(metrics.avgTime).toBeGreaterThan(0);
      expect(metrics.errors).toBe(0);
    });

    it('should track per-middleware metrics', async () => {
      pipeline.use(
        async (ctx, next) => {
          await next();
        },
        { name: 'test-middleware' }
      );

      await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

      const metrics = pipeline.getMetrics();
      const middlewareMetrics = metrics.byMiddleware.get('test-middleware');

      expect(middlewareMetrics).toBeDefined();
      expect(middlewareMetrics!.executions).toBe(1);
      expect(middlewareMetrics!.avgTime).toBeGreaterThan(0);
    });
  });
});

describe('Auth Middleware', () => {
  it('should inject bearer token', async () => {
    const tokenProvider = new SimpleTokenProvider('test-token-123');
    const middleware = createAuthMiddleware({ tokenProvider });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await middleware(ctx, async () => {});

    expect(ctx.request?.headers?.['Authorization']).toBe('Bearer test-token-123');
  });

  it('should skip services in skip list', async () => {
    const tokenProvider = new SimpleTokenProvider('test-token');
    const middleware = createAuthMiddleware({
      tokenProvider,
      skipServices: ['TestService'],
    });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await middleware(ctx, async () => {});

    expect(ctx.request?.headers?.['Authorization']).toBeUndefined();
  });

  it('should use custom header name', async () => {
    const tokenProvider = new SimpleTokenProvider('test-token');
    const middleware = createAuthMiddleware({
      tokenProvider,
      headerName: 'X-Custom-Auth',
      tokenPrefix: 'Token ',
    });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await middleware(ctx, async () => {});

    expect(ctx.request?.headers?.['X-Custom-Auth']).toBe('Token test-token');
  });
});

describe('Logging Middleware', () => {
  it('should log request and response', async () => {
    const logs: any[] = [];
    const logger = {
      debug: vi.fn(),
      info: (msg: string, data: any) => logs.push({ level: 'info', msg, data }),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const middleware = createLoggingMiddleware({ logger });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [1, 2, 3],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await middleware(ctx, async () => {
      ctx.response = { data: 'result' };
    });

    expect(logs.length).toBe(2);
    expect(logs[0].msg).toBe('RPC Request');
    expect(logs[1].msg).toBe('RPC Response');
  });

  it('should log errors', async () => {
    const logs: any[] = [];
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: (msg: string, data: any) => logs.push({ level: 'error', msg, data }),
    };

    const middleware = createLoggingMiddleware({ logger });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await expect(
      middleware(ctx, async () => {
        throw new Error('Test error');
      })
    ).rejects.toThrow('Test error');

    expect(logs.length).toBe(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].msg).toBe('RPC Error');
  });
});

describe('Timing Middleware', () => {
  it('should measure request duration', async () => {
    const collector = new InMemoryMetricsCollector();
    const middleware = createTimingMiddleware({ collector });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await middleware(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    const metrics = collector.getMetrics();
    expect(metrics.length).toBe(1);
    expect(metrics[0].service).toBe('TestService');
    expect(metrics[0].method).toBe('testMethod');
    expect(metrics[0].duration).toBeGreaterThan(0);
  });

  it('should detect slow requests', async () => {
    const slowRequests: any[] = [];
    const middleware = createTimingMiddleware({
      slowThreshold: 5,
      onSlowRequest: (metrics) => slowRequests.push(metrics),
    });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await middleware(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(slowRequests.length).toBe(1);
  });

  it('should calculate average duration', async () => {
    const collector = new InMemoryMetricsCollector();
    const middleware = createTimingMiddleware({ collector });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    // Execute multiple times
    for (let i = 0; i < 3; i++) {
      await middleware({ ...ctx }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
    }

    const avgDuration = collector.getAverageDuration('TestService', 'testMethod');
    expect(avgDuration).toBeGreaterThan(0);
  });
});

describe('Error Transform Middleware', () => {
  it('should normalize errors', async () => {
    const middleware = createErrorTransformMiddleware();

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    const error = new Error('Test error');
    (error as any).code = 'BAD_REQUEST';

    await expect(
      middleware(ctx, async () => {
        throw error;
      })
    ).rejects.toThrow();

    const normalized = ctx.metadata.get('error:normalized');
    expect(normalized).toBeDefined();
    expect(normalized.code).toBe('BAD_REQUEST');
    expect(normalized.service).toBe('TestService');
    expect(normalized.method).toBe('testMethod');
  });

  it('should use custom error messages', async () => {
    const middleware = createErrorTransformMiddleware({
      errorMessages: CommonErrorMessages,
    });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    const error = new Error('Raw error');
    (error as any).code = 'UNAUTHORIZED';

    await expect(
      middleware(ctx, async () => {
        throw error;
      })
    ).rejects.toThrow();

    const normalized = ctx.metadata.get('error:normalized');
    expect(normalized.message).toBe('You are not authorized to perform this action');
  });

  it('should identify retryable errors', () => {
    expect(isRetryableError({ code: 'TIMEOUT' } as any)).toBe(true);
    expect(isRetryableError({ code: 'NETWORK_ERROR' } as any)).toBe(true);
    expect(isRetryableError({ code: 'BAD_REQUEST' } as any)).toBe(false);
  });

  it('should identify client errors', () => {
    expect(isClientError({ code: 'BAD_REQUEST' } as any)).toBe(true);
    expect(isClientError({ code: 'UNAUTHORIZED' } as any)).toBe(true);
    expect(isClientError({ code: 'INTERNAL_ERROR' } as any)).toBe(false);
  });

  it('should identify server errors', () => {
    expect(isServerError({ code: 'INTERNAL_ERROR' } as any)).toBe(true);
    expect(isServerError({ code: 'SERVICE_UNAVAILABLE' } as any)).toBe(true);
    expect(isServerError({ code: 'BAD_REQUEST' } as any)).toBe(false);
  });
});

describe('Middleware Integration', () => {
  it('should execute multiple middleware stages', async () => {
    const pipeline = new MiddlewarePipeline();
    const order: string[] = [];

    pipeline.use(
      async (ctx, next) => {
        order.push('pre-request');
        await next();
      },
      { name: 'pre-request' },
      MiddlewareStage.PRE_REQUEST
    );

    pipeline.use(
      async (ctx, next) => {
        order.push('post-response');
        await next();
      },
      { name: 'post-response' },
      MiddlewareStage.POST_RESPONSE
    );

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);
    await pipeline.execute(ctx, MiddlewareStage.POST_RESPONSE);

    expect(order).toEqual(['pre-request', 'post-response']);
  });

  it('should combine auth, logging, and timing middleware', async () => {
    const pipeline = new MiddlewarePipeline();

    const tokenProvider = new SimpleTokenProvider('test-token');
    const collector = new InMemoryMetricsCollector();
    const logs: any[] = [];
    const logger = {
      debug: vi.fn(),
      info: (msg: string, data: any) => logs.push({ msg, data }),
      warn: vi.fn(),
      error: vi.fn(),
    };

    pipeline.use(createAuthMiddleware({ tokenProvider }), { priority: 1 });
    pipeline.use(createLoggingMiddleware({ logger }), { priority: 2 });
    pipeline.use(createTimingMiddleware({ collector }), { priority: 3 });

    const ctx: ClientMiddlewareContext = {
      service: 'TestService',
      method: 'testMethod',
      args: [],
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    await pipeline.execute(ctx, MiddlewareStage.PRE_REQUEST);

    // Check auth injected
    expect(ctx.request?.headers?.['Authorization']).toBe('Bearer test-token');

    // Check logging happened
    expect(logs.length).toBeGreaterThan(0);

    // Check timing recorded
    const metrics = collector.getMetrics();
    expect(metrics.length).toBe(1);
  });
});
