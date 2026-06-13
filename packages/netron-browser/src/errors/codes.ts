/**
 * Standard error codes following HTTP semantics.
 *
 * SHARED-PROTO: the `ErrorCode` / `ErrorCategory` enums and the range
 * classifiers now come from @omnitron-dev/netron-protocol — the single source of
 * truth shared with the titan server, so the codes can no longer drift from the
 * wire contract (they previously had to be hand-kept "exactly matching Titan").
 * Re-exported here so existing `errors/codes.js` importers are unchanged. The
 * browser-local name/message/retryable helpers stay below.
 */
import {
  ErrorCode,
  ErrorCategory,
  getErrorCategory,
  isClientError,
  isServerError,
} from '@omnitron-dev/netron-protocol';
export { ErrorCode, ErrorCategory, getErrorCategory, isClientError, isServerError };

/**
 * Check if an error is retryable based on its code
 */
export function isRetryableError(code: ErrorCode | number): boolean {
  return (
    code === ErrorCode.REQUEST_TIMEOUT ||
    code === ErrorCode.TOO_MANY_REQUESTS ||
    code === ErrorCode.INTERNAL_SERVER_ERROR ||
    code === ErrorCode.BAD_GATEWAY ||
    code === ErrorCode.SERVICE_UNAVAILABLE ||
    code === ErrorCode.GATEWAY_TIMEOUT ||
    code === ErrorCode.INSUFFICIENT_STORAGE ||
    code === ErrorCode.NETWORK_AUTHENTICATION_REQUIRED
  );
}

/**
 * Get human-readable name for error code
 */
export function getErrorName(code: ErrorCode | number): string {
  const names: Record<number, string> = {
    200: 'OK',
    201: 'CREATED',
    204: 'NO_CONTENT',
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    408: 'REQUEST_TIMEOUT',
    409: 'CONFLICT',
    410: 'GONE',
    413: 'PAYLOAD_TOO_LARGE',
    414: 'URI_TOO_LONG',
    415: 'UNSUPPORTED_MEDIA_TYPE',
    418: 'IM_A_TEAPOT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'TOO_MANY_REQUESTS',
    500: 'INTERNAL_SERVER_ERROR',
    501: 'NOT_IMPLEMENTED',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT',
    507: 'INSUFFICIENT_STORAGE',
    600: 'MULTIPLE_ERRORS',
    601: 'UNKNOWN_ERROR',
  };

  return names[code] || `ERROR_${code}`;
}

/**
 * Get default message for error code
 */
export function getDefaultMessage(code: ErrorCode | number): string {
  const messages: Record<number, string> = {
    400: 'The request is invalid',
    401: 'Authentication is required',
    403: 'You do not have permission to access this resource',
    404: 'The requested resource was not found',
    405: 'The requested method is not allowed',
    408: 'The request timed out',
    409: 'A conflict occurred',
    413: 'The request payload is too large',
    414: 'The request URI is too long',
    415: 'The media type is not supported',
    418: "I'm a teapot",
    422: 'The request could not be processed',
    429: 'Too many requests, please try again later',
    500: 'An internal server error occurred',
    501: 'The requested functionality is not implemented',
    502: 'Bad gateway',
    503: 'The service is temporarily unavailable',
    504: 'Gateway timeout',
    600: 'Multiple errors occurred',
    601: 'An unknown error occurred',
  };

  return messages[code] || `Error ${code}`;
}
