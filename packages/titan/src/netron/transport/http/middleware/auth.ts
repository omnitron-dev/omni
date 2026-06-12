/**
 * Authentication and Authorization Middleware for Netron
 * Integrates with @Public decorator metadata and PolicyEngine
 */

import type { NetronMiddlewareContext, MiddlewareFunction } from './types.js';
import type { AuthContext, ExecutionContext } from '../../../auth/types.js';
import type { MethodOptions } from '../../../../decorators/types.js';
import type { PolicyEngine } from '../../../auth/policy-engine.js';
import type { AuthorizationManager } from '../../../auth/authorization-manager.js';
import type { ILogger } from '../../../../modules/logger/logger.types.js';
import { METADATA_KEYS } from '../../../../decorators/core.js';
import { enforceMethodAuthorization } from '../../../auth/method-authorization.js';
import { TitanError, ErrorCode } from '../../../../errors/index.js';
import type { RemotePeer } from '../../../remote-peer.js';

/**
 * Options for auth middleware
 */
export interface AuthMiddlewareOptions {
  /**
   * Policy engine for evaluating `authConfig.policies` expressions on
   * decorated methods. Optional — when omitted, methods that declare
   * `policies: [...]` fail closed (FORBIDDEN) at request time. Role +
   * permission + scope enforcement via `authorizationManager` works
   * unconditionally regardless of whether a policy engine is supplied.
   */
  policyEngine?: PolicyEngine;

  /** Authorization manager for role/permission/scope validation (required) */
  authorizationManager: AuthorizationManager;

  /** Logger instance */
  logger: ILogger;

  /** Skip authentication for specific services */
  skipServices?: string[];

  /** Skip authentication for specific methods */
  skipMethods?: string[];

  /**
   * SEC-2 opt-in default-deny. When `true`, a method gated by NEITHER a
   * registered ACL NOR a `@Public({ auth })` decorator is denied (FORBIDDEN)
   * instead of allowed. Mirrors `RemotePeer.enforceMethodAccess` step (3) so the
   * HTTP and persistent-transport paths share the same fail-closed posture.
   * Threaded from `Netron` options (`authDefaultDeny`). Default: `false`.
   */
  defaultDeny?: boolean;
}

/**
 * Build ExecutionContext from NetronMiddlewareContext
 */
