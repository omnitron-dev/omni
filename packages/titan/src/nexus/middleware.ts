/**
 * Middleware system for Nexus DI Container
 */

import { InjectionToken, ResolutionContext, IContainer, MiddlewareContext } from './types.js';
import { Errors, ValidationError, TitanError, ErrorCode } from '../errors/index.js';

/**
 * Middleware execution result
 */
export interface MiddlewareResult<T = unknown> {
  value?: T;
  skip?: boolean;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/**
 * Middleware next function
 */
export type MiddlewareNext<T = unknown> = () => T | Promise<T>;

/**
 * Middleware function
 */
export type MiddlewareFunction<T = unknown> = (context: MiddlewareContext<T>, next: MiddlewareNext<T>) => T | Promise<T>;

/**
 * Middleware interface
 */
export interface Middleware<T = unknown> {
  /**
   * Middleware name
   */
  name: string;

  /**
   * Execute the middleware
   */
  execute: MiddlewareFunction<T>;

  /**
   * Priority (higher executes first)
   */
  priority?: number;

  /**
   * Condition to apply middleware
   */
  condition?: (context: MiddlewareContext<T>) => boolean;

  /**
   * Error handler
   */
  onError?: (error: Error, context: MiddlewareContext<T>) => void;
}

/**
 * Middleware pipeline for executing middleware in sequence
 */
export class MiddlewarePipeline {
  private middlewares: Middleware[] = [];

  /**
   * Add middleware to pipeline
   */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    // Sort by priority (higher first)
    this.middlewares.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    return this;
  }

  /**
   * Remove middleware from pipeline
   */
  remove(name: string): this {
    this.middlewares = this.middlewares.filter((m) => m.name !== name);
    return this;
  }

  /**
   * Clear all middleware
   */
  clear(): this {
    this.middlewares = [];
    return this;
  }

  /**
   * Execute the middleware pipeline
   */
  async execute<T>(context: MiddlewareContext, finalHandler: () => T | Promise<T>): Promise<T> {
    // Filter applicable middleware
    const applicable = this.middlewares.filter((m) => !m.condition || m.condition(context));

    // Build the chain
    let index = -1;
    let retryContext = false;

    const dispatch = async (i: number): Promise<T> => {
      // For retry middleware, we allow multiple next() calls
      // Check using explicit marker instead of fragile string matching
      const currentMiddleware = applicable[i];
      const isRetryMiddleware = currentMiddleware && 'isRetryMiddleware' in currentMiddleware && (currentMiddleware as any).isRetryMiddleware === true;

      if (isRetryMiddleware) {
        retryContext = true;
      }

      // Only enforce the "no multiple calls" rule for non-retry scenarios
      if (!retryContext && i <= index) {
        throw Errors.internal('Middleware called next() multiple times');
      }

      // Update index for non-retry middleware
      if (!retryContext || i > index) {
        index = i;
      }

      if (i === applicable.length) {
        // Final handler
        return finalHandler();
      }

      const middleware = applicable[i];
      if (!middleware) {
        return dispatch(i + 1);
      }

      try {
        return await middleware.execute(context, () => dispatch(i + 1)) as T;
      } catch (error: any) {
        if (middleware.onError) {
          middleware.onError(error, context);
        }
        throw error;
      }
    };

    return dispatch(0);
  }

  /**
   * Execute synchronously (for sync operations)
   */
  executeSync<T>(context: MiddlewareContext, finalHandler: () => T): T {
    // Filter applicable middleware
    const applicable = this.middlewares.filter((m) => !m.condition || m.condition(context));

    // Build the chain
    let index = -1;

    const dispatch = (i: number): T => {
      if (i <= index) {
        throw Errors.internal('Middleware called next() multiple times');
      }

      index = i;

      if (i === applicable.length) {
        // Final handler
        return finalHandler();
      }

      const middleware = applicable[i];
      if (!middleware) {
        return dispatch(i + 1);
      }

      try {
        const result = middleware.execute(context, () => dispatch(i + 1));
        // Check if it's a promise (which shouldn't happen in sync mode)
        if (result instanceof Promise) {
          throw new TitanError({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Middleware async/sync mismatch: ' + middleware.name,
            details: { middleware: middleware.name },
          });
        }
        return result as T;
      } catch (error: any) {
        if (middleware.onError) {
          middleware.onError(error, context);
        }
        throw error;
      }
    };

    return dispatch(0);
  }

