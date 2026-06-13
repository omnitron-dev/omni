/* eslint-disable @typescript-eslint/no-duplicate-enum-values */
/**
 * Standard error codes (HTTP-semantic) + category classification — the
 * universal basis for every transport-specific error mapping. Shared by the
 * titan server and the browser client so an error code serialized on one end
 * deserializes to the same meaning on the other. (XC-2: both packages carried
 * byte-identical copies of this taxonomy.)
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
