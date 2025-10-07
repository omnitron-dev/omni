/**
 * Type-Safe Middleware System with Context Preservation
 *
 * Provides fully typed middleware with compile-time checking
 * and context type accumulation through the pipeline.
 */

import type { NetronMiddlewareContext } from '../../middleware/types.js';
import { TitanError, ErrorCode } from '../../../errors/index.js';

/**
 * Typed metadata with known and custom fields
 * Extends Map for compatibility with NetronMiddlewareContext
 */
export class TypedMetadata extends Map<string, any> {
  get requestId(): string {
    return this.get('requestId') || '';
  }
  set requestId(value: string) {
    this.set('requestId', value);
  }

  get timestamp(): number {
    return this.get('timestamp') || Date.now();
  }
  set timestamp(value: number) {
    this.set('timestamp', value);
  }

  get traceId(): string | undefined {
    return this.get('traceId');
  }
  set traceId(value: string | undefined) {
    if (value !== undefined) {
      this.set('traceId', value);
    } else {
      this.delete('traceId');
    }
  }

  get spanId(): string | undefined {
    return this.get('spanId');
  }
  set spanId(value: string | undefined) {
    if (value !== undefined) {
      this.set('spanId', value);
    } else {
      this.delete('spanId');
    }
  }

  get userId(): string | undefined {
    return this.get('userId');
  }
  set userId(value: string | undefined) {
    if (value !== undefined) {
      this.set('userId', value);
    } else {
      this.delete('userId');
    }
  }

  get tenantId(): string | undefined {
    return this.get('tenantId');
  }
  set tenantId(value: string | undefined) {
    if (value !== undefined) {
      this.set('tenantId', value);
    } else {
      this.delete('tenantId');
    }
  }

  get serverTime(): number | undefined {
    return this.get('serverTime');
  }
  set serverTime(value: number | undefined) {
    if (value !== undefined) {
      this.set('serverTime', value);
    } else {
      this.delete('serverTime');
    }
  }

  get cacheHit(): boolean | undefined {
    return this.get('cacheHit');
  }
  set cacheHit(value: boolean | undefined) {
    if (value !== undefined) {
      this.set('cacheHit', value);
    } else {
      this.delete('cacheHit');
    }
  }
}

/**
 * Enhanced middleware context with full type information
 */
export interface TypedHttpMiddlewareContext<
  TService = any,
  TMethod extends keyof TService = keyof TService,
  TInput = any,
  TOutput = any
> extends NetronMiddlewareContext {
  // Type-safe service info
  service: string;  // Changed to string for compatibility
  method: TMethod;
  input: TInput;
  output?: TOutput;

  // Type-safe metadata access
  metadata: TypedMetadata;

  // Type-safe error handling
  error?: TitanError;
}

/**
 * Type-safe middleware function
 */
export type TypedMiddleware<T extends NetronMiddlewareContext> = (
  ctx: T,
  next: () => Promise<void>
) => Promise<void> | void;

/**
 * Middleware configuration with metadata
 */
export interface MiddlewareConfig {
  name?: string;
  priority?: number;
  enabled?: boolean;
  stage?: 'pre' | 'post' | 'error';
  metadata?: Record<string, any>;
}

/**
 * Middleware composer for type-safe composition
 */
export class TypedMiddlewarePipeline<TContext extends NetronMiddlewareContext> {
  private middlewares: Array<{
    fn: TypedMiddleware<TContext>;
    config: MiddlewareConfig;
  }> = [];

  /**
   * Register middleware with type checking
   */
  use<M extends TypedMiddleware<TContext>>(
    middleware: M,
    config?: MiddlewareConfig
  ): this {
    this.validateMiddleware(middleware);

    this.middlewares.push({
      fn: middleware,
      config: config || {}
    });

    // Sort by priority
    this.middlewares.sort((a, b) =>
      (a.config.priority || 100) - (b.config.priority || 100)
    );

    return this;
  }

  /**
   * Compose multiple middlewares with type preservation
   */
  compose<M1, M2, M3>(
    m1: TypedMiddleware<TContext & M1>,
    m2: TypedMiddleware<TContext & M1 & M2>,
    m3: TypedMiddleware<TContext & M1 & M2 & M3>
  ): TypedMiddleware<TContext & M1 & M2 & M3> {
    return async (ctx, next) => {
      await m1(ctx as any, async () => {
        await m2(ctx as any, async () => {
          await m3(ctx as any, next);
        });
      });
    };
  }

