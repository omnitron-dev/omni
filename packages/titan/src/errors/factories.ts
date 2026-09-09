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
  TransportLostError,
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
   * Resource already exists error
   */
  alreadyExists(resource: string, identifier?: string): TitanError {
    const message = identifier ? `${resource} '${identifier}' already exists` : `${resource} already exists`;
    return new TitanError({
      code: ErrorCode.CONFLICT,
      message,
      details: { resource, identifier },
    });
  },

  /**
   * Invalid credentials error
   */
  invalidCredentials(message = 'Invalid credentials'): TitanError {
    return new TitanError({
      code: ErrorCode.UNAUTHORIZED,
      message,
      details: { type: 'invalid_credentials' },
    });
  },

  /**
   * Permission denied error
   */
  permissionDenied(permission: string): TitanError {
    return new TitanError({
      code: ErrorCode.FORBIDDEN,
      message: `Permission denied: ${permission}`,
      details: { requiredPermission: permission },
    });
  },

  /**
   * Validation error from field errors
   */
  validation(
    errors: Array<{ field: string; message: string; code?: string }>,
    options?: {
      message?: string;
      code?: ErrorCode;
    }
  ): ValidationError {
    return ValidationError.fromFieldErrors(errors, options);
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
   * Transport lost while RPCs were in flight.
   *
   * Signals that the request neither succeeded nor explicitly failed —
   * the underlying connection vanished mid-call. Idempotent operations
   * may safely retry; non-idempotent ones must surface the failure.
   */
  transportLost(transport: string, peerId: string, pendingPacketId?: number, reason?: string): TransportLostError {
    return TransportLostError.fromTransport(transport, peerId, pendingPacketId, reason);
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
 * Convert any error to TitanError.
 *
 * Preserves HTTP status codes from application errors that define a `status`
 * property (e.g., MessagingError, StorageError).  This ensures the correct
 * HTTP status is returned to clients (401/403/404/409/429/etc.) instead of
 * collapsing everything into a generic 500 INTERNAL_ERROR.
 */
/**
 * Recognise a Zod validation failure without an `instanceof` check.
 *
 * `instanceof` is unreliable here: the application's zod and the one titan
 * depends on can be different copies, and the check would then quietly fail on
 * exactly the errors it exists to catch. Zod's own error carries a stable
 * `name` and an `issues` array, which is what is matched instead. Duck-typing
 * is also what the branch below already does for `.status` / `.statusCode`.
 */
function isValidationError(error: Error): error is Error & { issues: unknown[] } {
  return error.name === 'ZodError' && Array.isArray((error as { issues?: unknown }).issues);
}

/**
 * A Postgres (or compatible driver) error, as opposed to a business error that
 * happens to carry a `code`.
 *
 * SQLSTATE is five characters of `[0-9A-Z]`, which alone would also match a
 * short business code, so a driver-specific field has to be present too: `pg`
 * sets `severity` on every error it raises and `routine` on most. Requiring one
 * of them keeps a hand-written `code: 'ADMIN'` out of this branch.
 */
function isDatabaseError(error: unknown): boolean {
  const e = error as { code?: unknown; severity?: unknown; routine?: unknown };
  return (
    typeof e.code === 'string' &&
    /^[0-9A-Z]{5}$/.test(e.code) &&
    (typeof e.severity === 'string' || typeof e.routine === 'string')
  );
}

export function toTitanError(error: unknown): TitanError {
  if (error instanceof TitanError) {
    return error;
  }

  if (error instanceof Error) {
    // A payload the caller got wrong is a 400, not a 500. Without this the
    // fallback below made every schema failure an internal error: the client
    // cannot tell "I sent the wrong thing" from "the server broke", monitoring
    // counts user typos as incidents, and any retry policy keyed on 5xx
    // re-sends a request that can never succeed. Observed on daos's
    // `Content.createPost`, where an invalid `type` came back as code 500 with
    // the Zod issue list as its message.
    if (isValidationError(error)) {
      return new TitanError({
        code: ErrorCode.BAD_REQUEST,
        message: 'Request validation failed',
        cause: error,
        details: { errorCode: 'VALIDATION', issues: error.issues },
      });
    }

    // A driver error is not a business error, and its message is not ours to
    // forward. `pg` puts the offending VALUE in the text — "invalid input
    // syntax for type uuid: {\"userId\":\"019f25eb-…\"}" — and a constraint
    // violation names the index: "duplicate key value violates unique
    // constraint \"content_reports_one_per_reporter_idx\"". Passed through, that
    // hands any caller the column types, the constraint names and the values
    // that tripped them, which is a free map of the schema for whoever is
    // probing it.
    //
    // The full error still travels as `cause`, so server-side logs and the
    // handlers that catch a 23505 to translate it lose nothing. What changes is
    // only what crosses the wire.
    if (isDatabaseError(error)) {
      // SQLSTATE says whose fault it was, and the class prefix is enough.
      //
      // Class 22 — data exception. `22P02 invalid_text_representation` is
      // what a non-UUID in a uuid column raises, and 22003/22007/22001 are
      // the numeric, datetime and length equivalents. The VALUE was wrong,
      // so this is the caller's error, not a fault.
      //
      // Class 23 — integrity constraint violation. The request is
      // well-formed and conflicts with what is already stored: a duplicate
      // key, a missing referent, a failed check. That is a conflict, and
      // handlers that catch a raw 23505 to translate it still can, because
      // `cause` carries the original.
      //
      // Everything else — connection failures, syntax errors, internal
      // driver faults — stays a 500, because it is one.
      //
      // Measured before this existed: 94 of 618 read-shaped @Public methods
      // across the six daos backends answered 5xx to a malformed argument,
      // nearly all of them a uuid parse reaching Postgres. A 500 tells the
      // client the server broke, keeps a retry policy re-sending a request
      // that can never succeed, and buries real incidents in a monitoring
      // signal made mostly of typos.
      //
      // The message stays masked either way — see the note above; only the
      // STATUS changes.
      const sqlstate = String((error as { code?: unknown }).code ?? '');
      if (sqlstate.startsWith('22')) {
        return new TitanError({
          code: ErrorCode.BAD_REQUEST,
          message: 'A value in the request could not be interpreted',
          cause: error,
          details: { errorCode: 'DATABASE_INPUT' },
        });
      }
      if (sqlstate.startsWith('23')) {
        return new TitanError({
          code: ErrorCode.CONFLICT,
          message: 'The request conflicts with existing data',
          cause: error,
          details: { errorCode: 'DATABASE_CONSTRAINT' },
        });
      }
      return new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'A database error occurred',
        cause: error,
        details: { errorCode: 'DATABASE_ERROR' },
      });
    }

    // Check both .status (Express-style) and .statusCode (AppError-style) for HTTP semantics.
    const status = ((error as any).status ?? (error as any).statusCode) as number | undefined;
    const httpCode =
      status && status >= 400 && status < 600 && status in ErrorCode ? (status as ErrorCode) : ErrorCode.INTERNAL_ERROR;

    // Preserve the business error code (e.g., "SESSION_EXPIRED", "TOKEN_EXPIRED")
    // so the transport layer can forward it to clients for precise error handling.
    const businessCode = (error as any).code as string | undefined;
    const details = (error as any).details ?? {};

    return new TitanError({
      code: httpCode,
      message: error.message,
      cause: error,
      details: businessCode ? { ...details, errorCode: businessCode } : details,
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