  /**
   * Get middleware by name
   */
  get(name: string): Middleware | undefined {
    return this.middlewares.find((m) => m.name === name);
  }

  /**
   * Check if middleware exists
   */
  has(name: string): boolean {
    return this.middlewares.some((m) => m.name === name);
  }

  /**
   * Get all middleware
   */
  getAll(): Middleware[] {
    return [...this.middlewares];
  }
}

/**
 * Create a middleware
 */
export function createMiddleware<T = unknown>(config: Middleware<T>): Middleware<T> {
  return config;
}

/**
 * Built-in logging middleware
 */
export const LoggingMiddleware = createMiddleware({
  name: 'logging',
  priority: 100,

  execute: (context, next) => {
    const name =
      typeof context.token === 'string'
        ? context.token
        : typeof context.token === 'symbol'
          ? context.token.toString()
          : context.token?.name || 'unknown';

    // TODO: Replace with injectable logger
    console.log(`[Middleware] Resolving: ${name}`);
    const start = Date.now();

    try {
      const result = next();

      // Handle both sync and async results
      if (result instanceof Promise) {
        return result.then(
          (value) => {
            // TODO: Replace with injectable logger
            console.log(`[Middleware] Resolved: ${name} in ${Date.now() - start}ms`);
            return value;
          },
          (error) => {
            // TODO: Replace with injectable logger
            console.error(`[Middleware] Failed: ${name} after ${Date.now() - start}ms`, error);
            throw error;
          }
        );
      }

      // TODO: Replace with injectable logger
      console.log(`[Middleware] Resolved: ${name} in ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      // TODO: Replace with injectable logger
      console.error(`[Middleware] Failed: ${name} after ${Date.now() - start}ms`, error);
      throw error;
    }
  },
});

/**
 * Built-in caching middleware
 */
export const CachingMiddleware = createMiddleware({
  name: 'caching',
  priority: 90,

  execute: (context, next) => {
    // Check if caching is enabled
    const cache = (context.container as any).__middlewareCache;
    if (!cache) {
      return next();
    }

    const key =
      typeof context.token === 'string'
        ? context.token
        : typeof context.token === 'symbol'
          ? context.token.toString()
          : context.token?.name || 'unknown';

    // Check cache
    if (cache.has(key)) {
      const cached = cache.get(key);
      // TODO: Replace with injectable logger
      console.log(`[Cache] Hit: ${key}`);
      return cached;
    }

    // Execute and cache
    const result = next();

    // Handle both sync and async results
    if (result instanceof Promise) {
      return result.then((value) => {
        cache.set(key, value);
        // TODO: Replace with injectable logger
        console.log(`[Cache] Miss: ${key}`);
        return value;
      });
    }

    cache.set(key, result);
    // TODO: Replace with injectable logger
    console.log(`[Cache] Miss: ${key}`);
    return result;
  },
});

/**
 * Built-in retry middleware
 */
export const RetryMiddleware = createMiddleware({
  name: 'retry',
  priority: 80,

  execute: (context, next) => {
    const maxRetries = (context['maxRetries'] as number) || 3;
    const retryDelay = (context['retryDelay'] as number) || 1000;

    // For sync execution, we can't retry with delays
    // Just try once and return
    const firstAttempt = () => {
      context.attempt = 1;
      return next();
    };

    const result = firstAttempt();

    // For async results, we can properly retry
    if (result instanceof Promise) {
      return (async () => {
        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            context.attempt = attempt;
            return await next();
          } catch (error: any) {
            lastError = error;

            if (attempt < maxRetries) {
              // TODO: Replace with injectable logger
              console.log(`[Retry] Attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
            }
          }
        }

        throw lastError || Errors.internal('All retry attempts failed');
      })();
    }

    return result;
  },
});

/**
 * Built-in validation middleware
 */
