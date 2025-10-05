/**
 * Authentication and Authorization Middleware for Netron
 * Integrates with @Method decorator metadata and PolicyEngine
 */

import type { NetronMiddlewareContext, MiddlewareFunction } from './types.js';
import type {
  AuthContext,
  ExecutionContext,
  MethodOptions,
  PolicyExpression,
} from '../auth/types.js';
import type { PolicyEngine } from '../auth/policy-engine.js';
import type { ILogger } from '../../types.js';
import { METADATA_KEYS } from '../../decorators/core.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import type { RemotePeer } from '../remote-peer.js';

/**
 * Options for auth middleware
 */
export interface AuthMiddlewareOptions {
  /** Policy engine instance */
  policyEngine: PolicyEngine;

  /** Logger instance */
  logger: ILogger;

  /** Skip authentication for specific services */
  skipServices?: string[];

  /** Skip authentication for specific methods */
  skipMethods?: string[];
}

/**
 * Build ExecutionContext from NetronMiddlewareContext
 */
export function buildExecutionContext(
  ctx: NetronMiddlewareContext,
  authContext?: AuthContext,
): ExecutionContext {
  const execCtx: ExecutionContext = {
    auth: authContext,
    service: {
      name: ctx.serviceName || 'unknown',
      version: '1.0.0', // TODO: Extract from service metadata
    },
  };

  // Add method information if available
  if (ctx.methodName) {
    execCtx.method = {
      name: ctx.methodName,
      args: Array.isArray(ctx.input) ? ctx.input : [ctx.input],
    };
  }

  // Add environment information
  execCtx.environment = {
    timestamp: new Date(),
    transport: ctx.metadata?.get('transport') || 'unknown',
  };

  // Extract IP from metadata if available
  const clientIp = ctx.metadata?.get('clientIp') || ctx.metadata?.get('ip');
  if (clientIp) {
    execCtx.environment.ip = clientIp;
  }

  // Add request metadata
  execCtx.request = {
    headers: ctx.metadata?.get('headers') || {},
    metadata: Object.fromEntries(ctx.metadata || new Map()),
  };

  return execCtx;
}

/**
 * Read @Method metadata from service prototype
 */
export function readMethodMetadata(
  serviceInstance: any,
  methodName: string,
): MethodOptions | undefined {
  if (!serviceInstance || !methodName) {
    return undefined;
  }

  const prototype = Object.getPrototypeOf(serviceInstance);

  // Try to read complete METHOD_OPTIONS first
  const methodOptions = Reflect.getMetadata(
    METADATA_KEYS.METHOD_OPTIONS,
    prototype,
    methodName,
  );

  if (methodOptions) {
    return methodOptions;
  }

  // Fallback: construct from individual metadata keys
  const auth = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, prototype, methodName);
  const rateLimit = Reflect.getMetadata(METADATA_KEYS.METHOD_RATE_LIMIT, prototype, methodName);
  const cache = Reflect.getMetadata(METADATA_KEYS.METHOD_CACHE, prototype, methodName);
  const prefetch = Reflect.getMetadata(METADATA_KEYS.METHOD_PREFETCH, prototype, methodName);
  const audit = Reflect.getMetadata(METADATA_KEYS.METHOD_AUDIT, prototype, methodName);

  if (!auth && !rateLimit && !cache && !prefetch && !audit) {
    return undefined;
  }

  return {
    auth,
    rateLimit,
    cache,
    prefetch,
    audit,
  };
}

/**
 * Extract auth context from peer
 */
function getAuthContext(ctx: NetronMiddlewareContext): AuthContext | undefined {
  // Try to get auth context from RemotePeer
  if ('getAuthContext' in ctx.peer && typeof ctx.peer.getAuthContext === 'function') {
    return (ctx.peer as RemotePeer).getAuthContext();
  }

  // Fallback: try to get from metadata
  return ctx.metadata?.get('authContext');
}

