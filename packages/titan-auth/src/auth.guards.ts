/**
 * Auth Guards
 *
 * Guard classes for route-level authentication and authorization.
 * Use with Netron HTTP middleware or decorator-based protection.
 *
 * @module titan/modules/auth
 */

import type { IAuthContext, IAuthMiddleware, IRequestLike } from './auth.types.js';
import { isPublic, getAuthRequirements } from './auth.decorators.js';
import { hasRole, isAnonymous } from './auth.utils.js';

/**
 * Guard execution context.
 */
export interface IGuardContext {
  /** The incoming request */
  request: IRequestLike;
  /** Handler class (controller/service) */
  handler?: object;
  /** Handler method name */
  methodName?: string | symbol;
  /** Additional context data */
  data?: Record<string, unknown>;
}

/**
 * Guard interface.
 */
export interface IGuard {
  /**
   * Determines if the request can proceed.
   *
   * @param context - Guard execution context
   * @returns True if request can proceed, false to deny
   */
  canActivate(context: IGuardContext): Promise<boolean>;
}

/**
 * Guard result with auth context.
 */
export interface IGuardResult {
  /** Whether the guard allows access */
  allowed: boolean;
  /** Auth context if authenticated */
  authContext?: IAuthContext;
  /** Reason for denial */
  reason?: string;
}

/**
 * Auth Guard - Enforces authentication.
 *
 * Checks if the request is authenticated. Respects @Public() decorator.
 *
 * @example
 * ```typescript
 * const guard = new AuthGuard(authMiddleware);
 *
 * // In route handler
 * const result = await guard.execute({ request, handler, methodName: 'getProfile' });
 * if (!result.allowed) {
 *   throw new UnauthorizedError(result.reason);
 * }
 * ```
 */
export class AuthGuard implements IGuard {
  constructor(private readonly authMiddleware: IAuthMiddleware) {}

  /**
   * Check if request can proceed (IGuard interface).
   */
  async canActivate(context: IGuardContext): Promise<boolean> {
    const result = await this.execute(context);
    return result.allowed;
  }

  /**
   * Execute guard with full result details.
   */
  async execute(context: IGuardContext): Promise<IGuardResult> {
    const { request, handler, methodName } = context;

    // Check if endpoint is public
    if (handler && methodName && isPublic(handler, methodName)) {
      return { allowed: true };
    }

    // Check class-level public
    if (handler && isPublic(handler)) {
      return { allowed: true };
    }

    try {
      const authContext = await this.authMiddleware.authenticateRequired(request);
      return { allowed: true, authContext };
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : 'Authentication required',
      };
    }
  }
}

/**
 * Role Guard - Enforces role-based access control.
 *
 * Checks if the authenticated user has the required role(s).
 *
 * @example
 * ```typescript
 * const guard = new RoleGuard(authMiddleware, ['admin', 'moderator']);
 *
 * // In route handler
 * const result = await guard.execute({ request });
 * if (!result.allowed) {
 *   throw new ForbiddenError(result.reason);
 * }
 * ```
 */
export class RoleGuard implements IGuard {
  constructor(
    private readonly authMiddleware: IAuthMiddleware,
    private readonly requiredRoles: string[]
  ) {}

  /**
   * Check if request can proceed (IGuard interface).
   */
  async canActivate(context: IGuardContext): Promise<boolean> {
    const result = await this.execute(context);
    return result.allowed;
  }

  /**
   * Execute guard with full result details.
   */
  async execute(context: IGuardContext): Promise<IGuardResult> {
    const { request, handler, methodName } = context;

    // Check if endpoint is public
    if (handler && methodName && isPublic(handler, methodName)) {
      return { allowed: true };
    }

    // Authenticate first
    let authContext: IAuthContext;
    try {
      authContext = await this.authMiddleware.authenticateRequired(request);
    } catch (error) {
      return {
        allowed: false,
        reason: error instanceof Error ? error.message : 'Authentication required',
      };
    }

    // Check if anonymous
    if (isAnonymous(authContext)) {
      return {
        allowed: false,
        authContext,
        reason: 'Authentication required for role check',
      };
    }

    // Check decorator requirements if handler/method provided
    if (handler && methodName) {
      const requirements = getAuthRequirements(handler, methodName);
      if (requirements?.roles && requirements.roles.length > 0) {
        if (!hasRole(authContext.role, requirements.roles)) {
          return {
            allowed: false,
            authContext,
            reason: `Required roles: ${requirements.roles.join(', ')}`,
          };
        }
        return { allowed: true, authContext };
      }
    }

    // Check guard-level required roles
    if (this.requiredRoles.length > 0) {
      if (!hasRole(authContext.role, this.requiredRoles)) {
        return {
          allowed: false,
          authContext,
          reason: `Required roles: ${this.requiredRoles.join(', ')}`,
        };
      }
    }

    return { allowed: true, authContext };
  }
}

