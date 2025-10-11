/**
 * Error Transformation Middleware
 *
 * Transforms and normalizes errors from RPC calls
 */

import type { MiddlewareFunction } from '../types.js';

/**
 * Normalized error structure
 */
export interface NormalizedError {
  code: string;
  message: string;
  details?: any;
  stack?: string;
  service?: string;
  method?: string;
  timestamp?: number;
}

/**
 * Error transformer function
 */
export type ErrorTransformer = (
  error: Error,
  ctx: {
    service: string;
    method: string;
    transport: 'http' | 'websocket';
  }
) => NormalizedError | Error;

/**
 * Error handler function
 */
export type ErrorHandler = (error: NormalizedError) => void;

/**
 * Error transformation middleware options
 */
export interface ErrorTransformMiddlewareOptions {
  /**
   * Custom error transformer
   */
  transformer?: ErrorTransformer;

  /**
   * Error handler for reporting/logging
   */
  onError?: ErrorHandler;

  /**
   * Include stack traces in normalized errors
   * @default true
   */
  includeStack?: boolean;

  /**
   * Include service/method info in error
   * @default true
   */
  includeContext?: boolean;

  /**
   * Map of error codes to user-friendly messages
   */
  errorMessages?: Record<string, string>;

  /**
   * Skip transformation for specific services
   */
  skipServices?: string[];

  /**
   * Skip transformation for specific methods
   */
  skipMethods?: string[];
}

/**
 * Default error transformer
 */
export function defaultErrorTransformer(
  error: Error,
  ctx: { service: string; method: string; transport: 'http' | 'websocket' },
  options: {
    includeStack?: boolean;
    includeContext?: boolean;
    errorMessages?: Record<string, string>;
  } = {}
): NormalizedError {
  const { includeStack = true, includeContext = true, errorMessages = {} } = options;

  // Extract error code if available
  const code =
    (error as any).code || (error as any).errorCode || 'UNKNOWN_ERROR';

  // Get message (use custom message if available)
  const message = errorMessages[code] || error.message || 'An error occurred';

  const normalized: NormalizedError = {
    code,
    message,
    timestamp: Date.now(),
  };

  // Add stack if enabled
  if (includeStack && error.stack) {
    normalized.stack = error.stack;
  }

  // Add context if enabled
  if (includeContext) {
    normalized.service = ctx.service;
    normalized.method = ctx.method;
  }

  // Add details if available
  if ((error as any).details) {
    normalized.details = (error as any).details;
  }

  return normalized;
}

/**
 * Create error transformation middleware
 */
export function createErrorTransformMiddleware(
  options: ErrorTransformMiddlewareOptions = {}
): MiddlewareFunction {
  const {
    transformer,
    onError,
    includeStack = true,
    includeContext = true,
    errorMessages = {},
    skipServices = [],
    skipMethods = [],
  } = options;

  return async (ctx, next) => {
    // Skip if service or method is in skip list
    if (
      skipServices.includes(ctx.service) ||
      skipMethods.includes(`${ctx.service}.${ctx.method}`)
    ) {
      return next();
    }

    try {
      await next();
    } catch (error: any) {
      // Transform error
      const transformedError = transformer
        ? transformer(error, {
            service: ctx.service,
            method: ctx.method,
            transport: ctx.transport,
          })
        : defaultErrorTransformer(
            error,
            {
              service: ctx.service,
              method: ctx.method,
              transport: ctx.transport,
            },
            { includeStack, includeContext, errorMessages }
          );

      // Store transformed error in context
      ctx.error = transformedError instanceof Error ? transformedError : error;
      ctx.metadata.set('error:transformed', true);
      ctx.metadata.set('error:normalized', transformedError);

      // Call error handler
      if (onError && !(transformedError instanceof Error)) {
        onError(transformedError);
      }

      // Re-throw error
      throw ctx.error;
    }
  };
}

/**
 * Common error code mappings
 */
export const CommonErrorMessages: Record<string, string> = {
  UNAUTHORIZED: 'You are not authorized to perform this action',
  FORBIDDEN: 'Access to this resource is forbidden',
  NOT_FOUND: 'The requested resource was not found',
  BAD_REQUEST: 'The request was invalid or malformed',
  TIMEOUT: 'The request timed out',
  NETWORK_ERROR: 'A network error occurred',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable',
  INTERNAL_ERROR: 'An internal error occurred',
  VALIDATION_ERROR: 'Validation failed',
  RATE_LIMIT_EXCEEDED: 'Rate limit exceeded, please try again later',
};

/**
 * Retry-able error checker
 */
export function isRetryableError(error: NormalizedError | Error): boolean {
  const code =
    error instanceof Error ? (error as any).code : error.code;

  const retryableCodes = [
    'TIMEOUT',
    'NETWORK_ERROR',
    'SERVICE_UNAVAILABLE',
    'RATE_LIMIT_EXCEEDED',
  ];

  return retryableCodes.includes(code);
}

/**
 * Client error checker (4xx)
 */
export function isClientError(error: NormalizedError | Error): boolean {
  const code =
    error instanceof Error ? (error as any).code : error.code;

  const clientErrorCodes = [
    'BAD_REQUEST',
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
  ];

  return clientErrorCodes.includes(code);
}

/**
 * Server error checker (5xx)
 */
export function isServerError(error: NormalizedError | Error): boolean {
  const code =
    error instanceof Error ? (error as any).code : error.code;

  const serverErrorCodes = ['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE'];

  return serverErrorCodes.includes(code);
}
