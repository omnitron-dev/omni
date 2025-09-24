/**
 * Core error classes and utilities
 */

import {
  ErrorCode,
  ErrorCategory,
  getErrorCategory,
  getErrorName,
  getDefaultMessage,
  isRetryableError
} from './codes.js';

/**
 * Error context information
 */
export interface ErrorContext {
  requestId?: string;
  userId?: string;
  service?: string;
  method?: string;
  timestamp?: number;
  [key: string]: any;
}

/**
 * Retry strategy for errors
 */
export interface RetryStrategy {
  shouldRetry: boolean;
  delay: number;
  maxAttempts: number;
  backoffFactor?: number;
}

/**
 * Error creation options
 */
export interface ErrorOptions {
  code: ErrorCode | number;
  message?: string;
  details?: any;
  cause?: Error | unknown;
  context?: ErrorContext;
  requestId?: string;
  correlationId?: string;
  spanId?: string;
  traceId?: string;
}

/**
 * Error statistics
 */
interface ErrorStatistics {
  totalErrors: number;
  byCode: Record<number, number>;
  byCategory: Record<string, number>;
  lastReset: number;
}

/**
 * Error metrics configuration
 */
export interface MetricsOptions {
  window?: '1m' | '5m' | '15m' | '1h';
  groupBy?: Array<'code' | 'category' | 'service'>;
}

/**
 * Main TitanError class - the core of the error system
 */
export class TitanError extends Error {
  public readonly code: ErrorCode | number;
  public readonly category: ErrorCategory;
  public readonly httpStatus: number;
  public readonly details: any;
  public readonly context: ErrorContext;
  public readonly timestamp: number;
  public readonly requestId?: string;
  public readonly correlationId?: string;
  public readonly spanId?: string;
  public readonly traceId?: string;

  // Error statistics tracking
  private static stats: ErrorStatistics = {
    totalErrors: 0,
    byCode: {},
    byCategory: {},
    lastReset: Date.now()
  };

  // Error instance cache for common errors
  private static cache = new Map<ErrorCode, TitanError>();

  // Object pool for temporary errors
  private static pools = new Map<string, ErrorPool>();

