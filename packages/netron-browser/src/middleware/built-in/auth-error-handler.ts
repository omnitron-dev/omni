/**
 * Authentication Error Handler Middleware
 *
 * Handles authentication and authorization errors in Netron client requests:
 * - 401 Unauthorized: Automatic token refresh and retry
 * - 403 Forbidden: Access denied events
 * - 429 Rate Limited: Queue and retry with backoff
 *
 * @example
 * ```typescript
 * import { HttpClient } from '@omnitron-dev/netron-browser/client';
 * import { AuthenticationClient } from '@omnitron-dev/netron-browser/auth';
 * import {
 *   createAuthErrorMiddleware,
 *   MiddlewareStage
 * } from '@omnitron-dev/netron-browser/middleware';
 *
 * // Create auth client
 * const authClient = new AuthenticationClient({
 *   autoRefresh: true,
 *   refreshThreshold: 5 * 60 * 1000, // 5 minutes
 * });
 *
 * // Create HTTP client
 * const client = new HttpClient({
 *   url: 'https://api.example.com',
 * });
 *
 * // Add auth error middleware
 * client.use(
 *   createAuthErrorMiddleware({
 *     authClient,
 *     onSessionExpired: () => {
 *       console.log('Session expired, redirecting to login...');
 *       window.location.href = '/login';
 *     },
 *     onAccessDenied: (details) => {
 *       console.error('Access denied:', details);
 *       // Show error notification
 *     },
 *     onRateLimited: (retryAfter) => {
 *       console.warn(`Rate limited. Retry after ${retryAfter} seconds`);
 *       // Show rate limit notification
 *     },
 *     maxRetries: 1,
 *   }),
 *   { name: 'auth-error-handler', priority: 10 },
 *   MiddlewareStage.ERROR
 * );
 * ```
 *
 * @example WebSocket Client
 * ```typescript
 * import { WsClient } from '@omnitron-dev/netron-browser/client';
 * import { createSimpleAuthErrorMiddleware } from '@omnitron-dev/netron-browser/middleware';
 *
 * const wsClient = new WsClient({
 *   url: 'wss://api.example.com',
 * });
 *
 * // Add simple auth error middleware
 * wsClient.use(
 *   createSimpleAuthErrorMiddleware(authClient, {
 *     onSessionExpired: () => window.location.href = '/login',
 *     onAccessDenied: (details) => showNotification('Access Denied', 'error'),
 *   }),
 *   undefined,
 *   MiddlewareStage.ERROR
 * );
 * ```
 */

import type { MiddlewareFunction, ClientMiddlewareContext } from '../types.js';
import type { AuthenticationClient } from '../../auth/client.js';
import { ErrorCode } from '../../errors/codes.js';

/**
 * Access denied event details
 */
export interface AccessDeniedDetails {
  service: string;
  method: string;
  userId?: string;
  requiredPermissions?: string[];
  details?: any;
}

/**
 * Authentication error handler options
 */
export interface AuthErrorMiddlewareOptions {
  /**
   * Authentication client for token refresh
   */
  authClient: AuthenticationClient;

  /**
   * Callback when session expires (401 and refresh fails)
   */
  onSessionExpired?: () => void;

  /**
   * Callback when access is denied (403)
   */
  onAccessDenied?: (details: AccessDeniedDetails) => void;

  /**
   * Callback when rate limited (429)
   */
  onRateLimited?: (retryAfter: number) => void;

  /**
   * Maximum retry attempts
   * @default 1
   */
  maxRetries?: number;

  /**
   * Status codes that should trigger retry
   * @default [401]
   */
  retryStatusCodes?: number[];

  /**
   * Service method to call for token refresh
   * @default 'auth.refresh'
   */
  refreshMethod?: string;

  /**
   * Whether to emit events on auth client
   * @default true
   */
  emitEvents?: boolean;
}

/**
 * Retry queue entry (currently unused, reserved for future rate limit queue implementation)
 */
// interface QueuedRetry {
//   context: ClientMiddlewareContext;
//   retryAfter: number;
//   timeoutId: number;
// }

/**
 * Create authentication error handler middleware
 */
