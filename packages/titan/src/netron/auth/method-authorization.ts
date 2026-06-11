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
import type { MethodOptions } from '../../decorators/types.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import { METADATA_KEYS } from '../../decorators/core.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import { validateAccessRequirements } from './utils.js';

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

  const methodOptions = Reflect.getMetadata(METADATA_KEYS.METHOD_OPTIONS, prototype, methodName);
  if (methodOptions) return methodOptions;

  // Fallback: assemble from individual metadata keys.
  const auth = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, prototype, methodName);
  const rateLimit = Reflect.getMetadata(METADATA_KEYS.METHOD_RATE_LIMIT, prototype, methodName);
  const cache = Reflect.getMetadata(METADATA_KEYS.METHOD_CACHE, prototype, methodName);
  const prefetch = Reflect.getMetadata(METADATA_KEYS.METHOD_PREFETCH, prototype, methodName);
  const audit = Reflect.getMetadata(METADATA_KEYS.METHOD_AUDIT, prototype, methodName);

  if (!auth && !rateLimit && !cache && !prefetch && !audit) return undefined;
  return { auth, rateLimit, cache, prefetch, audit };
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
  /** Transport label for the policy ExecutionContext. */
  transport?: string;
  clientIp?: string;
  headers?: Record<string, string>;
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
