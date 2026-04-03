/**
 * Legacy error classes for backward compatibility
 * These are simple wrappers around the new error system
 */

import { NetronError } from './netron.js';
import { ErrorCode } from './codes.js';

/**
 * Connection errors (legacy)
 */
export class ConnectionError extends NetronError {
  constructor(message: string, details?: any) {
    super({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message,
      details,
    });
    this.name = 'ConnectionError';
  }
}

/**
 * Timeout errors (legacy)
 */
export class TimeoutError extends NetronError {
  constructor(message: string, details?: any) {
    super({
      code: ErrorCode.REQUEST_TIMEOUT,
      message,
      details,
    });
    this.name = 'TimeoutError';
  }
}

/**
 * Network errors (legacy)
 */
export class NetworkError extends NetronError {
  constructor(message: string, details?: any) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      message,
      details,
    });
    this.name = 'NetworkError';
  }
}

/**
 * Protocol errors (legacy)
 */
export class ProtocolError extends NetronError {
  constructor(message: string, details?: any) {
    super({
      code: ErrorCode.BAD_REQUEST,
      message,
      details,
    });
    this.name = 'ProtocolError';
  }
}

/**
 * Service errors (legacy)
 */
export class ServiceError extends NetronError {
  constructor(message: string, details?: any) {
    super({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message,
      details,
    });
    this.name = 'ServiceError';
  }
}

/**
 * Invalid arguments errors (legacy)
 */
export class InvalidArgumentsError extends NetronError {
  constructor(message: string, details?: any) {
    super({
      code: ErrorCode.BAD_REQUEST,
      message,
      details,
    });
    this.name = 'InvalidArgumentsError';
  }
}