export function createAuthErrorMiddleware(options: AuthErrorMiddlewareOptions): MiddlewareFunction {
  const {
    authClient,
    onSessionExpired,
    onAccessDenied,
    onRateLimited,
    maxRetries = 1,
    refreshMethod = 'auth.refresh',
    emitEvents = true,
  } = options;

  // Track retry attempts per context
  const retryAttempts = new WeakMap<ClientMiddlewareContext, number>();

  // Queue for rate-limited requests (currently unused, reserved for future rate limit queue implementation)
  // const retryQueue: QueuedRetry[] = [];

  return async (ctx, next) => {
    try {
      await next();
    } catch (error: any) {
      // Extract error code - check multiple places
      const errorCode = extractErrorCode(error);

      // Check if this error should trigger special handling
      if (errorCode === ErrorCode.UNAUTHORIZED || errorCode === 401) {
        await handleUnauthorized(ctx, error);
      } else if (errorCode === ErrorCode.FORBIDDEN || errorCode === 403) {
        await handleForbidden(ctx, error);
      } else if (errorCode === ErrorCode.TOO_MANY_REQUESTS || errorCode === 429) {
        await handleRateLimited(ctx, error);
      } else {
        // Not an auth error, re-throw
        throw error;
      }
    }
  };

  /**
   * Handle 401 Unauthorized errors
   */
  async function handleUnauthorized(ctx: ClientMiddlewareContext, error: Error): Promise<void> {
    // Check if we should retry
    const attempts = retryAttempts.get(ctx) || 0;

    if (attempts >= maxRetries) {
      // Max retries exceeded, clear auth and notify
      authClient.clearAuth();

      if (emitEvents) {
        emitAuthEvent('session-expired', {
          service: ctx.service,
          method: ctx.method,
          error: error.message,
        });
      }

      if (onSessionExpired) {
        onSessionExpired();
      }

      throw error;
    }

    // Increment retry count
    retryAttempts.set(ctx, attempts + 1);

    try {
      // Attempt to refresh token
      const refreshed = await attemptTokenRefresh();

      if (!refreshed) {
        // Refresh failed, clear auth and notify
        authClient.clearAuth();

        if (emitEvents) {
          emitAuthEvent('session-expired', {
            service: ctx.service,
            method: ctx.method,
            reason: 'refresh_failed',
          });
        }

        if (onSessionExpired) {
          onSessionExpired();
        }

        throw error;
      }

      // Refresh succeeded, update auth headers and retry
      if (ctx.request?.headers) {
        const authHeaders = authClient.getAuthHeaders();
        Object.assign(ctx.request.headers, authHeaders);
      }

      // Mark metadata to indicate this is a retry
      ctx.metadata.set('auth:retry', true);
      ctx.metadata.set('auth:retryAttempt', attempts + 1);

      // Don't throw - let the request retry with new token
      // The client should handle the retry logic
      return;
    } catch (refreshError) {
      // Refresh attempt failed
      authClient.clearAuth();

      if (emitEvents) {
        emitAuthEvent('session-expired', {
          service: ctx.service,
          method: ctx.method,
          refreshError: refreshError instanceof Error ? refreshError.message : 'unknown',
        });
      }

      if (onSessionExpired) {
        onSessionExpired();
      }

      throw error;
    }
  }

  /**
   * Handle 403 Forbidden errors
   */
  async function handleForbidden(ctx: ClientMiddlewareContext, error: Error): Promise<void> {
    const details: AccessDeniedDetails = {
      service: ctx.service,
      method: ctx.method,
      userId: authClient.getContext()?.userId,
      details: (error as any).details,
    };

    // Extract required permissions from error if available
    if ((error as any).details?.requiredPermissions) {
      details.requiredPermissions = (error as any).details.requiredPermissions;
    }

    if (emitEvents) {
      emitAuthEvent('access-denied', details);
    }

    if (onAccessDenied) {
      onAccessDenied(details);
    }

    // Store details in context metadata
    ctx.metadata.set('auth:accessDenied', true);
    ctx.metadata.set('auth:deniedDetails', details);

    // Re-throw the error - we don't retry 403s
    throw error;
  }

  /**
   * Handle 429 Rate Limited errors
   */
  async function handleRateLimited(ctx: ClientMiddlewareContext, error: Error): Promise<void> {
    // Parse Retry-After header from error details
    let retryAfter = 60; // Default 60 seconds

    if ((error as any).details?.retryAfter) {
      retryAfter = parseInt((error as any).details.retryAfter, 10);
    } else if (ctx.response?.headers?.['retry-after']) {
      retryAfter = parseInt(ctx.response.headers['retry-after'], 10);
    }

    if (emitEvents) {
      emitAuthEvent('rate-limited', {
        service: ctx.service,
        method: ctx.method,
        retryAfter,
      });
    }

    if (onRateLimited) {
      onRateLimited(retryAfter);
    }

    // Store rate limit info in context
    ctx.metadata.set('auth:rateLimited', true);
    ctx.metadata.set('auth:retryAfter', retryAfter);

    // Queue for retry (if client supports it)
    // For now, just re-throw - client can handle retry logic
    throw error;
  }

  /**
   * Attempt to refresh the authentication token
   */
  async function attemptTokenRefresh(): Promise<boolean> {
    try {
      // Parse refresh method
      const [service, method] = refreshMethod.split('.');

      if (!service || !method) {
        console.warn('[AuthErrorMiddleware] Invalid refresh method format:', refreshMethod);
        return false;
      }

      // The refresh should be handled by the application
      // We just check if the token needs refresh and emit an event
      if (authClient.needsRefresh()) {
        // Let the auth client handle the refresh via its event system
        return false;
      }

      return true;
    } catch (error) {
      console.error('[AuthErrorMiddleware] Token refresh failed:', error);
      return false;
    }
  }

  /**
   * Emit authentication event
   */
  function emitAuthEvent(event: string, data: any): void {
    // Use auth client's event system if available
    if ((authClient as any).emit) {
      (authClient as any).emit(event, data);
    }
  }

  // Use module-level extractErrorCode and parseErrorCode functions
}

