/**
 * Auth Middleware
 *
 * HTTP middleware for request authentication.
 *
 * @module titan/modules/auth
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/types';
import { AUTH_OPTIONS_TOKEN, JWT_SERVICE_TOKEN } from './auth.tokens.js';
import type {
  IAuthMiddleware,
  IAuthContext,
  IRequestLike,
  IApiKeyValidationResult,
  IJWTService,
  IAuthModuleOptions,
} from './auth.types.js';
import {
  constantTimeCompare,
  extractBearerToken,
  extractApiKey,
  extractTenantId,
  createAnonymousContext,
  createServiceContext,
} from './auth.utils.js';

/**
 * Unauthorized error.
 */
export class UnauthorizedError extends Error {
  constructor(message: string = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Auth Middleware Implementation
 *
 * Provides HTTP request authentication with multiple strategies:
 * - Bearer token (JWT)
 * - API key (service and anonymous)
 * - Anonymous fallback
 *
 * Uses constant-time comparison for all secret comparisons
 * to prevent timing attacks.
 *
 * @example
 * ```typescript
 * // In a Netron HTTP handler
 * const authContext = await authMiddleware.authenticate(ctx.request);
 *
 * // Require authentication (throws on failure)
 * const authContext = await authMiddleware.authenticateRequired(ctx.request);
 * ```
 */
@Injectable()
export class AuthMiddleware implements IAuthMiddleware {
  private readonly defaultTenantId: string;

  constructor(
    @Inject(JWT_SERVICE_TOKEN) private readonly jwtService: IJWTService,
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: IAuthModuleOptions,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger
  ) {
    this.defaultTenantId = options.defaultTenantId ?? 'default';
  }

  /**
   * Authenticate a request and return auth context.
   *
   * Authentication flow:
   * 1. Check for Bearer token → validate JWT
   * 2. Check for API key → validate against service/anon keys
   * 3. Fall back to anonymous context
   */
  async authenticate(request: IRequestLike): Promise<IAuthContext> {
    const tenantId = extractTenantId(request, this.defaultTenantId);

    // 1. Try Bearer token authentication
    const token = extractBearerToken(request);
    if (token) {
      try {
        return await this.jwtService.createContext(token);
      } catch (error) {
        this.logger.debug({ error }, 'Bearer token authentication failed');
        throw error;
      }
    }

    // 2. Try API key authentication
    const apiKey = extractApiKey(request);
    if (apiKey) {
      const result = this.validateApiKey(apiKey);
      if (result.valid && result.context) {
        // Override tenant ID from header if present
        return {
          ...result.context,
          tenantId,
        };
      }
      throw new UnauthorizedError('Invalid API key');
    }

    // 3. Fall back to anonymous context
    return createAnonymousContext(tenantId);
  }

  /**
   * Authenticate and require valid credentials.
   *
   * @throws {UnauthorizedError} If no valid credentials provided
   */
  async authenticateRequired(request: IRequestLike): Promise<IAuthContext> {
    const context = await this.authenticate(request);

    if (context.userId === 'anonymous') {
      throw new UnauthorizedError('Authentication required');
    }

    return context;
  }

  /**
   * Extract token from request headers.
   */
  extractToken(request: IRequestLike): string | null {
    return extractBearerToken(request);
  }

  /**
   * Validate an API key.
   *
   * Uses constant-time comparison to prevent timing attacks.
   */
  validateApiKey(apiKey: string): IApiKeyValidationResult {
    const { serviceKey, anonKey } = this.options;

    // Check service key first (most privileged)
    if (serviceKey && constantTimeCompare(apiKey, serviceKey)) {
      return {
        valid: true,
        type: 'service',
        context: createServiceContext(this.defaultTenantId),
      };
    }

    // Check anonymous key
    if (anonKey && constantTimeCompare(apiKey, anonKey)) {
      return {
        valid: true,
        type: 'anon',
        context: createAnonymousContext(this.defaultTenantId),
      };
    }

    return { valid: false };
  }
}

/**
 * Create an HTTP middleware function for use with Netron.
 *
 * @param authMiddleware - Injected auth middleware service
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * ```typescript
 * // Create middleware from service
 * const middleware = createHttpAuthMiddleware(authMiddleware, {
 *   required: true,
 *   allowedRoles: ['admin', 'user'],
 * });
 *
 * // Use in route
 * app.use('/api', middleware);
 * ```
 */
export function createHttpAuthMiddleware(
  authMiddleware: IAuthMiddleware,
  options: {
    required?: boolean;
    allowedRoles?: string[];
    onUnauthorized?: (error: Error) => Response;
  } = {}
): (ctx: { request: IRequestLike }, next: () => Promise<void>) => Promise<void | Response> {
  const { required = true, allowedRoles, onUnauthorized } = options;

  return async (ctx: { request: IRequestLike & { auth?: IAuthContext } }, next: () => Promise<void>) => {
    try {
      const authContext = required
        ? await authMiddleware.authenticateRequired(ctx.request)
        : await authMiddleware.authenticate(ctx.request);

      // Check role if required
      if (allowedRoles && allowedRoles.length > 0) {
        const hasAllowedRole = allowedRoles.includes(authContext.role) || authContext.isServiceRole;
        if (!hasAllowedRole) {
          throw new UnauthorizedError('Insufficient permissions');
        }
      }

      // Attach auth context to request
      ctx.request.auth = authContext;

      await next();
      return undefined;
    } catch (error) {
      if (onUnauthorized && error instanceof Error) {
        return onUnauthorized(error);
      }
      throw error;
    }
  };
}