  constructor(options: ErrorOptions) {
    const message = options.message || getDefaultMessage(options.code);
    super(message);

    this.name = 'TitanError';
    this.code = options.code;
    this.category = getErrorCategory(options.code);
    this.httpStatus = options.code;
    this.details = options.details || {};
    this.context = options.context || {};
    this.timestamp = Date.now();
    this.requestId = options.requestId;
    this.correlationId = options.correlationId;
    this.spanId = options.spanId;
    this.traceId = options.traceId;

    // Set cause if provided
    if (options.cause) {
      (this as any).cause = options.cause;
    }

    // Capture stack trace
    Error.captureStackTrace(this, TitanError);

    // If there's a cause, append its message to the stack
    if (options.cause instanceof Error && options.cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${options.cause.stack}`;
    }

    // Update statistics
    TitanError.updateStatistics(this);
  }

  /**
   * Check if an object is a TitanError
   */
  static isTitanError(error: any): error is TitanError {
    return error instanceof TitanError;
  }

  /**
   * Get a cached instance for common errors
   */
  static getCached(code: ErrorCode): TitanError {
    if (!this.cache.has(code)) {
      this.cache.set(code, new TitanError({ code }));
    }
    return this.cache.get(code)!;
  }

  /**
   * Create an error pool for efficient error object reuse
   */
  static createPool(options: { size: number; name?: string }): ErrorPool {
    const pool = new ErrorPool(options.size);
    if (options.name) {
      this.pools.set(options.name, pool);
    }
    return pool;
  }

  /**
   * Update error statistics
   */
  private static updateStatistics(error: TitanError): void {
    this.stats.totalErrors++;
    this.stats.byCode[error.code] = (this.stats.byCode[error.code] || 0) + 1;
    this.stats.byCategory[error.category] = (this.stats.byCategory[error.category] || 0) + 1;
  }

  /**
   * Get error statistics
   */
  static getStatistics(): ErrorStatistics {
    return { ...this.stats, byCode: { ...this.stats.byCode }, byCategory: { ...this.stats.byCategory } };
  }

  /**
   * Get error metrics
   */
  static getMetrics(options: MetricsOptions): any {
    const now = Date.now();
    const windowMs = {
      '1m': 60000,
      '5m': 300000,
      '15m': 900000,
      '1h': 3600000
    }[options.window || '1m'];

    const elapsed = now - this.stats.lastReset;
    const rate = this.stats.totalErrors / (elapsed / 1000); // errors per second

    const topErrors = Object.entries(this.stats.byCode)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => ({
        code: parseInt(code),
        name: getErrorName(parseInt(code)),
        count
      }));

    return {
      rate,
      totalErrors: this.stats.totalErrors,
      topErrors,
      byCategory: { ...this.stats.byCategory },
      window: options.window,
      elapsed
    };
  }

  /**
   * Reset error statistics
   */
  static resetStatistics(): void {
    this.stats = {
      totalErrors: 0,
      byCode: {},
      byCategory: {},
      lastReset: Date.now()
    };
  }

  /**
   * Aggregate multiple errors
   */
  static aggregate(errors: TitanError[], options?: { deduplicate?: boolean }): AggregateError {
    return new AggregateError(errors, options);
  }

  /**
   * Check if this error is retryable
   */
  isRetryable(): boolean {
    return isRetryableError(this.code);
  }

  /**
   * Get retry strategy for this error
   */
  getRetryStrategy(): RetryStrategy {
    if (!this.isRetryable()) {
      return { shouldRetry: false, delay: 0, maxAttempts: 0 };
    }

    // Special handling for rate limit errors
    if (this.code === ErrorCode.TOO_MANY_REQUESTS) {
      const retryAfter = this.details?.retryAfter || 60;
      return {
        shouldRetry: true,
        delay: retryAfter * 1000,
        maxAttempts: 3
      };
    }

    // Default exponential backoff for other retryable errors
    return {
      shouldRetry: true,
      delay: 1000, // Start with 1 second
      maxAttempts: 3,
      backoffFactor: 2
    };
  }

  /**
   * Convert to JSON representation
   */
  toJSON(): any {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
      context: this.context,
      timestamp: this.timestamp,
      requestId: this.requestId,
      correlationId: this.correlationId,
      spanId: this.spanId,
      traceId: this.traceId
    };
  }

  /**
   * Create a new error with additional context
   */
  withContext(context: ErrorContext): TitanError {
    return new TitanError({
      code: this.code,
      message: this.message,
      details: this.details,
      context: { ...this.context, ...context },
      requestId: this.requestId,
      correlationId: this.correlationId,
      spanId: this.spanId,
      traceId: this.traceId
    });
  }

  /**
   * Create a new error with additional details
   */
  withDetails(details: any): TitanError {
    return new TitanError({
      code: this.code,
      message: this.message,
      details: { ...this.details, ...details },
      context: this.context,
      requestId: this.requestId,
      correlationId: this.correlationId,
      spanId: this.spanId,
      traceId: this.traceId
    });
  }
}

/**
 * Aggregate error for multiple errors
 */
export class AggregateError extends TitanError {
  public readonly errors: TitanError[];
  public readonly summary: string;

  constructor(errors: TitanError[], options?: { deduplicate?: boolean }) {
    let processedErrors = errors;

    // Deduplicate if requested
    if (options?.deduplicate) {
      const seen = new Set<string>();
      processedErrors = errors.filter(error => {
        const key = `${error.code}-${error.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const summary = `${processedErrors.length} errors occurred`;

    super({
      code: ErrorCode.MULTIPLE_ERRORS,
      message: summary,
      details: {
        errors: processedErrors.map(e => e.toJSON()),
        count: processedErrors.length
      }
    });

    this.name = 'AggregateError';
    this.errors = processedErrors;
    this.summary = summary;
  }
}

/**
 * Object pool for efficient error object reuse
 */
export class ErrorPool {
  private pool: TitanError[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
    // Pre-allocate error objects
    for (let i = 0; i < maxSize; i++) {
      this.pool.push(new TitanError({ code: ErrorCode.INTERNAL_ERROR }));
    }
  }

  get size(): number {
    return this.pool.length;
  }

  acquire(code: ErrorCode, message?: string): TitanError {
    let error = this.pool.pop();
    if (!error) {
      error = new TitanError({ code, message });
    } else {
      // Reset the error by modifying its properties
      const titanError = error as any;
      titanError.code = code;
      titanError.httpStatus = code;
      titanError.message = message || getDefaultMessage(code);
      titanError.category = getErrorCategory(code);
      titanError.details = {};
      titanError.context = {};
      titanError.timestamp = Date.now();
      titanError.requestId = undefined;
      titanError.correlationId = undefined;
      titanError.spanId = undefined;
      titanError.traceId = undefined;
    }
    return error;
  }

  release(error: TitanError): void {
    if (this.pool.length < this.maxSize) {
      this.pool.push(error);
    }
  }
}

/**
 * Helper function to create errors
 */
export function createError(options: ErrorOptions): TitanError {
  return new TitanError(options);
}

/**
 * Type guard to check error code
 */
export function isErrorCode(error: any, code: ErrorCode): boolean {
  return TitanError.isTitanError(error) && error.code === code;
}

/**
 * Create an error from an unknown value
 */
export function ensureError(value: unknown): TitanError {
  if (TitanError.isTitanError(value)) {
    return value;
  }

  if (value instanceof Error) {
    return new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: value.message,
      cause: value
    });
  }

  return new TitanError({
    code: ErrorCode.UNKNOWN_ERROR,
    message: String(value)
  });
}