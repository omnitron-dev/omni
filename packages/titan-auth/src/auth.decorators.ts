/**
 * Auth Decorators
 *
 * Method decorators for authentication requirements.
 *
 * @module titan/modules/auth
 */

import type { IAuthContext, IRequireAuthOptions, IAuthMiddleware } from './auth.types.js';
import { AUTH_MIDDLEWARE_TOKEN } from './auth.tokens.js';
import { hasRole, isAnonymous } from './auth.utils.js';

/**
 * Metadata key for storing auth requirements.
 */
export const AUTH_METADATA_KEY = Symbol.for('titan:auth:requirements');

/**
 * Metadata key for marking public endpoints.
 */
export const PUBLIC_METADATA_KEY = Symbol.for('titan:auth:public');

/**
 * Interface for auth decorator context.
 */
export interface IAuthDecoratorContext {
  /** Injected auth middleware service (named with __ to avoid conflicts) */
  __authMiddleware__?: IAuthMiddleware;
  /** Auth context from request */
  __authContext__?: IAuthContext;
}

/**
 * Decorator to require authentication on a method.
 *
 * The decorated class must have `__authMiddleware__` injected with AUTH_MIDDLEWARE_TOKEN.
 *
 * @param options - Authentication requirements
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * class UserService {
 *   constructor(
 *     @Inject(AUTH_MIDDLEWARE_TOKEN)
 *     private readonly __authMiddleware__: IAuthMiddleware
 *   ) {}
 *
 *   @RequireAuth()
 *   async getProfile(request: IRequestLike) {
 *     // Only authenticated users can access this
 *   }
 *
 *   @RequireAuth({ roles: ['admin'] })
 *   async deleteUser(request: IRequestLike, userId: string) {
 *     // Only admins can access this
 *   }
 *
 *   @RequireAuth({ allowAnonymous: true })
 *   async getPublicData(request: IRequestLike) {
 *     // Anyone can access, but auth context is available if provided
 *   }
 * }
 * ```
 */
export function RequireAuth(options: IRequireAuthOptions = {}): MethodDecorator {
  return function (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => unknown;

    descriptor.value = async function (this: IAuthDecoratorContext, ...args: unknown[]): Promise<unknown> {
      const middleware = this.__authMiddleware__;

      if (!middleware) {
        throw new Error(
          `@RequireAuth: __authMiddleware__ not injected. ` +
            `Inject AUTH_MIDDLEWARE_TOKEN as __authMiddleware__ in the class constructor.`
        );
      }

      // Find request object in arguments (first arg with headers property)
      const request = args.find(
        (arg): arg is { headers: Record<string, string | string[] | undefined> } =>
          typeof arg === 'object' && arg !== null && 'headers' in arg
      );

      if (!request) {
        throw new Error(
          `@RequireAuth: No request object found in method arguments. ` +
            `The first argument should be a request-like object with headers.`
        );
      }

      // Authenticate
      const authContext = options.allowAnonymous
        ? await middleware.authenticate(request)
        : await middleware.authenticateRequired(request);

      // Check roles if specified
      if (options.roles && options.roles.length > 0 && !isAnonymous(authContext)) {
        if (!hasRole(authContext.role, options.roles)) {
          const error = new Error(options.message ?? 'Insufficient permissions');
          error.name = 'ForbiddenError';
          throw error;
        }
      }

      // Store auth context for use in method
      this.__authContext__ = authContext;

      // Call original method
      return originalMethod.apply(this, args);
    };

    // Store metadata for introspection
    Reflect.defineMetadata(AUTH_METADATA_KEY, options, target, propertyKey);

    return descriptor;
  };
}

/**
 * Decorator to require service-level authentication.
 *
 * Shorthand for @RequireAuth({ roles: ['service_role'] })
 *
 * @example
 * ```typescript
 * @RequireServiceAuth()
 * async internalOperation(request: IRequestLike) {
 *   // Only service-to-service calls can access this
 * }
 * ```
 */
export function RequireServiceAuth(): MethodDecorator {
  return RequireAuth({
    roles: ['service_role'],
    message: 'Service authentication required',
  });
}

/**
 * Decorator to require admin authentication.
 *
 * Shorthand for @RequireAuth({ roles: ['admin', 'service_role'] })
 *
 * @example
 * ```typescript
 * @RequireAdminAuth()
 * async deleteAllUsers(request: IRequestLike) {
 *   // Only admins can access this
 * }
 * ```
 */
export function RequireAdminAuth(): MethodDecorator {
  return RequireAuth({
    roles: ['admin', 'service_role'],
    message: 'Admin authentication required',
  });
}

/**
 * Get auth requirements metadata from a method.
 *
 * @param target - Class prototype
 * @param propertyKey - Method name
 * @returns Auth requirements or undefined
 */
export function getAuthRequirements(target: object, propertyKey: string | symbol): IRequireAuthOptions | undefined {
  return Reflect.getMetadata(AUTH_METADATA_KEY, target, propertyKey);
}

/**
 * Decorator to mark a method or class as public (no authentication required).
 *
 * Use this to exempt specific endpoints from authentication when using
 * global auth middleware or guards.
 *
 * @returns Method or class decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * class ApiController {
 *   @Public()
 *   async healthCheck() {
 *     return { status: 'ok' };
 *   }
 *
 *   @RequireAuth()
 *   async getProfile(request: IRequestLike) {
 *     // Requires authentication
 *   }
 * }
 * ```
 *
 * @example
 * Class-level decorator:
 * ```typescript
 * @Public()
 * @Injectable()
 * class PublicApiController {
 *   // All methods in this class are public
 * }
 * ```
 */
export function Public(): ClassDecorator & MethodDecorator {
  return function (
    target: object,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor
  ): void | PropertyDescriptor {
    if (propertyKey !== undefined && descriptor !== undefined) {
      // Method decorator
      Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, target, propertyKey);
      return descriptor;
    } else {
      // Class decorator
      Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, target);
      return undefined;
    }
  } as ClassDecorator & MethodDecorator;
}

/**
 * Check if a method or class is marked as public.
 *
 * @param target - Class prototype or constructor
 * @param propertyKey - Optional method name
 * @returns True if marked as public
 */
export function isPublic(target: object, propertyKey?: string | symbol): boolean {
  // Check method-level first
  if (propertyKey !== undefined) {
    const methodPublic = Reflect.getMetadata(PUBLIC_METADATA_KEY, target, propertyKey);
    if (methodPublic === true) return true;
  }

  // Check class-level
  const classTarget = typeof target === 'function' ? target : target.constructor;
  return Reflect.getMetadata(PUBLIC_METADATA_KEY, classTarget) === true;
}

/**
 * Decorator to require specific roles.
 *
 * Shorthand for @RequireAuth({ roles: [...] })
 *
 * @param roles - Required roles (user must have at least one)
 * @param message - Custom error message
 * @returns Method decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * class AdminService {
 *   constructor(
 *     @Inject(AUTH_MIDDLEWARE_TOKEN)
 *     private readonly __authMiddleware__: IAuthMiddleware
 *   ) {}
 *
 *   @RequireRole(['admin'])
 *   async manageUsers(request: IRequestLike) {
 *     // Only admins can access
 *   }
 *
 *   @RequireRole(['admin', 'moderator'])
 *   async moderateContent(request: IRequestLike) {
 *     // Admins or moderators can access
 *   }
 * }
 * ```
 */
export function RequireRole(roles: string[], message?: string): MethodDecorator {
  return RequireAuth({
    roles,
    message: message ?? `Required roles: ${roles.join(', ')}`,
  });
}
