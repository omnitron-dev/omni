/**
 * Error factory functions for common error patterns
 *
 * These factories provide convenient shortcuts for creating commonly used errors
 * across the Titan framework.
 */

import { TitanError } from './core.js';
import { ErrorCode } from './codes.js';
import { ValidationError } from './validation.js';
import {
  ServiceNotFoundError,
  MethodNotFoundError,
  TransportError,
  PeerError,
  RpcError,
  StreamError,
  SerializationError,
} from './netron.js';
import { HttpError, AuthError, PermissionError, RateLimitError } from './http.js';

/**
 * Common error factories
 */
export const Errors = {
  /**
   * Create a generic error
   */
  create(code: ErrorCode, message: string, details?: any): TitanError {
    return new TitanError({ code, message, details });
  },

  /**
   * Bad request error
   */
  badRequest(message = 'Bad request', details?: any): TitanError {
    return new TitanError({
      code: ErrorCode.BAD_REQUEST,
      message,
      details,
    });
  },

  /**
   * Unauthorized error
   */
  unauthorized(message = 'Unauthorized', details?: any): TitanError {
    return new TitanError({
      code: ErrorCode.UNAUTHORIZED,
      message,
      details,
    });
  },

  /**
   * Forbidden error
   */
  forbidden(message = 'Forbidden', details?: any): TitanError {
    return new TitanError({
      code: ErrorCode.FORBIDDEN,
      message,
      details,
    });
  },

  /**
   * Not found error
   */
  notFound(resource: string, id?: string): TitanError {
    const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
    return new TitanError({
      code: ErrorCode.NOT_FOUND,
      message,
      details: { resource, id },
    });
  },

  /**
   * Conflict error
   */
  conflict(message: string, details?: any): TitanError {
    return new TitanError({
      code: ErrorCode.CONFLICT,
      message,
      details,
    });
  },

  /**
   * Validation error from field errors
   */
  validation(errors: Array<{ field: string; message: string; code?: string }>): ValidationError {
    return ValidationError.fromFieldErrors(errors);
  },

  /**
   * Internal error
   */
  internal(message = 'Internal server error', cause?: Error): TitanError {
    return new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message,
      cause,
    });
  },

  /**
   * Timeout error
   */
  timeout(operation: string, timeoutMs: number): TitanError {
    return new TitanError({
      code: ErrorCode.REQUEST_TIMEOUT,
      message: `${operation} timed out after ${timeoutMs}ms`,
      details: { operation, timeout: timeoutMs },
    });
  },

  /**
   * Service unavailable error
   */
  unavailable(service: string, reason?: string): TitanError {
    return new TitanError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Service ${service} is unavailable${reason ? `: ${reason}` : ''}`,
      details: { service, reason },
    });
  },

  /**
   * Too many requests error
   */
  tooManyRequests(retryAfter?: number): RateLimitError {
    return new RateLimitError('Too many requests', undefined, { retryAfter });
  },

  /**
   * Not implemented error
   */
  notImplemented(feature: string): TitanError {
    return new TitanError({
      code: ErrorCode.NOT_IMPLEMENTED,
      message: `${feature} is not implemented`,
      details: { feature },
    });
  },
};

/**
 * Netron-specific error factories
 */
export const NetronErrors = {
  /**
   * Service not found
   */
  serviceNotFound(serviceId: string): ServiceNotFoundError {
    return ServiceNotFoundError.create(serviceId);
  },

  /**
   * Method not found
   */
  methodNotFound(serviceId: string, methodName: string): MethodNotFoundError {
    return MethodNotFoundError.create(serviceId, methodName);
  },

  /**
   * Connection failed
   */
  connectionFailed(transport: string, address: string, cause?: Error): TransportError {
    return TransportError.connectionFailed(transport, address, cause);
  },

  /**
   * Connection timeout
   */
  connectionTimeout(transport: string, address: string): TransportError {
    return TransportError.connectionTimeout(transport, address);
  },

  /**
   * Connection closed
   */
  connectionClosed(transport: string, reason?: string): TransportError {
    return TransportError.connectionClosed(transport, reason);
  },

  /**
   * Peer not found
   */
  peerNotFound(peerId: string): PeerError {
    return PeerError.notFound(peerId);
  },

  /**
   * Peer disconnected
   */
  peerDisconnected(peerId: string, reason?: string): PeerError {
    return PeerError.disconnected(peerId, reason);
  },

  /**
   * Peer unauthorized
   */
  peerUnauthorized(peerId: string): PeerError {
    return PeerError.unauthorized(peerId);
  },

  /**
   * RPC timeout
   */
  rpcTimeout(serviceId: string, methodName: string, timeoutMs: number): RpcError {
    return RpcError.timeout(serviceId, methodName, timeoutMs);
  },

  /**
   * Invalid RPC request
   */
  invalidRequest(reason: string, details?: any): RpcError {
    return RpcError.invalidRequest(reason, details);
  },

  /**
   * Invalid RPC response
   */
  invalidResponse(serviceId: string, methodName: string, details?: any): RpcError {
    return RpcError.invalidResponse(serviceId, methodName, details);
  },

  /**
   * Stream closed
   */
  streamClosed(streamId: string, reason?: string): StreamError {
    return StreamError.closed(streamId, reason);
  },

  /**
   * Stream error
   */
  streamError(streamId: string, error: Error): StreamError {
    return StreamError.error(streamId, error);
  },

  /**
   * Stream backpressure
   */
  streamBackpressure(streamId: string, bufferSize: number): StreamError {
    return StreamError.backpressure(streamId, bufferSize);
  },

  /**
   * Serialization encode error
   */
  serializeEncode(value: any, cause?: Error): SerializationError {
    return SerializationError.encode(value, cause);
  },

  /**
   * Serialization decode error
   */
  serializeDecode(data: any, cause?: Error): SerializationError {
    return SerializationError.decode(data, cause);
  },
};

/**
 * HTTP-specific error factories
 */
export const HttpErrors = {
  /**
   * Create HTTP error from status code
   */
  fromStatus(statusCode: number, message?: string, details?: any): HttpError {
    return HttpError.fromStatus(statusCode, message, details);
  },

  /**
   * Bad request
   */
  badRequest(message = 'Bad Request', details?: any): HttpError {
    return HttpError.badRequest(message, details);
  },

  /**
   * Unauthorized
   */
  unauthorized(message = 'Unauthorized', details?: any): HttpError {
    return HttpError.unauthorized(message, details);
  },

  /**
   * Forbidden
   */
  forbidden(message = 'Forbidden', details?: any): HttpError {
    return HttpError.forbidden(message, details);
  },

  /**
   * Not found
   */
  notFound(message = 'Not Found', details?: any): HttpError {
    return HttpError.notFound(message, details);
  },

  /**
   * Conflict
   */
  conflict(message = 'Conflict', details?: any): HttpError {
    return HttpError.conflict(message, details);
  },

  /**
   * Too many requests
   */
  tooManyRequests(retryAfter?: number): RateLimitError {
    return new RateLimitError('Too many requests', undefined, { retryAfter });
  },

  /**
   * Internal server error
   */
  internal(message = 'Internal Server Error', details?: any): HttpError {
    return HttpError.internalServerError(message, details);
  },
};

/**
 * Auth-specific error factories
 */
export const AuthErrors = {
  /**
   * Bearer token required
   */
  bearerTokenRequired(realm = 'api'): AuthError {
    return AuthError.bearerTokenRequired(realm);
  },

  /**
   * Invalid token
   */
  invalidToken(reason?: string): AuthError {
    return AuthError.invalidToken(reason);
  },

  /**
   * Token expired
   */
  tokenExpired(): AuthError {
    return AuthError.tokenExpired();
  },

  /**
   * Insufficient permissions
   */
  insufficientPermissions(required: string, userPermissions?: string[]): PermissionError {
    return PermissionError.insufficientPermissions(required, userPermissions);
  },
};

/**
 * Convert any error to TitanError
 */
export function toTitanError(error: unknown): TitanError {
  if (error instanceof TitanError) {
    return error;
  }

  if (error instanceof Error) {
    return new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: error.message,
      cause: error,
    });
  }

  return new TitanError({
    code: ErrorCode.UNKNOWN_ERROR,
    message: String(error),
  });
}

/**
 * Assert condition and throw error if false
 */
export function assert(condition: boolean, errorOrMessage: TitanError | string, details?: any): asserts condition {
  if (!condition) {
    if (typeof errorOrMessage === 'string') {
      throw new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: errorOrMessage,
        details,
      });
    }
    throw errorOrMessage;
  }
}

/**
 * Throw if value is null or undefined
 */
export function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message,
    });
  }
}

/**
 * Throw if value doesn't match expected type
 */
export function assertType<T>(
  value: unknown,
  check: (value: unknown) => value is T,
  message: string
): asserts value is T {
  if (!check(value)) {
    throw new TitanError({
      code: ErrorCode.BAD_REQUEST,
      message,
    });
  }
}