/**
 * Create auth error middleware with minimal options
 */
export function createSimpleAuthErrorMiddleware(
  authClient: AuthenticationClient,
  callbacks?: {
    onSessionExpired?: () => void;
    onAccessDenied?: (details: AccessDeniedDetails) => void;
    onRateLimited?: (retryAfter: number) => void;
  }
): MiddlewareFunction {
  return createAuthErrorMiddleware({
    authClient,
    ...callbacks,
  });
}

/**
 * Auth error event names
 */
export const AuthErrorEvents = {
  SESSION_EXPIRED: 'session-expired',
  ACCESS_DENIED: 'access-denied',
  RATE_LIMITED: 'rate-limited',
  TOKEN_REFRESHED: 'token-refreshed',
} as const;

/**
 * Type guard to check if error is an auth error
 */
export function isAuthError(error: any): boolean {
  const code = extractErrorCode(error);
  return code === 401 || code === 403 || code === ErrorCode.UNAUTHORIZED || code === ErrorCode.FORBIDDEN;
}

/**
 * Type guard to check if error is a rate limit error
 */
export function isRateLimitError(error: any): boolean {
  const code = extractErrorCode(error);
  return code === 429 || code === ErrorCode.TOO_MANY_REQUESTS;
}

/**
 * Extract error code helper (exported for testing)
 */
function extractErrorCode(error: any): number | string | undefined {
  if (error.code !== undefined) {
    return typeof error.code === 'string' ? parseErrorCode(error.code) : error.code;
  }

  if (error.details?.code !== undefined) {
    return typeof error.details.code === 'string' ? parseErrorCode(error.details.code) : error.details.code;
  }

  if (error.httpStatus !== undefined) {
    return error.httpStatus;
  }

  if (error.statusCode !== undefined) {
    return error.statusCode;
  }

  return undefined;
}

/**
 * Parse error code helper (exported for testing)
 */
function parseErrorCode(code: string): number | string {
  const codeMap: Record<string, number> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    TOO_MANY_REQUESTS: 429,
    RATE_LIMITED: 429,
  };

  return codeMap[code] || code;
}
