/**
 * HTTP-specific error classes
 */

import { TitanError } from './core.js';
import { ErrorCode } from './codes.js';

/**
 * HTTP error class for custom HTTP status codes
 */
export class HttpError extends TitanError {
  constructor(
    statusCode: number,
    message: string,
    details?: any
  ) {
    super({
      code: statusCode as ErrorCode,
      message,
      details
    });

    this.name = 'HttpError';
  }

  /**
   * Create standard HTTP errors
   */
  static badRequest(message = 'Bad Request', details?: any): HttpError {
    return new HttpError(400, message, details);
  }

  static unauthorized(message = 'Unauthorized', details?: any): HttpError {
    return new HttpError(401, message, details);
  }

  static forbidden(message = 'Forbidden', details?: any): HttpError {
    return new HttpError(403, message, details);
  }

  static notFound(message = 'Not Found', details?: any): HttpError {
    return new HttpError(404, message, details);
  }

  static methodNotAllowed(message = 'Method Not Allowed', details?: any): HttpError {
    return new HttpError(405, message, details);
  }

  static conflict(message = 'Conflict', details?: any): HttpError {
    return new HttpError(409, message, details);
  }

  static unprocessableEntity(message = 'Unprocessable Entity', details?: any): HttpError {
    return new HttpError(422, message, details);
  }

  static tooManyRequests(message = 'Too Many Requests', details?: any): HttpError {
    return new HttpError(429, message, details);
  }

  static internalServerError(message = 'Internal Server Error', details?: any): HttpError {
    return new HttpError(500, message, details);
  }

  static notImplemented(message = 'Not Implemented', details?: any): HttpError {
    return new HttpError(501, message, details);
  }

  static badGateway(message = 'Bad Gateway', details?: any): HttpError {
    return new HttpError(502, message, details);
  }

  static serviceUnavailable(message = 'Service Unavailable', details?: any): HttpError {
    return new HttpError(503, message, details);
  }

  static gatewayTimeout(message = 'Gateway Timeout', details?: any): HttpError {
    return new HttpError(504, message, details);
  }

  /**
   * Create from status code
   */
  static fromStatus(statusCode: number, message?: string, details?: any): HttpError {
    const defaultMessages: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      501: 'Not Implemented',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };

    return new HttpError(
      statusCode,
      message || defaultMessages[statusCode] || `HTTP ${statusCode}`,
      details
    );
  }
}

/**
 * API error with additional API-specific fields
 */
export class ApiError extends HttpError {
  public readonly endpoint?: string;
  public readonly method?: string;
  public readonly apiVersion?: string;

  constructor(
    statusCode: number,
    message: string,
    details?: any,
    options?: {
      endpoint?: string;
      method?: string;
      apiVersion?: string;
    }
  ) {
    super(statusCode, message, details);

    this.name = 'ApiError';
    this.endpoint = options?.endpoint;
    this.method = options?.method;
    this.apiVersion = options?.apiVersion;
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      method: this.method,
      apiVersion: this.apiVersion
    };
  }
}

/**
 * REST error with resource information
 */
export class RestError extends HttpError {
  public readonly resource?: string;
  public readonly resourceId?: string;
  public readonly action?: string;

  constructor(
    statusCode: number,
    message: string,
    details?: any,
    options?: {
      resource?: string;
      resourceId?: string;
      action?: string;
    }
  ) {
    super(statusCode, message, details);

    this.name = 'RestError';
    this.resource = options?.resource;
    this.resourceId = options?.resourceId;
    this.action = options?.action;
  }

  /**
   * Create resource not found error
   */
  static resourceNotFound(resource: string, id: string): RestError {
    return new RestError(
      404,
      `${resource} with id ${id} not found`,
      { resource, id },
      { resource, resourceId: id }
    );
  }

  /**
   * Create resource conflict error
   */
  static resourceConflict(resource: string, id: string, reason?: string): RestError {
    return new RestError(
      409,
      reason || `${resource} with id ${id} already exists`,
      { resource, id, reason },
      { resource, resourceId: id }
    );
  }

