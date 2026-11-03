/**
 * Transport-agnostic method authorization enforcement.
 *
 * Single source of truth for evaluating `@Public({ auth })` method metadata.
 * Used by BOTH the HTTP middleware and the persistent-transport wire path
 * (`RemotePeer.enforceMethodAccess`) so authorization can never diverge between
 * transports.
 *
 * This divergence WAS the critical SEC-1 finding: the `@Public({ auth })`
 * decorator was enforced on HTTP (via the auth middleware) but silently ignored
 * on WS / TCP / Unix, where the only gate was the ACL `canAccessMethod()` —
 * which is default-allow when no ACL is registered. A decorator-only-protected
 * admin method was therefore callable by any (or no) authenticated peer over
 * every persistent transport.
 *
 * Enforcement order for an object-form `auth` config:
 *   1. `allowAnonymous` + no auth context        → allow
 *   2. no auth context                           → 401 UNAUTHORIZED
 *   3. roles / permissions / scopes              → 403 FORBIDDEN on failure
 *   4. policies                                  → PolicyEngine; FAIL-CLOSED
 *      (403) if policies are declared but no engine is configured.
 */

import type { AuthContext, ExecutionContext, PolicyExpression } from './types.js';
import type { PolicyEngine } from './policy-engine.js';
import type { AuthorizationManager } from './authorization-manager.js';
import type { MethodOptions } from '../../decorators/types.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import { METADATA_KEYS } from '../../decorators/core.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import { validateAccessRequirements } from './utils.js';
import { transportSurfaceAllowed } from '../transport-policy.js';
import { Interface } from '../interface.js';

/**
 * Read method-decorator options (`@Public`, `@Method`, …) from a service
 * instance's prototype. Returns the complete `MethodOptions` when present, or
 * reconstructs it from the individual metadata keys, or `undefined` when the
 * method carries no decorator metadata at all.
 */