  /**
   * Execute middleware pipeline
   */
  async execute(context: TContext, handler: () => Promise<void>): Promise<void> {
    const chain = this.buildChain(handler);
    await chain(context);
  }

  /**
   * Build middleware chain
   */
  private buildChain(handler: () => Promise<void>): (ctx: TContext) => Promise<void> {
    // Filter enabled middlewares for the current stage
    const activeMiddlewares = this.middlewares.filter(m =>
      m.config.enabled !== false
    );

    // Build the chain from right to left
    let chain = async (ctx: TContext) => {
      try {
        await handler();
      } catch (error) {
        ctx.error = error as any;
        throw error;
      }
    };

    // Wrap each middleware
    for (let i = activeMiddlewares.length - 1; i >= 0; i--) {
      const middleware = activeMiddlewares[i];
      const next = chain;

      chain = async (ctx: TContext) => {
        // Check if this middleware should run in the current stage
        if (this.shouldRun(middleware?.config || {}, ctx)) {
          await middleware?.fn(ctx, async () => {
            await next(ctx);
          });
        } else {
          await next(ctx);
        }
      };
    }

    return chain;
  }

  /**
   * Check if middleware should run
   */
  private shouldRun(config: MiddlewareConfig, ctx: TContext): boolean {
    // Check stage
    if (config.stage) {
      const hasError = !!ctx.error;
      if (config.stage === 'error' && !hasError) return false;
      if (config.stage === 'pre' && hasError) return false;
      if (config.stage === 'post' && hasError) return false;
    }

    return true;
  }

  /**
   * Validate middleware compatibility
   */
  private validateMiddleware(middleware: TypedMiddleware<TContext>): void {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }

    // Additional validation could be added here
  }

  /**
   * Get middleware metrics
   */
  getMetrics(): any {
    return {
      totalMiddlewares: this.middlewares.length,
      enabledCount: this.middlewares.filter(m => m.config.enabled !== false).length,
      byStage: {
        pre: this.middlewares.filter(m => m.config.stage === 'pre').length,
        post: this.middlewares.filter(m => m.config.stage === 'post').length,
        error: this.middlewares.filter(m => m.config.stage === 'error').length
      }
    };
  }

  /**
   * Clear all middlewares
   */
  clear(): void {
    this.middlewares = [];
  }

  /**
   * Clone the pipeline
   */
  clone(): TypedMiddlewarePipeline<TContext> {
    const clone = new TypedMiddlewarePipeline<TContext>();
    clone.middlewares = [...this.middlewares];
    return clone;
  }
}

/**
 * Built-in middleware factories
 */
export class TypedMiddlewareFactory {
  /**
   * Authentication middleware
   */
  static auth<T extends TypedHttpMiddlewareContext>(
    validator: (ctx: T) => Promise<boolean> | boolean
  ): TypedMiddleware<T> {
    return async (ctx, next) => {
      const isValid = await validator(ctx);
      if (!isValid) {
        throw new TitanError({
          code: ErrorCode.UNAUTHORIZED,
          message: 'Authentication required'
        });
      }
      await next();
    };
  }

  /**
   * Rate limiting middleware
   */
  static rateLimit<T extends TypedHttpMiddlewareContext>(
    limit: number,
    window: number = 60000
  ): TypedMiddleware<T> {
    const requests = new Map<string, { count: number; resetAt: number }>();

    return async (ctx, next) => {
      const metadata = ctx.metadata as any;
      const userId = metadata instanceof TypedMetadata ? metadata.userId : metadata.get('userId');
      const requestId = metadata instanceof TypedMetadata ? metadata.requestId : metadata.get('requestId');
      const key = userId || requestId || 'global';
      const now = Date.now();

      let entry = requests.get(key);
      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + window };
        requests.set(key, entry);
      }

      if (entry.count >= limit) {
        throw new TitanError({
          code: ErrorCode.TOO_MANY_REQUESTS,
          message: 'Rate limit exceeded',
          details: {
            limit,
            window,
            resetAt: entry.resetAt
          }
        });
      }