  /**
   * Create invalid resource error
   */
  static invalidResource(resource: string, errors: any): RestError {
    return new RestError(
      422,
      `Invalid ${resource}`,
      { errors },
      { resource }
    );
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      resource: this.resource,
      resourceId: this.resourceId,
      action: this.action
    };
  }
}

/**
 * Authentication error
 */
export class AuthError extends HttpError {
  public readonly authType?: string;
  public readonly realm?: string;

  constructor(
    message = 'Authentication required',
    details?: any,
    options?: {
      authType?: string;
      realm?: string;
    }
  ) {
    super(401, message, details);

    this.name = 'AuthError';
    this.authType = options?.authType;
    this.realm = options?.realm;
  }

  /**
   * Create bearer token error
   */
  static bearerTokenRequired(realm = 'api'): AuthError {
    return new AuthError(
      'Bearer token required',
      { type: 'bearer' },
      { authType: 'Bearer', realm }
    );
  }

  /**
   * Create invalid token error
   */
  static invalidToken(reason?: string): AuthError {
    return new AuthError(
      reason || 'Invalid token',
      { reason }
    );
  }

  /**
   * Create token expired error
   */
  static tokenExpired(): AuthError {
    return new AuthError(
      'Token has expired',
      { expired: true }
    );
  }

  /**
   * Get WWW-Authenticate header value
   */
  getAuthenticateHeader(): string {
    if (this.authType === 'Bearer' && this.realm) {
      return `Bearer realm="${this.realm}"`;
    }
    if (this.authType === 'Basic' && this.realm) {
      return `Basic realm="${this.realm}"`;
    }
    return this.authType || 'Bearer';
  }
}

/**
 * Permission error
 */
export class PermissionError extends HttpError {
  public readonly requiredPermission?: string;
  public readonly userPermissions?: string[];

  constructor(
    message = 'Permission denied',
    details?: any,
    options?: {
      requiredPermission?: string;
      userPermissions?: string[];
    }
  ) {
    super(403, message, details);

    this.name = 'PermissionError';
    this.requiredPermission = options?.requiredPermission;
    this.userPermissions = options?.userPermissions;
  }

  /**
   * Create insufficient permissions error
   */
  static insufficientPermissions(
    required: string,
    userPermissions?: string[]
  ): PermissionError {
    return new PermissionError(
      `Insufficient permissions. Required: ${required}`,
      {
        required,
        userPermissions
      },
      {
        requiredPermission: required,
        userPermissions
      }
    );
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      requiredPermission: this.requiredPermission,
      userPermissions: this.userPermissions
    };
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends HttpError {
  public readonly limit?: number;
  public readonly remaining?: number;
  public readonly resetTime?: Date;
  public readonly retryAfter?: number;

  constructor(
    message = 'Rate limit exceeded',
    details?: any,
    options?: {
      limit?: number;
      remaining?: number;
      resetTime?: Date;
      retryAfter?: number;
    }
  ) {
    super(429, message, {
      ...details,
      retryAfter: options?.retryAfter
    });

    this.name = 'RateLimitError';
    this.limit = options?.limit;
    this.remaining = options?.remaining;
    this.resetTime = options?.resetTime;
    this.retryAfter = options?.retryAfter;
  }

  /**
   * Get rate limit headers
   */
  getRateLimitHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.limit !== undefined) {
      headers['X-RateLimit-Limit'] = String(this.limit);
    }
    if (this.remaining !== undefined) {
      headers['X-RateLimit-Remaining'] = String(this.remaining);
    }
    if (this.resetTime) {
      headers['X-RateLimit-Reset'] = String(Math.floor(this.resetTime.getTime() / 1000));
    }
    if (this.retryAfter !== undefined) {
      headers['Retry-After'] = String(this.retryAfter);
    }

    return headers;
  }

  override toJSON(): any {
    return {
      ...super.toJSON(),
      limit: this.limit,
      remaining: this.remaining,
      resetTime: this.resetTime?.toISOString(),
      retryAfter: this.retryAfter
    };
  }
}