export function readMethodMetadata(
  serviceInstance: object | null | undefined,
  methodName: string,
): MethodOptions | undefined {
  if (!serviceInstance || !methodName) return undefined;
  const prototype = Object.getPrototypeOf(serviceInstance);
  if (!prototype) return undefined;

  const options = Reflect.getMetadata(METADATA_KEYS.METHOD_OPTIONS, prototype, methodName) as MethodOptions | undefined;
  const result: MethodOptions = { ...options };
  // Composable decorators write these same keys independently. A @Public
  // transport option must never hide an @Auth declaration (in either order).
  const keys = {
    auth: METADATA_KEYS.METHOD_AUTH,
    rateLimit: METADATA_KEYS.METHOD_RATE_LIMIT,
    cache: METADATA_KEYS.METHOD_CACHE,
    prefetch: METADATA_KEYS.METHOD_PREFETCH,
    audit: METADATA_KEYS.METHOD_AUDIT,
    transports: 'method:transports',
  } as const;
  for (const [field, key] of Object.entries(keys)) {
    const value: unknown = Reflect.getMetadata(key, prototype, methodName);
    if (value !== undefined) Object.assign(result, { [field]: value });
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Whether a member name is part of the service's PUBLISHED surface, decided
 * from the prototype alone.
 *
 * `@Public` records `public` / METHOD_ANNOTATION against the prototype for
 * methods AND properties alike, so this answer needs no instance. That matters:
 * `ServiceMetadata.properties` is assembled by calling `new target()` at
 * decoration time, which throws for every DI service whose constructor takes
 * arguments — so on a dependency-injected application that map is empty and a
 * whitelist built from it would reject every property, including the annotated
 * ones. Reading the annotation directly is the same question without the
 * instantiation.
 */
export function isPublishedMember(
  serviceInstance: object | null | undefined,
  name: string,
): boolean {
  if (!serviceInstance || !name) return false;
  const prototype = Object.getPrototypeOf(serviceInstance);
  if (!prototype) return false;
  return (
    Reflect.getMetadata('public', prototype, name) === true ||
    Reflect.getMetadata(METADATA_KEYS.METHOD_ANNOTATION, prototype, name) === true
  );
}

export interface EnforceMethodAuthorizationInput {
  /** Service instance whose prototype carries the decorator metadata. */
  serviceInstance: object | null | undefined;
  /** Qualified service name (e.g. "vault@1.0.0") for error/log context. */
  serviceName: string;
  /** Service version for the policy ExecutionContext; derived/defaulted if omitted. */
  serviceVersion?: string;
  /** Method being invoked. */
  methodName: string;
  /** Invocation arguments (for policy ABAC evaluation). */
  args?: unknown[];
  /** Server-resolved auth context for the caller, if authenticated. */
  authContext?: AuthContext;
  /** Policy engine for `policies` evaluation. Absent → fail-closed when policies declared. */
  policyEngine?: PolicyEngine;
  logger: ILogger;
  /** Canonical ingress identity supplied by the transport host, never request metadata. */
  transport?: string;
  /** Server-owned service restriction, intersected with the member declaration. */
  serviceTransports?: readonly string[];
  /** Restriction carried by the publisher, including forwarded interfaces. */
  memberTransports?: readonly string[];
  clientIp?: string;
  headers?: Record<string, string>;
}

/** Transport confinement remains mandatory even for an explicitly auth-exempt method. */
export function enforceInvocationTransport(input: EnforceMethodAuthorizationInput): void {
  const { serviceName, methodName, logger } = input;
  if (!transportSurfaceAllowed(input.serviceTransports, input.memberTransports,
    input.transport, readMethodMetadata(input.serviceInstance, methodName)?.transports)) {
    logger.warn({ serviceName, methodName, transport: input.transport }, 'Member is unavailable on this transport');
    throw new TitanError({ code: ErrorCode.NOT_FOUND, message: `Method '${serviceName}.${methodName}' not found` });
  }
}

/** A forwarding hop is a delegation boundary: upstream credentials never
 * authorize the incoming caller. Only an explicit gateway ACL can grant it.
 * Returns whether this invocation uses a forwarded interface.
 */
export function enforceForwardedAuthorization(input: EnforceMethodAuthorizationInput & {
  authorizationManager?: Pick<AuthorizationManager, 'canAccessMethod' | 'hasACL'>;
}): boolean {
  if (!(input.serviceInstance instanceof Interface)) return false;
  const { authorizationManager, serviceName, methodName, authContext, logger } = input;
  if (!authorizationManager?.hasACL(serviceName) ||
      !authorizationManager.canAccessMethod(serviceName, methodName, authContext)) {
    logger.warn({ serviceName, methodName, userId: authContext?.userId }, 'Forwarded invocation requires an explicit gateway ACL grant');
    throw new TitanError({ code: ErrorCode.FORBIDDEN,
      message: `Access denied to forwarded method ${serviceName}.${methodName}` });
  }
  return true;
}

/** The same complete access decision for every transport. An absent manager
 * means no registered ACLs, never permission to ignore a declared method gate.
 */
export async function enforceInvocationAuthorization(input: EnforceMethodAuthorizationInput & {
  authorizationManager?: Pick<AuthorizationManager, 'canAccessMethod' | 'hasACL'>;
  defaultDeny?: boolean;
}): Promise<void> {
  const { authorizationManager, serviceName, methodName, authContext, logger } = input;
  const refuse = (reason: string): never => {
    logger.warn({ serviceName, methodName, userId: authContext?.userId }, reason);
    throw new TitanError({ code: ErrorCode.FORBIDDEN,
      message: `Access denied to method ${serviceName}.${methodName}`,
      details: { service: serviceName, method: methodName } });
  };
  enforceInvocationTransport(input);
  const forwarded = enforceForwardedAuthorization(input);
  if (!forwarded && authorizationManager && !authorizationManager.canAccessMethod(serviceName, methodName, authContext))
    refuse('Method access denied by authorization manager (ACL)');
  await enforceMethodAuthorization(input);
  if (input.defaultDeny && !authorizationManager?.hasACL(serviceName) &&
      readMethodMetadata(input.serviceInstance, methodName)?.auth === undefined)
    refuse('Method access denied by default-deny policy (no ACL, no @Public auth gate)');
}

/**
 * Enforce `@Public({ auth })` for a single method invocation.
 *
 * Resolves when access is permitted (or no auth is configured for the method);
 * throws a `TitanError` (UNAUTHORIZED / FORBIDDEN) otherwise. This function is
 * pure with respect to authorization (it does not consult registered ACLs —
 * that remains the caller's responsibility where applicable), so it behaves
 * identically on every transport.
 */
export async function enforceMethodAuthorization(input: EnforceMethodAuthorizationInput): Promise<void> {
  const { serviceInstance, serviceName, methodName, authContext, policyEngine, logger } = input;

  const methodMetadata = readMethodMetadata(serviceInstance, methodName);
  // No auth configured for this method → nothing to enforce.
  if (!methodMetadata?.auth) return;

  const authConfig = methodMetadata.auth;

  // Boolean form: `auth: true` requires authentication; `auth: false` is open.
  if (typeof authConfig === 'boolean') {
    if (authConfig && !authContext) {
      throw new TitanError({
        code: ErrorCode.UNAUTHORIZED,
        message: 'Authentication required',
        details: { service: serviceName, method: methodName },
      });
    }
    return;
  }

  // Object form — anonymous fast-path.
  if (authConfig.allowAnonymous && !authContext) {
    logger.debug({ service: serviceName, method: methodName }, 'Anonymous access allowed');
    return;
  }

  // Authentication is mandatory beyond this point.
  if (!authContext) {
    throw new TitanError({
      code: ErrorCode.UNAUTHORIZED,
      message: 'Authentication required',
      details: { service: serviceName, method: methodName },
    });
  }

  // Roles / permissions / scopes.
  const access = validateAccessRequirements(authContext, {
    roles: authConfig.roles,
    permissions: authConfig.permissions,
    scopes: authConfig.scopes,
  });
  if (!access.allowed) {
    logger.warn(
      {
        service: serviceName,
        method: methodName,
        reason: access.reason,
        details: access.details,
        userId: authContext.userId,
      },
      'Access validation failed',
    );
    throw new TitanError({
      code: ErrorCode.FORBIDDEN,
      message: access.reason || 'Access denied',
      details: { service: serviceName, method: methodName, ...access.details },
    });
  }

  // Policies.
  if (authConfig.policies) {
    if (!policyEngine) {
      // Fail closed: a declared policy with no engine must NOT silently pass —
      // doing so would convert a policy guard into an open door (SEC-3).
      logger.error(
        { service: serviceName, method: methodName },
        'Method declares policies but no PolicyEngine is configured — denying',
      );
      throw new TitanError({
        code: ErrorCode.FORBIDDEN,
        message: 'Policy enforcement unavailable',
        details: { service: serviceName, method: methodName },
      });
    }

    const execContext = buildExecutionContext(input, authContext);
    const policies = authConfig.policies;
    let decision;
    if (Array.isArray(policies)) {
      decision = await policyEngine.evaluateAll(policies, execContext);
    } else if (typeof policies === 'object' && 'all' in policies && Array.isArray(policies.all)) {
      decision = await policyEngine.evaluateAll(policies.all as string[], execContext);
    } else if (typeof policies === 'object' && 'any' in policies && Array.isArray(policies.any)) {
      decision = await policyEngine.evaluateAny(policies.any as string[], execContext);
    } else {
      decision = await policyEngine.evaluateExpression(policies as PolicyExpression, execContext);
    }

    if (!decision.allowed) {
      logger.warn(
        { service: serviceName, method: methodName, reason: decision.reason, userId: authContext.userId },
        'Method access denied by policy',
      );
      throw new TitanError({
        code: ErrorCode.FORBIDDEN,
        message: decision.reason || 'Access denied by policy',
        details: { service: serviceName, method: methodName },
      });
    }

    logger.debug(
      {
        service: serviceName,
        method: methodName,
        userId: authContext.userId,
        evaluationTime: decision.evaluationTime,
      },
      'Policy evaluation succeeded',
    );
  }
}

/**
 * Build the policy ExecutionContext from the enforcement input. Service version
 * is taken from the input, falling back to the `netron:service` metadata on the
 * instance constructor, then to '1.0.0'.
 */
function buildExecutionContext(input: EnforceMethodAuthorizationInput, authContext: AuthContext): ExecutionContext {
  let serviceVersion = input.serviceVersion;
  if (!serviceVersion && input.serviceInstance) {
    const serviceMeta = Reflect.getMetadata('netron:service', input.serviceInstance.constructor);
    serviceVersion = serviceMeta?.version;
  }

  const execContext: ExecutionContext = {
    auth: authContext,
    service: { name: input.serviceName, version: serviceVersion || '1.0.0' },
    method: { name: input.methodName, args: input.args ?? [] },
    environment: {
      timestamp: new Date(),
      transport: input.transport || 'unknown',
    },
  };

  if (input.clientIp && execContext.environment) {
    execContext.environment.ip = input.clientIp;
  }
  if (input.headers) {
    execContext.request = { headers: input.headers, metadata: {} };
  }

  return execContext;
}
