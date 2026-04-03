/**
 * Error factory functions for common error patterns
 * Browser-compatible version of Titan's error factories
 */

import { TitanError } from './core.js';
import { ErrorCode } from './codes.js';
import {
  ServiceNotFoundError,
  MethodNotFoundError,
  TransportError,
  PeerError,
  RpcError,
  StreamError,
  SerializationError,
} from './netron.js';

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
  tooManyRequests(retryAfter?: number): TitanError {
    return new TitanError({
      code: ErrorCode.TOO_MANY_REQUESTS,
      message: 'Too many requests',
      details: { retryAfter },
    });
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