export const ValidationMiddleware = createMiddleware({
  name: 'validation',
  priority: 95,

  execute: (context, next) => {
    // Pre-validation
    const validateFn = context['validate'] as ((ctx: MiddlewareContext) => boolean) | undefined;
    if (validateFn) {
      const validation = validateFn(context);
      if (validation === false) {
        throw ValidationError.fromFieldErrors([{ field: 'input', message: 'Validation failed' }]);
      }
    }

    const result = next();

    // Handle both sync and async results
    if (result instanceof Promise) {
      return result.then((value) => {
        // Post-validation
        const validateResultFn = context['validateResult'] as ((val: unknown) => boolean) | undefined;
        if (validateResultFn) {
          const validation = validateResultFn(value);
          if (validation === false) {
            throw ValidationError.fromFieldErrors([{ field: 'result', message: 'Result validation failed' }]);
          }
        }
        return value;
      });
    }

    // Post-validation for sync result
    const validateResultFn = context['validateResult'] as ((val: unknown) => boolean) | undefined;
    if (validateResultFn) {
      const validation = validateResultFn(result);
      if (validation === false) {
        throw ValidationError.fromFieldErrors([{ field: 'result', message: 'Result validation failed' }]);
      }
    }

    return result;
  },
});

/**
 * Built-in transaction middleware
 */
export const TransactionMiddleware = createMiddleware({
  name: 'transaction',
  priority: 70,

  execute: (context, next) => {
    // Check if transaction support is available
    const tx = context['transaction'] as { begin?: () => void | Promise<void>; commit?: () => void | Promise<void>; rollback?: () => void | Promise<void> } | undefined;
    if (!tx) {
      return next();
    }

    // For async transactions
    if (tx.begin && typeof tx.begin === 'function') {
      const beginResult = tx.begin();
      if (beginResult instanceof Promise) {
        return beginResult.then(() => {
          const result = next();
          if (result instanceof Promise) {
            return result.then(
              async (value) => {
                await tx.commit?.();
                return value;
              },
              async (error) => {
                await tx.rollback?.();
                throw error;
              }
            );
          }
          tx.commit?.();
          return result;
        });
      }
    }

    // Sync transaction handling
    try {
      if (tx.begin) tx.begin();
      const result = next();
      if (tx.commit) tx.commit();
      return result;
    } catch (error) {
      if (tx.rollback) tx.rollback();
      throw error;
    }
  },
});

/**
 * Built-in circuit breaker middleware
 */
export class CircuitBreakerMiddleware implements Middleware {
  name = 'circuit-breaker';
  priority = 85;
  version = '1.0.0';

  private failures = new Map<string, number>();
  private lastFailureTime = new Map<string, number>();
  private state = new Map<string, 'closed' | 'open' | 'half-open'>();

  constructor(options: { threshold?: number; timeout?: number; resetTimeout?: number } = {}) {
    this.threshold = options.threshold || 5;
    this.timeout = options.timeout || 60000;
    this.resetTimeout = options.resetTimeout || 30000;
  }

  private threshold: number;
  private timeout: number;
  private resetTimeout: number;

  execute: MiddlewareFunction = (context, next) => {
    const key =
      typeof context.token === 'string'
        ? context.token
        : typeof context.token === 'symbol'
          ? context.token.toString()
          : context.token?.name || 'unknown';

    const currentState = this.state.get(key) || 'closed';
    const lastFailure = this.lastFailureTime.get(key) || 0;

    // Check if circuit should be reset
    if (currentState === 'open' && Date.now() - lastFailure > this.resetTimeout) {
      this.state.set(key, 'half-open');
    }

    // Check circuit state
    if (this.state.get(key) === 'open') {
      throw Errors.unavailable('Service', 'Circuit breaker is open');
    }

    try {
      const result = next();

      // Handle both sync and async results
      if (result instanceof Promise) {
        return result
          .then((res) => {
            // Success - reset failures if in half-open state
            if (this.state.get(key) === 'half-open') {
              this.state.set(key, 'closed');
              this.failures.delete(key);
              this.lastFailureTime.delete(key);
            }
            return res;
          })
          .catch((error) => {
            this.handleFailure(key);
            throw error;
          });
      } else {
        // Synchronous success - reset failures if in half-open state
        if (this.state.get(key) === 'half-open') {
          this.state.set(key, 'closed');
          this.failures.delete(key);
          this.lastFailureTime.delete(key);
        }
        return result;
      }
    } catch (error) {
      this.handleFailure(key);
      throw error;
    }
  };

  private handleFailure(key: string): void {
    // Record failure
    const failures = (this.failures.get(key) || 0) + 1;
    this.failures.set(key, failures);
    this.lastFailureTime.set(key, Date.now());

    // Open circuit if threshold exceeded
    if (failures >= this.threshold) {
      this.state.set(key, 'open');
      // TODO: Replace with injectable logger
      console.error(`[CircuitBreaker] Opening circuit for ${key} after ${failures} failures`);
    }
  }

