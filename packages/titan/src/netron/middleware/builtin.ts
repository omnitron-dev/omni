/**
 * Transport-Agnostic Built-in Middleware for Netron
 *
 * Common middleware that works across all transport types
 */

import type { NetronMiddlewareContext, MiddlewareFunction } from './types.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import * as zlib from 'zlib';

/**
 * Transport-agnostic built-in middleware
 */
export class NetronBuiltinMiddleware {
  /**
   * Request ID middleware
   */
  static requestId(): MiddlewareFunction {
    return async (ctx, next) => {
      // Generate request ID if not already present
      if (!ctx.metadata) {
        ctx.metadata = new Map();
      }
      const requestId = ctx.metadata.get('requestId') ||
        `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      ctx.metadata.set('requestId', requestId);
      await next();
    };
  }

  /**
   * Rate limit middleware
   */
  static rateLimit(options: { maxRequests?: number; window?: number } = {}): MiddlewareFunction {
    const { maxRequests = 100, window = 60000 } = options;
    const requests = new Map<string, { count: number; resetTime: number }>();

    return async (ctx, next) => {
      const key = ctx.metadata?.get('clientId') || 'default';
      const now = Date.now();

      let record = requests.get(key);
      if (!record || now > record.resetTime) {
        record = { count: 0, resetTime: now + window };
        requests.set(key, record);
      }

      if (record.count >= maxRequests) {
        throw new TitanError({
          code: ErrorCode.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded'
        });
      }

      record.count++;
      await next();
    };
  }

  /**
   * Circuit breaker middleware
   */
  static circuitBreaker(options: {
    threshold?: number;
    timeout?: number;
    resetTimeout?: number
  } = {}): MiddlewareFunction {
    const { threshold = 5, timeout = 60000, resetTimeout = 30000 } = options;
    let failures = 0;
    let state: 'closed' | 'open' | 'half-open' = 'closed';
    let nextAttempt = 0;

    return async (ctx, next) => {
      if (state === 'open') {
        if (Date.now() < nextAttempt) {
          throw new TitanError({
            code: ErrorCode.SERVICE_UNAVAILABLE,
            message: 'Circuit breaker is open'
          });
        }
        state = 'half-open';
      }

      try {
        await next();
        if (state === 'half-open') {
          state = 'closed';
          failures = 0;
        }
      } catch (error) {
        failures++;
        if (failures >= threshold) {
          state = 'open';
          nextAttempt = Date.now() + resetTimeout;
        }
        throw error;
      }
    };
  }

  /**
   * Metrics middleware
   */
  static metrics(metricsCollector?: (metrics: any) => void): MiddlewareFunction {
    return async (ctx, next) => {
      const start = Date.now();
      let success = false;

      try {
        await next();
        success = true;
      } finally {
        const duration = Date.now() - start;
        const metrics = {
          service: ctx.serviceName,
          method: ctx.methodName,
          duration,
          success,
          timestamp: new Date().toISOString()
        };

        if (metricsCollector) {
          metricsCollector(metrics);
        }
      }
    };
  }

  /**
   * Logging middleware (alias)
   */
  static logging(logger: any): MiddlewareFunction {
    return this.loggingMiddleware(logger);
  }

  /**
   * Logging middleware
   */
  static loggingMiddleware(logger: any): MiddlewareFunction {
    return async (ctx, next) => {
      const start = Date.now();

      logger.info({
        service: ctx.serviceName,
        method: ctx.methodName,
        input: ctx.input
      }, 'Netron request');

      try {
        await next();

        const duration = Date.now() - start;
        logger.info({
          service: ctx.serviceName,
          method: ctx.methodName,
          duration,
          result: ctx.result
        }, 'Netron response');
      } catch (error: any) {
        logger.error({
          service: ctx.serviceName,
          method: ctx.methodName,
          error: error.message,
          duration: Date.now() - start
        }, 'Netron error');
        throw error;
      }
    };
  }

  /**
   * Metrics collection middleware
   */
  static metricsMiddleware(metrics: {
    recordRequest: (service: string, method: string) => void;
    recordDuration: (service: string, method: string, duration: number) => void;
    recordError: (service: string, method: string, error: Error) => void;
  }): MiddlewareFunction {
    return async (ctx, next) => {
      const start = Date.now();

      if (ctx.serviceName && ctx.methodName) {
        metrics.recordRequest(ctx.serviceName, ctx.methodName);
      }

      try {
        await next();

        if (ctx.serviceName && ctx.methodName) {
          const duration = Date.now() - start;
          metrics.recordDuration(ctx.serviceName, ctx.methodName, duration);
        }
      } catch (error: any) {
        if (ctx.serviceName && ctx.methodName) {
          metrics.recordError(ctx.serviceName, ctx.methodName, error);
        }
        throw error;
      }
    };
  }

  /**
   * Authentication middleware
   */
  static authenticationMiddleware(authenticator: {
    verify: (token: string) => Promise<any> | any;
  }): MiddlewareFunction {
    return async (ctx, next) => {
      const authHeader = ctx.metadata.get('authorization');

      if (!authHeader || typeof authHeader !== 'string') {
        throw new TitanError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'No authorization token provided'
        });
      }

      const token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;

      try {
        const user = await authenticator.verify(token);
        ctx.metadata.set('user', user);
        await next();
      } catch (error: any) {
        throw new TitanError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Invalid authentication token',
          cause: error
        });
      }
    };
  }

  /**
   * Authorization middleware
   */
  static authorizationMiddleware(requiredRoles: string[]): MiddlewareFunction {
    return async (ctx, next) => {
      const user = ctx.metadata.get('user');

      if (!user) {
        throw new TitanError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'User not authenticated'
        });
      }

      const userRole = user.role || user.roles?.[0];

      if (!requiredRoles.includes(userRole)) {
        throw new TitanError({
          code: ErrorCode.FORBIDDEN,
          message: 'Insufficient permissions'
        });
      }

      await next();
    };
  }

  /**
   * Rate limiting middleware
   */
  static rateLimitMiddleware(limiter: {
    check: (params: any) => Promise<{ allowed: boolean; retryAfter?: number }>
  }): MiddlewareFunction {
    return async (ctx, next) => {
      const key = `${ctx.serviceName}.${ctx.methodName}`;
      const result = await limiter.check({ key, context: ctx });

      if (!result.allowed) {
        throw new TitanError({
          code: ErrorCode.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          details: { retryAfter: result.retryAfter || 60 }
        });
      }

      await next();
    };
  }

  /**
   * Circuit breaker middleware
   */
  static circuitBreakerMiddleware(breaker: {
    isOpen: (key: string) => boolean;
    onSuccess: (key: string) => void;
    onFailure: (key: string, error: Error) => void;
  }): MiddlewareFunction {
    return async (ctx, next) => {
      const key = `${ctx.serviceName}.${ctx.methodName}`;

      if (breaker.isOpen(key)) {
        throw new TitanError({
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: 'Circuit breaker is open'
        });
      }

      try {
        await next();
        breaker.onSuccess(key);
      } catch (error: any) {
        breaker.onFailure(key, error);
        throw error;
      }
    };
  }

  /**
   * Timeout middleware
   */
  static timeoutMiddleware(timeoutMs: number): MiddlewareFunction {
    return async (ctx, next) => {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new TitanError({
            code: ErrorCode.REQUEST_TIMEOUT,
            message: `Request timed out after ${timeoutMs}ms`
          }));
        }, timeoutMs);
      });

      await Promise.race([next(), timeoutPromise]);
    };
  }

  /**
   * Caching middleware
   */
  static cachingMiddleware(options: {
    cache: Map<string, any>;
    ttl: number;
    keyGenerator?: (ctx: NetronMiddlewareContext) => string;
  }): MiddlewareFunction {
    const { cache, ttl } = options;
    const keyGenerator = options.keyGenerator || ((ctx) =>
      `${ctx.serviceName}.${ctx.methodName}:${JSON.stringify(ctx.input)}`
    );

    return async (ctx, next) => {
      const cacheKey = keyGenerator(ctx);

      // Check cache
      if (cache.has(cacheKey)) {
        ctx.result = cache.get(cacheKey);
        ctx.metadata.set('cached', true);
        return;
      }

      await next();

      // Cache result if successful
      if (ctx.result && !ctx.error) {
        cache.set(cacheKey, ctx.result);

        // Set TTL
        setTimeout(() => {
          cache.delete(cacheKey);
        }, ttl);
      }
    };
  }

  /**
   * Retry middleware
   */
  static retryMiddleware(options: {
    maxAttempts: number;
    delay: number;
    backoffMultiplier?: number;
    shouldRetry?: (error: Error) => boolean;
  }): MiddlewareFunction {
    return async (ctx, next) => {
      let lastError: Error | undefined;
      let delay = options.delay;

      for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
          await next();
          return;
        } catch (error: any) {
          lastError = error;

          if (options.shouldRetry && !options.shouldRetry(error)) {
            throw error;
          }

          if (attempt < options.maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, delay));

            if (options.backoffMultiplier) {
              delay *= options.backoffMultiplier;
            }
          }
        }
      }

      throw lastError;
    };
  }

  /**
   * Compression middleware
   */
  static compressionMiddleware(options: {
    threshold?: number;
  } = {}): MiddlewareFunction {
    const threshold = options.threshold || 1024; // 1KB default

    return async (ctx, next) => {
      await next();

      if (!ctx.result) return;

      const data = typeof ctx.result === 'string'
        ? ctx.result
        : JSON.stringify(ctx.result);

      if (data.length < threshold) return;

      // Compress the result
      const compressed = zlib.gzipSync(data);
      ctx.metadata.set('compressed', true);
      ctx.metadata.set('originalSize', data.length);
      ctx.result = compressed;
    };
  }

  /**
   * Validation middleware
   */
  static validationMiddleware(validator: {
    validate: (input: any, context: any) => { valid: boolean; errors?: string[] }
  }): MiddlewareFunction {
    return async (ctx, next) => {
      const result = validator.validate(ctx.input, {
        service: ctx.serviceName,
        method: ctx.methodName
      });

      if (!result.valid) {
        throw new TitanError({
          code: ErrorCode.BAD_REQUEST,
          message: 'Validation failed',
          details: { errors: result.errors || [] }
        });
      }

      await next();
    };
  }

  /**
   * Tracing middleware
   */
  static tracingMiddleware(tracer: {
    startSpan: (name: string) => any;
    inject?: (span: any, carrier: any) => void;
  }): MiddlewareFunction {
    return async (ctx, next) => {
      const span = tracer.startSpan(`${ctx.serviceName}.${ctx.methodName}`);

      span.setTag('service', ctx.serviceName);
      span.setTag('method', ctx.methodName);

      if (tracer.inject) {
        tracer.inject(span, ctx.metadata);
      }

      try {
        await next();
      } catch (error: any) {
        span.setTag('error', true);
        span.setTag('error.message', error.message);
        throw error;
      } finally {
        span.finish();
      }
    };
  }
}