/**
 * Create authentication middleware
 * Evaluates auth configuration from @Method decorator
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareFunction {
  const { policyEngine, logger, skipServices = [], skipMethods = [] } = options;

  return async (ctx, next) => {
    // Skip if no service/method specified
    if (!ctx.serviceName || !ctx.methodName) {
      return next();
    }

    // Skip if service or method is in skip list
    if (
      skipServices.includes(ctx.serviceName) ||
      skipMethods.includes(`${ctx.serviceName}.${ctx.methodName}`)
    ) {
      logger.debug(
        { service: ctx.serviceName, method: ctx.methodName },
        'Skipping auth for service/method',
      );
      return next();
    }

    // Get service instance from metadata
    const serviceInstance = ctx.metadata?.get('serviceInstance');
    if (!serviceInstance) {
      logger.debug('No service instance in context, skipping auth');
      return next();
    }

    // Read @Method metadata
    const methodMetadata = readMethodMetadata(serviceInstance, ctx.methodName);
    if (!methodMetadata?.auth) {
      // No auth configured for this method
      return next();
    }

    // Get auth context from peer
    const authContext = getAuthContext(ctx);

    // Check if auth is required
    if (typeof methodMetadata.auth === 'boolean') {
      if (methodMetadata.auth && !authContext) {
        throw new TitanError({
          code: ErrorCode.UNAUTHENTICATED,
          message: 'Authentication required',
          details: {
            service: ctx.serviceName,
            method: ctx.methodName,
          },
        });
      }
      return next();
    }

    // Handle object-based auth configuration
    const authConfig = methodMetadata.auth;

    // Check if anonymous access is allowed
    if (authConfig.allowAnonymous && !authContext) {
      logger.debug(
        { service: ctx.serviceName, method: ctx.methodName },
        'Anonymous access allowed',
      );
      return next();
    }

    // Authentication required if not anonymous
    if (!authContext) {
      throw new TitanError({
        code: ErrorCode.UNAUTHENTICATED,
        message: 'Authentication required',
        details: {
          service: ctx.serviceName,
          method: ctx.methodName,
        },
      });
    }

    // Build execution context for policy evaluation
    const execContext = buildExecutionContext(ctx, authContext);

    // Check roles
    if (authConfig.roles && authConfig.roles.length > 0) {
      const hasRequiredRole = authConfig.roles.some((role) =>
        authContext.roles.includes(role),
      );

      if (!hasRequiredRole) {
        logger.warn(
          {
            service: ctx.serviceName,
            method: ctx.methodName,
            requiredRoles: authConfig.roles,
            userRoles: authContext.roles,
          },
          'User lacks required role',
        );

        throw new TitanError({
          code: ErrorCode.FORBIDDEN,
          message: 'Insufficient permissions',
          details: {
            service: ctx.serviceName,
            method: ctx.methodName,
            required: authConfig.roles,
            actual: authContext.roles,
          },
        });
      }
    }

    // Check permissions
    if (authConfig.permissions && authConfig.permissions.length > 0) {
      const hasAllPermissions = authConfig.permissions.every((perm) =>
        authContext.permissions.includes(perm),
      );

      if (!hasAllPermissions) {
        const missingPermissions = authConfig.permissions.filter(
          (perm) => !authContext.permissions.includes(perm),
        );

        logger.warn(
          {
            service: ctx.serviceName,
            method: ctx.methodName,
            missingPermissions,
          },
          'User lacks required permissions',
        );

        throw new TitanError({
          code: ErrorCode.FORBIDDEN,
          message: 'Insufficient permissions',
          details: {
            service: ctx.serviceName,
            method: ctx.methodName,
            missing: missingPermissions,
          },
        });
      }
    }

    // Check scopes (OAuth2)
    if (authConfig.scopes && authConfig.scopes.length > 0) {
      const hasAllScopes = authConfig.scopes.every((scope) =>
        authContext.scopes?.includes(scope),
      );

      if (!hasAllScopes) {
        const missingScopes = authConfig.scopes.filter(
          (scope) => !authContext.scopes?.includes(scope),
        );

        logger.warn(
          {
            service: ctx.serviceName,
            method: ctx.methodName,
            missingScopes,
          },
          'User lacks required scopes',
        );

        throw new TitanError({
          code: ErrorCode.FORBIDDEN,
          message: 'Insufficient scopes',
          details: {
            service: ctx.serviceName,
            method: ctx.methodName,
            missing: missingScopes,
          },
        });
      }
    }

    // Evaluate policies
    if (authConfig.policies) {
      let policyDecision;

      if (Array.isArray(authConfig.policies)) {
        // Array of policy names - evaluate all (AND logic)
        policyDecision = await policyEngine.evaluateAll(
          authConfig.policies,
          execContext,
        );
      } else if ('all' in authConfig.policies) {
        // Explicit AND logic
        policyDecision = await policyEngine.evaluateAll(
          authConfig.policies.all,
          execContext,
        );
      } else if ('any' in authConfig.policies) {
        // Explicit OR logic
        policyDecision = await policyEngine.evaluateAny(
          authConfig.policies.any,
          execContext,
        );
      } else {
        // Policy expression (complex AND/OR/NOT)
        policyDecision = await policyEngine.evaluateExpression(
          authConfig.policies as PolicyExpression,
          execContext,
        );
      }

      if (!policyDecision.allowed) {
        logger.warn(
          {
            service: ctx.serviceName,
            method: ctx.methodName,
            reason: policyDecision.reason,
            userId: authContext.userId,
          },
          'Policy evaluation failed',
        );

        throw new TitanError({
          code: ErrorCode.FORBIDDEN,
          message: policyDecision.reason || 'Access denied by policy',
          details: {
            service: ctx.serviceName,
            method: ctx.methodName,
            policyDecision,
          },
        });
      }

      logger.debug(
        {
          service: ctx.serviceName,
          method: ctx.methodName,
          userId: authContext.userId,
          evaluationTime: policyDecision.evaluationTime,
        },
        'Policy evaluation succeeded',
      );
    }

    // All checks passed, proceed to next middleware
    await next();
  };
}

/**
 * Built-in auth middleware factory
 */
export class NetronAuthMiddleware {
  /**
   * Create authentication middleware
   */
  static create(options: AuthMiddlewareOptions): MiddlewareFunction {
    return createAuthMiddleware(options);
  }
}
