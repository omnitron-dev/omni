/**
 * Temporary error types for compilation
 * Minimal browser-compatible error handling
 */

/**
 * Error codes enum
 */
export enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  INVALID_REQUEST = 'INVALID_REQUEST',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  TIMEOUT = 'TIMEOUT',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',
}

/**
 * Base Titan error class
 */
export class TitanError extends Error {
  public code: ErrorCode;
  public details?: any;

  constructor(
    message: string | { code?: ErrorCode; message: string; details?: any },
    code?: ErrorCode,
    details?: any
  ) {
    // Handle both string and object constructors
    if (typeof message === 'object') {
      super(message.message);
      this.code = message.code ?? ErrorCode.INTERNAL_ERROR;
      this.details = message.details;
    } else {
      super(message);
      this.code = code ?? ErrorCode.INTERNAL_ERROR;
      this.details = details;
    }
    this.name = 'TitanError';
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends TitanError {
  constructor(message: string = 'Unauthorized', details?: any) {
    super(message, ErrorCode.UNAUTHORIZED, details);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends TitanError {
  constructor(message: string = 'Forbidden', details?: any) {
    super(message, ErrorCode.FORBIDDEN, details);
    this.name = 'ForbiddenError';
  }
}

/**
 * Not found error
 */
export class NotFoundError extends TitanError {
  constructor(message: string = 'Not found', details?: any) {
    super(message, ErrorCode.NOT_FOUND, details);
    this.name = 'NotFoundError';
  }
}
