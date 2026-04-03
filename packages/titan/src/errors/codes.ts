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