  // Plugin interface implementation
  install(container: any): void {
    container.addMiddleware(this);
  }
}

/**
 * Built-in rate limiting middleware
 */
export class RateLimitMiddleware implements Middleware {
  name = 'rate-limit';
  priority = 88;

  private requests = new Map<string, number[]>();

  constructor(
    private limit = 100,
    private window = 60000 // 1 minute
  ) {}

  execute: MiddlewareFunction = async (context, next) => {
    const key = (context['rateLimitKey'] as string) || 'global';
    const now = Date.now();

    // Get request timestamps for this key
    let timestamps = this.requests.get(key) || [];

    // Remove old timestamps outside the window
    timestamps = timestamps.filter((t) => now - t < this.window);

    // Check rate limit
    if (timestamps && timestamps.length >= this.limit) {
      const resetTime = (timestamps[0] || now) + this.window;
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      throw Errors.tooManyRequests(retryAfter);
    }

    // Add current request
    timestamps.push(now);
    this.requests.set(key as string, timestamps);

    return next();
  };
}

/**
 * Built-in retry middleware class
 * @deprecated Use the functional RetryMiddleware instead. This class-style middleware will be removed in a future version.
 */
export class RetryMiddlewareClass implements Middleware {
  name = 'retry';
  priority = 80;
  version = '1.0.0';
  isRetryMiddleware = true;

  constructor(private options: { maxAttempts: number; delay: number }) {}

  execute: MiddlewareFunction = async (context, next) => {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      try {
        context.attempt = attempt;
        return await next();
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.options.maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, this.options.delay));
        }
      }
    }

    throw lastError || Errors.internal('All retry attempts failed');
  };

  // Plugin interface implementation
  install(container: any): void {
    container.addMiddleware(this);
  }
}

/**
 * Built-in cache middleware class
 * @deprecated Use the functional CachingMiddleware instead. This class-style middleware will be removed in a future version.
 */
export class CacheMiddleware implements Middleware {
  name = 'cache';
  priority = 90;
  version = '1.0.0';

  private cache = new Map<string, { value: any; expires: number }>();

  constructor(private options: { ttl: number; keyGenerator: (context: MiddlewareContext) => string }) {}

  execute: MiddlewareFunction = (context, next) => {
    const key = this.options.keyGenerator(context);
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expires > now) {
      return cached.value;
    }

    // Execute and cache result
    const result = next();

    // Handle both sync and async results
    if (result instanceof Promise) {
      return result.then((value) => {
        this.cache.set(key, {
          value,
          expires: now + this.options.ttl,
        });
        return value;
      });
    } else {
      this.cache.set(key, {
        value: result,
        expires: now + this.options.ttl,
      });
      return result;
    }
  };

  // Plugin interface implementation
  install(container: any): void {
    container.addMiddleware(this);
  }
}

/**
 * Built-in validation middleware class
 * @deprecated Use the functional ValidationMiddleware instead. This class-style middleware will be removed in a future version.
 */
export class ValidationMiddlewareClass implements Middleware {
  name = 'validation';
  priority = 95;
  version = '1.0.0';

  constructor(private options: { validators: Record<string, (value: any) => boolean> }) {}

  execute: MiddlewareFunction = (context, next) => {
    const result = next();

    // Helper function for post-validation
    const validateResult = (value: any) => {
      // Get the registration to check for validation key
      const registration = (context as any).container?.getRegistration?.(context.token);
      if (registration?.provider?.validate) {
        const validatorKey = registration.provider.validate;
        const validator = this.options.validators[validatorKey];
        if (validator) {
          validator(value); // This can throw an error
        }
      }
      return value;
    };

    // Handle both sync and async results
    if (result instanceof Promise) {
      return result.then(validateResult);
    } else {
      return validateResult(result);
    }
  };

  // Plugin interface implementation
  install(container: any): void {
    container.addMiddleware(this);
  }
}

/**
 * Compose multiple middleware into one
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return {
    name: 'composed',
    execute: async (context, next) => {
      const pipeline = new MiddlewarePipeline();
      middlewares.forEach((m) => pipeline.use(m));
      return pipeline.execute(context, next);
    },
  };
}
