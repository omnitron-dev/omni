/**
 * Middleware module exports
 */

import type { Middleware, MiddlewareContext } from '../core/types.js';

/**
 * Logging middleware - logs all service calls
 */
export function createLoggingMiddleware(options?: {
  logLevel?: 'debug' | 'info' | 'warn';
  includeArgs?: boolean;
  includeResult?: boolean;
}): Middleware {
  const { logLevel = 'info', includeArgs = false, includeResult = false } = options ?? {};

  return async (context, next) => {
    const start = performance.now();
    const { service, method, args } = context;

    const logFn = logLevel === 'debug' ? console.debug : logLevel === 'warn' ? console.warn : console.log;

    logFn(`[RPC] ${service}.${method}`, includeArgs ? { args } : '');

    try {
      const result = await next();
      const duration = performance.now() - start;

      logFn(`[RPC] ${service}.${method} completed in ${duration.toFixed(2)}ms`, includeResult ? { result } : '');

      return result;
    } catch (error) {
      const duration = performance.now() - start;
      console.error(`[RPC] ${service}.${method} failed after ${duration.toFixed(2)}ms`, error);
      throw error;
    }
  };
}

/**
 * Timing middleware - tracks performance metrics
 */
export function createTimingMiddleware(options?: {
  onTiming?: (timing: { service: string; method: string; duration: number }) => void;
  slowThreshold?: number;
}): Middleware {
  const { onTiming, slowThreshold = 1000 } = options ?? {};

  return async (context, next) => {
    const start = performance.now();

    try {
      return await next();
    } finally {
      const duration = performance.now() - start;

      if (onTiming) {
        onTiming({
          service: context.service,
          method: context.method,
          duration,
        });
      }

      if (duration > slowThreshold) {
        console.warn(`[SLOW] ${context.service}.${context.method} took ${duration.toFixed(2)}ms`);
      }
    }
  };
}

/**
 * Retry middleware - automatically retries failed requests
 */
export function createRetryMiddleware(options?: {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: Error, attempt: number) => boolean;
}): Middleware {
  const { maxAttempts = 3, initialDelay = 1000, maxDelay = 10000, shouldRetry = () => true } = options ?? {};

  return async (context, next) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await next();
      } catch (error) {
        lastError = error as Error;

        if (attempt >= maxAttempts || !shouldRetry(lastError, attempt)) {
          throw error;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  };
}

/**
 * Cache middleware - caches responses
 */
export function createCacheMiddleware(options?: {
  ttl?: number;
  keyGenerator?: (context: MiddlewareContext) => string;
  shouldCache?: (context: MiddlewareContext) => boolean;
}): Middleware {
  const {
    ttl = 60000,
    keyGenerator = (ctx) => `${ctx.service}.${ctx.method}:${JSON.stringify(ctx.args)}`,
    shouldCache = () => true,
  } = options ?? {};

  const cache = new Map<string, { data: unknown; expiry: number }>();

  return async (context, next) => {
    if (!shouldCache(context)) {
      return next();
    }

    const key = keyGenerator(context);
    const cached = cache.get(key);

    if (cached && cached.expiry > Date.now()) {
      return cached.data;
    }

    const result = await next();

    cache.set(key, {
      data: result,
      expiry: Date.now() + ttl,
    });

    return result;
  };
}

/**
 * Auth middleware - adds authorization headers
 */
export function createAuthMiddleware(options: {
  getToken: () => string | null | Promise<string | null>;
  headerName?: string;
}): Middleware {
  const { getToken, headerName = 'Authorization' } = options;

  return async (context, next) => {
    const token = await getToken();

    if (token) {
      context.metadata.set(headerName, `Bearer ${token}`);
    }

    return next();
  };
}

/**
 * Transform middleware - transforms request/response
 */
export function createTransformMiddleware<TIn = unknown, TOut = unknown>(options: {
  transformRequest?: (args: unknown[]) => unknown[];
  transformResponse?: (response: TIn) => TOut;
}): Middleware {
  const { transformRequest, transformResponse } = options;

  return async (context, next) => {
    // Transform request
    if (transformRequest) {
      context.args = transformRequest(context.args);
    }

    const result = await next();

    // Transform response
    if (transformResponse) {
      return transformResponse(result as TIn);
    }

    return result;
  };
}

/**
 * Compose multiple middleware into one
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return async (context, next) => {
    let index = -1;

    const dispatch = async (i: number): Promise<unknown> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;

      const middleware = middlewares[i];
      if (!middleware) {
        return next();
      }

      return middleware(context, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}

// Re-export types
export type { Middleware, MiddlewareContext } from '../core/types.js';