export function buildExecutionContext(ctx: NetronMiddlewareContext, authContext?: AuthContext): ExecutionContext {
  // Extract service version from metadata
  let serviceVersion = '1.0.0'; // default
  const serviceInstance = ctx.metadata?.get('serviceInstance');
  if (serviceInstance) {
    // Try to get version from service metadata
    const serviceMeta = Reflect.getMetadata('netron:service', serviceInstance.constructor);
    if (serviceMeta?.version) {
      serviceVersion = serviceMeta.version;
    }
  }

  const execCtx: ExecutionContext = {
    auth: authContext,
    service: {
      name: ctx.serviceName || 'unknown',
      version: serviceVersion,
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
  const transport = ctx.metadata?.get('transport');
  execCtx.environment = {
    timestamp: new Date(),
    transport: typeof transport === 'string' ? transport : 'unknown',
  };

  // Extract IP from metadata if available
  const clientIp = ctx.metadata?.get('clientIp') || ctx.metadata?.get('ip');
  if (clientIp && typeof clientIp === 'string') {
    execCtx.environment.ip = clientIp;
  }

  // Add request metadata
  const headers = ctx.metadata?.get('headers');
  execCtx.request = {
    headers: typeof headers === 'object' && headers !== null ? (headers as Record<string, string>) : {},
    metadata: Object.fromEntries(ctx.metadata || new Map()),
  };

  return execCtx;
}

/**
 * Read @Public metadata from service prototype
 */
export function readMethodMetadata(
  serviceInstance: object | null | undefined,
  methodName: string
): MethodOptions | undefined {
  if (!serviceInstance || !methodName) {
    return undefined;
  }

  const prototype = Object.getPrototypeOf(serviceInstance);

  // Try to read complete METHOD_OPTIONS first
  const methodOptions = Reflect.getMetadata(METADATA_KEYS.METHOD_OPTIONS, prototype, methodName);

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
  const authContext = ctx.metadata?.get('authContext');
  return authContext && typeof authContext === 'object' ? (authContext as AuthContext) : undefined;
}

/**
 * Create authentication middleware
 * Evaluates auth configuration from @Public decorator
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareFunction {
  const { policyEngine, logger, authorizationManager, defaultDeny = false, skipServices = [], skipMethods = [] } =
    options;

  return async (ctx, next) => {
    // Skip if no service/method specified
    if (!ctx.serviceName || !ctx.methodName) {
      return next();
    }

    // Skip if service or method is in skip list
    if (skipServices.includes(ctx.serviceName) || skipMethods.includes(`${ctx.serviceName}.${ctx.methodName}`)) {
      logger.debug({ service: ctx.serviceName, method: ctx.methodName }, 'Skipping auth for service/method');
      return next();
    }

    // Get service instance from metadata
    const serviceInstance = ctx.metadata?.get('serviceInstance');
    if (!serviceInstance || typeof serviceInstance !== 'object') {
      logger.debug('No service instance in context, skipping auth');
      return next();
    }

    // Get auth context from peer
    const authContext = getAuthContext(ctx);

    // Delegate the authorization decision to the shared, transport-agnostic
    // enforcement that the persistent-transport wire path uses too. This is the
    // SINGLE source of truth for `@Public({ auth })` (roles/permissions/scopes +
    // policies, fail-closed) — so HTTP and WS/TCP/Unix can never diverge again
    // (the divergence was the SEC-1 root cause). Throws UNAUTHORIZED/FORBIDDEN
    // on denial; resolves (no-op) when the method declares no auth.
    const headers = ctx.metadata?.get('headers');
    const transport = ctx.metadata?.get('transport');
    const clientIp = ctx.metadata?.get('clientIp') || ctx.metadata?.get('ip');
    await enforceMethodAuthorization({
      serviceInstance,
      serviceName: ctx.serviceName,
      methodName: ctx.methodName,
      args: Array.isArray(ctx.input) ? ctx.input : [ctx.input],
      authContext,
      policyEngine,
      logger,
      transport: typeof transport === 'string' ? transport : 'http',
      ...(typeof clientIp === 'string' ? { clientIp } : {}),
      ...(typeof headers === 'object' && headers !== null ? { headers: headers as Record<string, string> } : {}),
    });

    // (SEC-2) opt-in default-deny — mirror of `RemotePeer.enforceMethodAccess`
    // step (3). `enforceMethodAuthorization` above returned without throwing,
    // which means the method declared no `@Public({ auth })` gate (a declared
    // gate that failed would have thrown). If it ALSO has no registered ACL, it
    // carries no access-control decision at all — fail closed when the
    // deployment opted into `authDefaultDeny`.
    if (defaultDeny) {
      const hasAcl = authorizationManager?.hasACL(ctx.serviceName) ?? false;
      const hasDecoratorAuth = readMethodMetadata(serviceInstance, ctx.methodName)?.auth !== undefined;
      if (!hasAcl && !hasDecoratorAuth) {
        logger.warn(
          { service: ctx.serviceName, method: ctx.methodName, userId: authContext?.userId },
          'Method access denied by default-deny policy (no ACL, no @Public auth gate)'
        );
        throw new TitanError({
          code: ErrorCode.FORBIDDEN,
          message: `Access denied to method ${ctx.serviceName}.${ctx.methodName}`,
          details: { service: ctx.serviceName, method: ctx.methodName },
        });
      }
    }

    // Store authContext in metadata for business logic access
    // Business logic can retrieve it with: ctx.metadata?.get('authContext')
    if (authContext) {
      ctx.metadata.set('authContext', authContext);
    }

    // All checks passed, proceed to next middleware
    return next();
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
