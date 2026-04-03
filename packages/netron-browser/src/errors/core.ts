/**
 * Core error classes and utilities for browser environment
 * Compatible with Titan's error system for protocol compatibility
 */

import { ErrorCode, ErrorCategory, getErrorCategory, getDefaultMessage, isRetryableError } from './codes.js';

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
 * Serialized error format for network transmission
 */
export interface SerializedError {
  name: string;
  code: number;
  category: string;
  message: string;
  details: any;
  context: ErrorContext;
  timestamp: number;
  requestId?: string;
  correlationId?: string;
  spanId?: string;
  traceId?: string;
  stack?: string;
}

/**
 * Main TitanError class - the core of the error system
 * Browser-compatible version without Node.js dependencies
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

    // Set the prototype explicitly for proper instanceof checks
    Object.setPrototypeOf(this, TitanError.prototype);

    // Capture stack trace (browser-compatible)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TitanError);
    }

    // If there's a cause, append its message to the stack
    if (options.cause instanceof Error && options.cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${options.cause.stack}`;
    }
  }

  /**
   * Check if an object is a TitanError
   */
  static isTitanError(error: any): error is TitanError {
    return error instanceof TitanError;
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
        maxAttempts: 3,
      };
    }

    // Default exponential backoff for other retryable errors
    return {
      shouldRetry: true,
      delay: 1000, // Start with 1 second
      maxAttempts: 3,
      backoffFactor: 2,
    };
  }

  /**
   * Convert to JSON representation (for serialization)
   */
  toJSON(): SerializedError {
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
      traceId: this.traceId,
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
      traceId: this.traceId,
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
      traceId: this.traceId,
    });
  }

  /**
   * Deserialize an error from JSON (received from network)
   */
  static fromJSON(data: SerializedError): TitanError {
    return new TitanError({
      code: data.code,
      message: data.message,
      details: data.details,
      context: data.context,
      requestId: data.requestId,
      correlationId: data.correlationId,
      spanId: data.spanId,
      traceId: data.traceId,
    });
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
      cause: value,
    });
  }

  return new TitanError({
    code: ErrorCode.UNKNOWN_ERROR,
    message: String(value),
  });
}
