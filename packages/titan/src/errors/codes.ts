/**
 * Standard error codes following HTTP semantics.
 *
 * SHARED-PROTO: the `ErrorCode` / `ErrorCategory` enums and the range
 * classifiers (`getErrorCategory` / `isClientError` / `isServerError`) now live
 * in @omnitron-dev/netron-protocol (the single source of truth shared with
 * netron-browser) and are re-exported here so titan's public
 * `@omnitron-dev/titan/errors` surface is unchanged. The titan-specific,
 * table-driven metadata helpers (ERROR_METADATA, toHttpStatus, getErrorName,
 * getDefaultMessage, isRetryableError) stay below.
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
 * Map an error code to a VALID HTTP status (XC-3).
 *
 * Standard codes (100–599) map to themselves; the custom Titan codes
 * (`MULTIPLE_ERRORS` = 600, `UNKNOWN_ERROR` = 601) and anything outside the HTTP
 * range fall back to 500 — 600/601 are NOT valid HTTP statuses and previously
 * leaked straight out of `TitanError.httpStatus` (and any HTTP response built
 * from it).
 */
export function toHttpStatus(code: ErrorCode | number): number {
  return code >= 100 && code < 600 ? code : 500;
}

/**
 * ERROR-TABLE: single source of truth for per-code error metadata.
 *
 * The code→name map, the code→message map, and the retryable-code list used to
 * live in three separate places that had to be hand-synced. They are now one
 * table; {@link getErrorName}, {@link getDefaultMessage}, and
 * {@link isRetryableError} all read from it. Range-derived facets — category
 * ({@link getErrorCategory}) and HTTP status ({@link toHttpStatus}) — stay as
 * functions because they must handle ARBITRARY numeric codes, not only the
 * enumerated ones.
 *
 * Every field is optional: an entry carries only what is curated for that code
 * (e.g. 511 is retryable but has no curated name/message, so callers fall back
 * to `ERROR_<code>` / `Error <code>` exactly as before).
 */
export interface ErrorMetadata {
  /** Human-readable UPPER_SNAKE name. */
  name?: string;
  /** Default human-readable message. */
  message?: string;
  /** Whether the error is safe to retry. */
  retryable?: boolean;
}

export const ERROR_METADATA: Readonly<Record<number, ErrorMetadata>> = {
  200: { name: 'OK' },
  201: { name: 'CREATED' },
  204: { name: 'NO_CONTENT' },
  400: { name: 'BAD_REQUEST', message: 'The request is invalid' },
  401: { name: 'UNAUTHORIZED', message: 'Authentication is required' },
  403: { name: 'FORBIDDEN', message: 'You do not have permission to access this resource' },
  404: { name: 'NOT_FOUND', message: 'The requested resource was not found' },
  405: { name: 'METHOD_NOT_ALLOWED', message: 'The requested method is not allowed' },
  408: { name: 'REQUEST_TIMEOUT', message: 'The request timed out', retryable: true },
  409: { name: 'CONFLICT', message: 'A conflict occurred' },
  410: { name: 'GONE' },
  413: { name: 'PAYLOAD_TOO_LARGE', message: 'The request payload is too large' },
  414: { name: 'URI_TOO_LONG', message: 'The request URI is too long' },
  415: { name: 'UNSUPPORTED_MEDIA_TYPE', message: 'The media type is not supported' },
  418: { name: 'IM_A_TEAPOT', message: "I'm a teapot" },
  422: { name: 'UNPROCESSABLE_ENTITY', message: 'The request could not be processed' },
  429: { name: 'TOO_MANY_REQUESTS', message: 'Too many requests, please try again later', retryable: true },
  500: { name: 'INTERNAL_SERVER_ERROR', message: 'An internal server error occurred', retryable: true },
  501: { name: 'NOT_IMPLEMENTED', message: 'The requested functionality is not implemented' },
  502: { name: 'BAD_GATEWAY', message: 'Bad gateway', retryable: true },
  503: { name: 'SERVICE_UNAVAILABLE', message: 'The service is temporarily unavailable', retryable: true },
  504: { name: 'GATEWAY_TIMEOUT', message: 'Gateway timeout', retryable: true },
  507: { name: 'INSUFFICIENT_STORAGE', retryable: true },
  511: { retryable: true }, // NETWORK_AUTHENTICATION_REQUIRED — retryable; name/message intentionally fall back
  600: { name: 'MULTIPLE_ERRORS', message: 'Multiple errors occurred' },
  601: { name: 'UNKNOWN_ERROR', message: 'An unknown error occurred' },
};

/**
 * Check if an error is retryable based on its code (driven by {@link ERROR_METADATA}).
 */
export function isRetryableError(code: ErrorCode | number): boolean {
  return ERROR_METADATA[code]?.retryable === true;
}

/**
 * Get human-readable name for error code (driven by {@link ERROR_METADATA}).
 */
export function getErrorName(code: ErrorCode | number): string {
  return ERROR_METADATA[code]?.name ?? `ERROR_${code}`;
}

/**
 * Get default message for error code (driven by {@link ERROR_METADATA}).
 */
export function getDefaultMessage(code: ErrorCode | number): string {
  return ERROR_METADATA[code]?.message ?? `Error ${code}`;
}