      entry.count++;
      await next();
    };
  }

  /**
   * Logging middleware
   */
  static logging<T extends TypedHttpMiddlewareContext>(
    logger: {
      info: (data: any, msg: string) => void;
      error: (data: any, msg: string) => void;
    }
  ): TypedMiddleware<T> {
    return async (ctx, next) => {
      const start = Date.now();

      logger.info({
        service: ctx.service,
        method: ctx.method,
        input: ctx.input
      }, 'Request started');

      try {
        await next();

        logger.info({
          service: ctx.service,
          method: ctx.method,
          output: ctx.output,
          duration: Date.now() - start
        }, 'Request completed');
      } catch (error) {
        logger.error({
          service: ctx.service,
          method: ctx.method,
          error,
          duration: Date.now() - start
        }, 'Request failed');

        throw error;
      }
    };
  }

  /**
   * Validation middleware
   */
  static validation<T extends TypedHttpMiddlewareContext>(
    inputSchema?: any,
    outputSchema?: any
  ): TypedMiddleware<T> {
    return async (ctx, next) => {
      // Validate input
      if (inputSchema && ctx.input) {
        const validation = inputSchema.safeParse(ctx.input);
        if (!validation.success) {
          throw new TitanError({
            code: ErrorCode.INVALID_ARGUMENT,
            message: 'Input validation failed',
            details: validation.error
          });
        }
        ctx.input = validation.data;
      }

      await next();

      // Validate output
      if (outputSchema && ctx.output) {
        const validation = outputSchema.safeParse(ctx.output);
        if (!validation.success) {
          throw new TitanError({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Output validation failed',
            details: validation.error
          });
        }
        ctx.output = validation.data;
      }
    };
  }

  /**
   * Caching middleware
   */
  static caching<T extends TypedHttpMiddlewareContext>(
    cache: Map<string, any>,
    options: { ttl?: number; keyFn?: (ctx: T) => string } = {}
  ): TypedMiddleware<T> {
    const { ttl = 60000, keyFn = (ctx) => `${ctx.service}.${String(ctx.method)}:${JSON.stringify(ctx.input)}` } = options;

    return async (ctx, next) => {
      const key = keyFn(ctx);
      const cached = cache.get(key);

      if (cached && cached.expiresAt > Date.now()) {
        ctx.output = cached.data;
        const metadata = ctx.metadata as any;
        if (metadata instanceof TypedMetadata) {
          metadata.cacheHit = true;
        } else {
          metadata.set('cacheHit', true);
        }
        return;
      }

      await next();

      if (ctx.output !== undefined) {
        cache.set(key, {
          data: ctx.output,
          expiresAt: Date.now() + ttl
        });
      }
    };
  }

  /**
   * Retry middleware
   */
  static retry<T extends TypedHttpMiddlewareContext>(
    options: { attempts?: number; delay?: number; backoff?: number } = {}
  ): TypedMiddleware<T> {
    const { attempts = 3, delay = 1000, backoff = 2 } = options;

    return async (ctx, next) => {
      let lastError: Error | undefined;
      let currentDelay = delay;

      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await next();
          return;
        } catch (error: any) {
          lastError = error;

          // Don't retry on client errors
          if (error.code && error.code >= 400 && error.code < 500) {
            throw error;
          }

          if (attempt < attempts - 1) {
            await new Promise(resolve => setTimeout(resolve, currentDelay));
            currentDelay *= backoff;
          }
        }
      }

      throw lastError;
    };
  }

  /**
   * Transform middleware
   */
  static transform<T extends TypedHttpMiddlewareContext>(
    inputTransform?: (input: any) => any,
    outputTransform?: (output: any) => any
  ): TypedMiddleware<T> {
    return async (ctx, next) => {
      if (inputTransform && ctx.input) {
        ctx.input = inputTransform(ctx.input);
      }

      await next();

      if (outputTransform && ctx.output) {
        ctx.output = outputTransform(ctx.output);
      }
    };
  }

  /**
   * Timeout middleware
   */
  static timeout<T extends TypedHttpMiddlewareContext>(
    ms: number
  ): TypedMiddleware<T> {
    return async (ctx, next) => {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new TitanError({
          code: ErrorCode.REQUEST_TIMEOUT,
          message: `Request timeout after ${ms}ms`
        })), ms);
      });

      await Promise.race([next(), timeoutPromise]);
    };
  }
}

/**
 * Create a typed middleware pipeline
 */
export function createTypedPipeline<T extends NetronMiddlewareContext = NetronMiddlewareContext>(): TypedMiddlewarePipeline<T> {
  return new TypedMiddlewarePipeline<T>();
}