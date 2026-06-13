/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
/**
 * Standard error codes based on HTTP status codes
 * These form the universal basis for all transport-specific error mappings
 */

/**
 * Standard error codes following HTTP semantics
 */
export enum ErrorCode {
  // 2xx Success (included for completeness, not errors)
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,

  // 4xx Client Errors
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  PAYMENT_REQUIRED = 402,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  NOT_ACCEPTABLE = 406,
  PROXY_AUTHENTICATION_REQUIRED = 407,
  REQUEST_TIMEOUT = 408,
  CONFLICT = 409,
  GONE = 410,
  LENGTH_REQUIRED = 411,
  PRECONDITION_FAILED = 412,
  PAYLOAD_TOO_LARGE = 413,
  URI_TOO_LONG = 414,
  UNSUPPORTED_MEDIA_TYPE = 415,
  RANGE_NOT_SATISFIABLE = 416,
  EXPECTATION_FAILED = 417,
  IM_A_TEAPOT = 418, // RFC 2324
  MISDIRECTED_REQUEST = 421,
  UNPROCESSABLE_ENTITY = 422,
  LOCKED = 423,
  FAILED_DEPENDENCY = 424,
  TOO_EARLY = 425,
  UPGRADE_REQUIRED = 426,
  PRECONDITION_REQUIRED = 428,
  TOO_MANY_REQUESTS = 429,
  REQUEST_HEADER_FIELDS_TOO_LARGE = 431,
  UNAVAILABLE_FOR_LEGAL_REASONS = 451,

  // 5xx Server Errors
  INTERNAL_SERVER_ERROR = 500,
  NOT_IMPLEMENTED = 501,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504,
  HTTP_VERSION_NOT_SUPPORTED = 505,
  VARIANT_ALSO_NEGOTIATES = 506,
  INSUFFICIENT_STORAGE = 507,
  LOOP_DETECTED = 508,
  NOT_EXTENDED = 510,
  NETWORK_AUTHENTICATION_REQUIRED = 511,

  // Custom error codes (600+)
  VALIDATION_ERROR = 422, // Using standard 422
  INVALID_ARGUMENT = 400, // Alias for BAD_REQUEST
  PERMISSION_DENIED = 403, // Alias for FORBIDDEN
  INTERNAL_ERROR = 500, // Alias for INTERNAL_SERVER_ERROR
  RATE_LIMITED = 429, // Alias for TOO_MANY_REQUESTS
  MULTIPLE_ERRORS = 600, // Custom: Multiple errors occurred
  UNKNOWN_ERROR = 601, // Custom: Unknown error
}

/**
 * Error categories for grouping related errors
 */
export enum ErrorCategory {
  SUCCESS = 'success', // 2xx
  CLIENT = 'client', // 4xx
  SERVER = 'server', // 5xx
  AUTH = 'auth', // 401, 403, 407
  VALIDATION = 'validation', // 400, 422
  RATE_LIMIT = 'rate_limit', // 429
  CUSTOM = 'custom', // 600+
}

/**
 * Map error codes to categories
 */
export function getErrorCategory(code: ErrorCode | number): ErrorCategory {
  if (code >= 200 && code < 300) return ErrorCategory.SUCCESS;

  // Special cases - only for specific auth/validation codes
  if (code === 401 || code === 407) return ErrorCategory.AUTH;
  if (code === 403) return ErrorCategory.AUTH; // Permission is auth-related
  if (code === 422) return ErrorCategory.VALIDATION; // Only 422 is validation
  if (code === 429) return ErrorCategory.RATE_LIMIT;

  // General categories
  if (code >= 400 && code < 500) return ErrorCategory.CLIENT;
  if (code >= 500 && code < 600) return ErrorCategory.SERVER;
  return ErrorCategory.CUSTOM;
}

/**
 * Check if an error code represents a client error
 */
export function isClientError(code: ErrorCode | number): boolean {
  return code >= 400 && code < 500;
}

/**
 * Check if an error code represents a server error
 */
export function isServerError(code: ErrorCode | number): boolean {
  return code >= 500 && code < 600;
}

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
