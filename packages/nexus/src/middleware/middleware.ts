/**
 * Middleware system for Nexus DI Container
 */

import { ResolutionContext, InjectionToken } from '../types/core';

/**
 * Middleware execution result
 */
export interface MiddlewareResult<T = any> {
  value?: T;
  skip?: boolean;
  error?: Error;
  metadata?: Record<string, any>;
}

/**
 * Middleware next function
 */
export type MiddlewareNext<T = any> = () => T | Promise<T>;

/**
 * Middleware function
 */
export type MiddlewareFunction<T = any> = (
  context: MiddlewareContext,
  next: MiddlewareNext<T>
) => T | Promise<T>;

/**
 * Middleware context
 */
export interface MiddlewareContext extends ResolutionContext {
  token: InjectionToken<any>;
  attempt?: number;
  startTime?: number;
  [key: string]: any;
}

/**
 * Middleware interface
 */
export interface Middleware<T = any> {
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
  condition?: (context: MiddlewareContext) => boolean;
  
  /**
   * Error handler
   */
  onError?: (error: Error, context: MiddlewareContext) => void;
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
    this.middlewares = this.middlewares.filter(m => m.name !== name);
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
  async execute<T>(
    context: MiddlewareContext,
    finalHandler: () => T | Promise<T>
  ): Promise<T> {
    // Filter applicable middleware
    const applicable = this.middlewares.filter(m => 
      !m.condition || m.condition(context)
    );
    
    // Build the chain
    let index = -1;
    
    const dispatch = async (i: number): Promise<T> => {
      if (i <= index) {
        throw new Error('Middleware called next() multiple times');
      }
      
      index = i;
      
      if (i === applicable.length) {
        // Final handler
        return finalHandler();
      }
      
      const middleware = applicable[i];
      
      try {
        return await middleware.execute(context, () => dispatch(i + 1));
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
  executeSync<T>(
    context: MiddlewareContext,
    finalHandler: () => T
  ): T {
    // Filter applicable middleware
    const applicable = this.middlewares.filter(m => 
      !m.condition || m.condition(context)
    );
    
    // Build the chain
    let index = -1;
    
    const dispatch = (i: number): T => {
      if (i <= index) {
        throw new Error('Middleware called next() multiple times');
      }
      
      index = i;
      
      if (i === applicable.length) {
        // Final handler
        return finalHandler();
      }
      
      const middleware = applicable[i];
      
      try {
        const result = middleware.execute(context, () => dispatch(i + 1));
        // Check if it's a promise (which shouldn't happen in sync mode)
        if (result instanceof Promise) {
          throw new Error(`Middleware ${middleware.name} returned a promise in sync mode`);
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
    return this.middlewares.find(m => m.name === name);
  }
  
  /**
   * Check if middleware exists
   */
  has(name: string): boolean {
    return this.middlewares.some(m => m.name === name);
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
export function createMiddleware<T = any>(config: Middleware<T>): Middleware<T> {
  return config;
}

/**
 * Built-in logging middleware
 */
export const LoggingMiddleware = createMiddleware({
  name: 'logging',
  priority: 100,
  
  execute: async (context, next) => {
    const name = typeof context.token === 'string' ? context.token :
                 typeof context.token === 'symbol' ? context.token.toString() :
                 context.token?.name || 'unknown';
    
    console.log(`[Middleware] Resolving: ${name}`);
    const start = Date.now();
    
    try {
      const result = await next();
      console.log(`[Middleware] Resolved: ${name} in ${Date.now() - start}ms`);
      return result;
    } catch (error) {
      console.error(`[Middleware] Failed: ${name} after ${Date.now() - start}ms`, error);
      throw error;
    }
  }
});

/**
 * Built-in caching middleware
 */
export const CachingMiddleware = createMiddleware({
  name: 'caching',
  priority: 90,
  
  execute: async (context, next) => {
    // Check if caching is enabled
    const cache = (context.container as any).__middlewareCache;
    if (!cache) {
      return next();
    }
    
    const key = typeof context.token === 'string' ? context.token :
                typeof context.token === 'symbol' ? context.token.toString() :
                context.token?.name || 'unknown';
    
    // Check cache
    if (cache.has(key)) {
      const cached = cache.get(key);
      console.log(`[Cache] Hit: ${key}`);
      return cached;
    }
    
    // Execute and cache
    const result = await next();
    cache.set(key, result);
    console.log(`[Cache] Miss: ${key}`);
    
    return result;
  }
});

/**
 * Built-in retry middleware
 */
export const RetryMiddleware = createMiddleware({
  name: 'retry',
  priority: 80,
  
  execute: async (context, next) => {
    const maxRetries = context.maxRetries || 3;
    const retryDelay = context.retryDelay || 1000;
    
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        context.attempt = attempt;
        return await next();
      } catch (error: any) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.log(`[Retry] Attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
    
    throw lastError || new Error('All retry attempts failed');
  }
});

/**
 * Built-in validation middleware
 */
export const ValidationMiddleware = createMiddleware({
  name: 'validation',
  priority: 95,
  
  execute: async (context, next) => {
    // Pre-validation
    if (context.validate) {
      const validation = context.validate(context);
      if (validation === false) {
        throw new Error('Validation failed');
      }
    }
    
    const result = await next();
    
    // Post-validation
    if (context.validateResult) {
      const validation = context.validateResult(result);
      if (validation === false) {
        throw new Error('Result validation failed');
      }
    }
    
    return result;
  }
});

/**
 * Built-in transaction middleware
 */
export const TransactionMiddleware = createMiddleware({
  name: 'transaction',
  priority: 70,
  
  execute: async (context, next) => {
    // Check if transaction support is available
    const tx = context.transaction;
    if (!tx) {
      return next();
    }
    
    try {
      await tx.begin();
      const result = await next();
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }
});

/**
 * Built-in circuit breaker middleware
 */
export class CircuitBreakerMiddleware implements Middleware {
  name = 'circuit-breaker';
  priority = 85;
  
  private failures = new Map<string, number>();
  private lastFailureTime = new Map<string, number>();
  private state = new Map<string, 'closed' | 'open' | 'half-open'>();
  
  constructor(
    private threshold = 5,
    private timeout = 60000,
    private resetTimeout = 30000
  ) {}
  
  execute: MiddlewareFunction = async (context, next) => {
    const key = typeof context.token === 'string' ? context.token :
                typeof context.token === 'symbol' ? context.token.toString() :
                context.token?.name || 'unknown';
    
    const currentState = this.state.get(key) || 'closed';
    const lastFailure = this.lastFailureTime.get(key) || 0;
    
    // Check if circuit should be reset
    if (currentState === 'open' && Date.now() - lastFailure > this.resetTimeout) {
      this.state.set(key, 'half-open');
    }
    
    // Check circuit state
    if (this.state.get(key) === 'open') {
      throw new Error(`Circuit breaker is open for ${key}`);
    }
    
    try {
      const result = await next();
      
      // Success - reset failures if in half-open state
      if (this.state.get(key) === 'half-open') {
        this.state.set(key, 'closed');
        this.failures.delete(key);
        this.lastFailureTime.delete(key);
      }
      
      return result;
    } catch (error) {
      // Record failure
      const failures = (this.failures.get(key) || 0) + 1;
      this.failures.set(key, failures);
      this.lastFailureTime.set(key, Date.now());
      
      // Open circuit if threshold exceeded
      if (failures >= this.threshold) {
        this.state.set(key, 'open');
        console.error(`[CircuitBreaker] Opening circuit for ${key} after ${failures} failures`);
      }
      
      throw error;
    }
  };
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
    const key = context.rateLimitKey || 'global';
    const now = Date.now();
    
    // Get request timestamps for this key
    let timestamps = this.requests.get(key) || [];
    
    // Remove old timestamps outside the window
    timestamps = timestamps.filter(t => now - t < this.window);
    
    // Check rate limit
    if (timestamps.length >= this.limit) {
      const resetTime = timestamps[0] + this.window;
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      throw new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds`);
    }
    
    // Add current request
    timestamps.push(now);
    this.requests.set(key, timestamps);
    
    return next();
  };
}

/**
 * Compose multiple middleware into one
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return {
    name: 'composed',
    execute: async (context, next) => {
      const pipeline = new MiddlewarePipeline();
      middlewares.forEach(m => pipeline.use(m));
      return pipeline.execute(context, next);
    }
  };
}