/**
 * API Key Guard - Enforces API key authentication.
 *
 * Validates requests using API key from header.
 *
 * @example
 * ```typescript
 * const guard = new ApiKeyGuard({
 *   headerName: 'X-API-Key',
 *   validateKey: async (key) => {
 *     // Look up key in database
 *     const apiKey = await db.apiKeys.findByKey(key);
 *     if (!apiKey || apiKey.revokedAt) return null;
 *     return { userId: apiKey.userId, scopes: apiKey.scopes };
 *   },
 * });
 *
 * const result = await guard.execute({ request });
 * if (!result.allowed) {
 *   throw new UnauthorizedError(result.reason);
 * }
 * ```
 */
export class ApiKeyGuard implements IGuard {
  private readonly headerName: string;
  private readonly validateKey: (key: string) => Promise<{ userId?: string; scopes?: string[] } | null>;

  constructor(options: {
    /** Header name for API key (default: 'X-API-Key') */
    headerName?: string;
    /** Function to validate API key, returns user info or null if invalid */
    validateKey: (key: string) => Promise<{ userId?: string; scopes?: string[] } | null>;
  }) {
    this.headerName = options.headerName ?? 'X-API-Key';
    this.validateKey = options.validateKey;
  }

  /**
   * Check if request can proceed (IGuard interface).
   */
  async canActivate(context: IGuardContext): Promise<boolean> {
    const result = await this.execute(context);
    return result.allowed;
  }

  /**
   * Execute guard with full result details.
   */
  async execute(context: IGuardContext): Promise<IGuardResult> {
    const { request, handler, methodName } = context;

    // Check if endpoint is public
    if (handler && methodName && isPublic(handler, methodName)) {
      return { allowed: true };
    }

    // Extract API key from header - handle both Web API and Node.js style headers
    const headers = request.headers;
    let headerValue: string | string[] | null | undefined;

    if ('get' in headers && typeof headers.get === 'function') {
      // Web API style (Fetch/Headers)
      headerValue = headers.get(this.headerName.toLowerCase());
    } else {
      // Node.js style (Record)
      const nodeHeaders = headers as Record<string, string | string[] | undefined>;
      headerValue = nodeHeaders[this.headerName.toLowerCase()];
    }

    const apiKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!apiKey) {
      return {
        allowed: false,
        reason: `Missing API key in ${this.headerName} header`,
      };
    }

    // Validate the key
    const keyInfo = await this.validateKey(apiKey);
    if (!keyInfo) {
      return {
        allowed: false,
        reason: 'Invalid API key',
      };
    }

    // Build auth context from API key info
    const authContext: IAuthContext = {
      userId: keyInfo.userId ?? 'api_key_user',
      role: 'api_key',
      tenantId: 'default',
      isServiceRole: false,
      claims: {
        sub: keyInfo.userId ?? 'api_key_user',
        role: 'api_key',
        scopes: keyInfo.scopes,
      },
    };

    return { allowed: true, authContext };
  }
}

/**
 * Composite Guard - Combines multiple guards.
 *
 * @example
 * ```typescript
 * // Require both API key AND specific role
 * const guard = new CompositeGuard([apiKeyGuard, roleGuard], 'all');
 *
 * // Require either JWT auth OR API key
 * const guard = new CompositeGuard([authGuard, apiKeyGuard], 'any');
 * ```
 */
export class CompositeGuard implements IGuard {
  constructor(
    private readonly guards: IGuard[],
    private readonly mode: 'all' | 'any' = 'all'
  ) {}

  /**
   * Check if request can proceed based on mode.
   */
  async canActivate(context: IGuardContext): Promise<boolean> {
    if (this.mode === 'all') {
      for (const guard of this.guards) {
        if (!(await guard.canActivate(context))) {
          return false;
        }
      }
      return true;
    } else {
      for (const guard of this.guards) {
        if (await guard.canActivate(context)) {
          return true;
        }
      }
      return false;
    }
  }
}
