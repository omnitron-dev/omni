/**
 * WebSocket Authentication Handler
 *
 * Provides connection-level authentication and per-message authorization
 * for WebSocket transport.
 *
 * Key differences from HTTP:
 * - Authentication happens ONCE at connection establishment
 * - Auth context is stored on connection for lifetime
 * - Per-message authorization still evaluates policies and decorator metadata
 */

import type { IncomingMessage } from 'node:http';
import type { AuthenticationManager } from '../../auth/authentication-manager.js';
import type { AuthorizationManager } from '../../auth/authorization-manager.js';
import type { PolicyEngine } from '../../auth/policy-engine.js';
import type { AuthContext, AuthResult, ExecutionContext, PolicyExpression } from '../../auth/types.js';
import type { MethodOptions } from '../../../decorators/types.js';
import type { ILogger } from '../../../types/logger.js';
import { METADATA_KEYS } from '../../../decorators/core.js';
import type { ITokenTransport } from '../../auth/token-transport.js';
import { BearerTokenTransport } from '../../auth/token-transports/bearer.js';

/**
 * Options for WebSocket auth handler
 */
export interface WebSocketAuthOptions {
  /** Authentication manager for token validation */
  authenticationManager: AuthenticationManager;
  /** Authorization manager for access control (required for per-message auth) */
  authorizationManager: AuthorizationManager;
  /** Policy engine for complex policy evaluation */
  policyEngine?: PolicyEngine;
  /** Logger instance */
  logger?: ILogger;
  /** Allow anonymous connections (default: false) */
  allowAnonymous?: boolean;
  /** Custom header name for auth token (default: 'authorization') */
  authHeaderName?: string;
  /**
   * Token transport strategy. When provided, the upgrade handshake
   * uses `tokenTransport.extract(req)` to read the token (cookie /
   * bearer / composite, configurable per deployment). When omitted,
   * the handler falls back to a default {@link BearerTokenTransport}
   * — preserving the historical "Authorization header or ?token="
   * behaviour exactly.
   */
  tokenTransport?: ITokenTransport;
  /**
   * Allowed Origin header values for WebSocket upgrade. Required for
   * cookie-mode deployments: browsers ship the auth cookie on any
   * upgrade from a context that holds the cookie, INCLUDING upgrades
   * initiated by a malicious cross-origin page. Without an Origin
   * check, the server can't tell the legitimate same-origin upgrade
   * from a forged one.
   *
   * Semantics:
   *  - `undefined` (default): NO Origin enforcement (legacy behaviour
   *    — fine for bearer-only deployments because the attacker would
   *    also need a JWT, which they don't have cross-origin).
   *  - `true`: REQUIRE that the Origin header matches the host of
   *    the upgrade request. Use when you only ever expect same-origin
   *    upgrades (the standard cookie-mode deployment).
   *  - `string[]`: whitelist of exact origins to allow. Use when
   *    legitimate clients live on multiple known origins (e.g., a
   *    portal subdomain + an admin subdomain on the same root).
   *
   * Missing Origin header (non-browser clients) is treated as a
   * pass — only browsers send Origin, and S2S clients that hit the
   * WS endpoint must use bearer-token auth which is CSRF-immune.
   */
  allowedOrigins?: true | string[];
}

/**
 * Result of per-message access check
 */
export interface MessageAccessResult {
  allowed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Build ExecutionContext for WebSocket message
 */
function buildExecutionContext(
  authContext: AuthContext | undefined,
  serviceName: string,
  methodName: string,
  args: unknown[] = [],
  metadata?: Map<string, unknown>
): ExecutionContext {
  const execCtx: ExecutionContext = {
    auth: authContext,
    service: {
      name: serviceName,
      version: '1.0.0',
    },
    method: {
      name: methodName,
      args,
    },
    environment: {
      timestamp: new Date(),
      transport: 'websocket',
    },
    request: {
      metadata: metadata ? Object.fromEntries(metadata) : {},
    },
  };

  // Extract IP from metadata if available
  const clientIp = metadata?.get('clientIp') || metadata?.get('ip');
  if (clientIp && typeof clientIp === 'string') {
    execCtx.environment!.ip = clientIp;
  }

  return execCtx;
}

/**
 * Read @Public metadata from service prototype
 */
function readMethodMetadata(serviceInstance: object | null | undefined, methodName: string): MethodOptions | undefined {
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
  if (!auth) {
    return undefined;
  }

  return { auth };
}

/**
 * WebSocket Authentication Handler
 *
 * Handles authentication at WebSocket connection time and
 * per-message authorization with full policy support.
 */
export class WebSocketAuthHandler {
  private readonly authManager: AuthenticationManager;
  private readonly authzManager: AuthorizationManager;
  private readonly policyEngine?: PolicyEngine;
  private readonly logger?: ILogger;
  private readonly allowAnonymous: boolean;
  private readonly authHeaderName: string;
  private readonly tokenTransport: ITokenTransport;
  private readonly allowedOrigins: true | string[] | undefined;

  constructor(options: WebSocketAuthOptions) {
    this.authManager = options.authenticationManager;
    this.authzManager = options.authorizationManager;
    this.policyEngine = options.policyEngine;
    this.logger = options.logger;
    this.allowAnonymous = options.allowAnonymous ?? false;
    this.authHeaderName = options.authHeaderName ?? 'authorization';
    // Default to bearer-with-?token=-fallback so existing tests / WS
    // clients keep working when this handler is constructed without
    // an explicit transport (which is what the legacy ws/server code
    // does today). The Netron-wired pathway passes the netron-level
    // tokenTransport so cookie/composite modes propagate automatically.
    this.tokenTransport =
      options.tokenTransport ??
      new BearerTokenTransport({ headerName: this.authHeaderName, queryParamName: 'token' });
    this.allowedOrigins = options.allowedOrigins;
  }

  /**
   * Check that the upgrade's Origin header matches the configured
   * policy. Returns true when no policy is configured (legacy mode)
   * or when the origin matches.
   *
   * Policy semantics:
   *  - undefined: pass (origin not enforced)
   *  - true:      require same-host (origin's host equals request.headers.host)
   *  - string[]:  exact-match against the whitelist
   */
  private isOriginAllowed(origin: string, request: IncomingMessage): boolean {
    if (this.allowedOrigins === undefined) return true;
    let originHost: string;
    try {
      const u = new URL(origin);
      originHost = u.host;
    } catch {
      return false; // malformed origin
    }
    if (this.allowedOrigins === true) {
      const reqHost = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host;
      return originHost === reqHost;
    }
    // Whitelist mode — match the full origin string OR its host.
    return this.allowedOrigins.some((allowed) => allowed === origin || allowed === originHost);
  }

  /**
   * Authenticate WebSocket connection from upgrade request
   * Called once when connection is established
   *
   * @param request - HTTP upgrade request with headers
   * @returns Authentication result with context if successful
   */
  async authenticateConnection(request: IncomingMessage): Promise<AuthResult> {
    // Origin guard (T#176-sec): cookies are sent on any same-host
    // upgrade, so a malicious cross-origin page can forge an upgrade
    // request and inherit the victim's session if the server doesn't
    // verify the Origin header. Browsers always send Origin on WS
    // upgrades; non-browser clients (S2S) lack it and use bearer
    // tokens that are CSRF-immune — so a missing Origin is a soft
    // pass, while a present-but-mismatched Origin is a hard reject.
    const originHeader = request.headers['origin'];
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    if (origin && !this.isOriginAllowed(origin, request)) {
      this.logger?.warn?.({ origin, host: request.headers.host }, '[WS Auth] Origin not allowed — rejecting upgrade');
      return { success: false, error: 'Origin not allowed' };
    }

    // Delegate token extraction to the configured transport: bearer
    // looks at the Authorization header (+ ?token= fallback), cookie
    // reads the Cookie header, composite tries both in order. Browsers
    // send cookies automatically on same-origin WS upgrade, so cookie
    // mode needs no client-side URL trickery.
    const token = this.tokenTransport.extract({
      headers: request.headers as Record<string, string | string[] | undefined>,
      url: request.url,
    });
    // Keep the legacy verbatim error message so existing assertions /
    // logged-error grep patterns continue to match. We can't be sure
    // which transport rejected (composite has multiple), and the
    // message remains accurate: cookie & bearer are both header-based
    // from the client's perspective, and the query-param hint
    // remains valid for the bearer + WS fallback case.
    if (!token) {
      if (this.allowAnonymous) {
        this.logger?.debug?.('[WS Auth] Anonymous connection allowed');
        return { success: true };
      }
      this.logger?.debug?.('[WS Auth] No auth token found (header or query param)');
      return {
        success: false,
        error: 'Authorization required (header or ?token= query param)',
      };
    }

    // Validate token with AuthenticationManager
    try {
      const result = await this.authManager.validateToken(token);

      if (result.success && result.context) {
        this.logger?.debug?.('[WS Auth] Connection authenticated', {
          userId: result.context.userId,
          roles: result.context.roles,
        });
      } else {
        this.logger?.debug?.('[WS Auth] Token validation failed', {
          error: result.error,
        });
      }

      return result;
    } catch (error) {
      this.logger?.error?.('[WS Auth] Authentication error', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  /**
   * Check if authenticated connection can access a specific method
   * Uses AuthorizationManager ACLs for access control
   *
   * @param authContext - Connection's auth context
   * @param serviceName - Target service name
   * @param methodName - Target method name
   * @returns Whether access is allowed
   */
  canAccessMethod(authContext: AuthContext | undefined, serviceName: string, methodName: string): boolean {
    // Anonymous access
    if (!authContext) {
      return this.allowAnonymous;
    }

    // Delegate to AuthorizationManager for ACL-based access control
    return this.authzManager.canAccessMethod(serviceName, methodName, authContext);
  }

  /**
   * Validate access with specific requirements
   * Delegates to AuthorizationManager.validateAccess
   *
   * @param authContext - Connection's auth context
   * @param requirements - Access requirements
   * @returns Validation result
   */
  validateAccess(
    authContext: AuthContext | undefined,
    requirements: {
      roles?: string[];
      permissions?: string[];
      scopes?: string[];
    }
  ): MessageAccessResult {
    if (!authContext) {
      if (this.allowAnonymous) {
        return { allowed: true };
      }
      return { allowed: false, reason: 'Authentication required' };
    }

    return this.authzManager.validateAccess(authContext, requirements);
  }

  /**
   * Full per-message authorization check with decorator metadata and policies
   *
   * This is the comprehensive authorization check that:
   * 1. Reads @Public decorator metadata
   * 2. Validates roles/permissions/scopes via AuthorizationManager
   * 3. Evaluates policies via PolicyEngine
   *
   * @param authContext - Connection's auth context
   * @param serviceName - Target service name
   * @param methodName - Target method name
   * @param serviceInstance - Service instance for reading decorator metadata
   * @param args - Method arguments (for policy evaluation context)
   * @param metadata - Additional metadata
   * @returns Full access validation result
   */
  async authorizeMessage(
    authContext: AuthContext | undefined,
    serviceName: string,
    methodName: string,
    serviceInstance?: object,
    args: unknown[] = [],
    metadata?: Map<string, unknown>
  ): Promise<MessageAccessResult> {
    // Read @Public decorator metadata
    const methodMetadata = readMethodMetadata(serviceInstance, methodName);

    // No auth configured for this method - allow
    if (!methodMetadata?.auth) {
      return { allowed: true };
    }

    // Check if auth is required (boolean form)
    if (typeof methodMetadata.auth === 'boolean') {
      if (methodMetadata.auth && !authContext) {
        return { allowed: false, reason: 'Authentication required' };
      }
      return { allowed: true };
    }

    // Object-based auth configuration
    const authConfig = methodMetadata.auth;

    // Check anonymous access
    if (authConfig.allowAnonymous && !authContext) {
      this.logger?.debug?.({ serviceName, methodName }, '[WS Auth] Anonymous access allowed');
      return { allowed: true };
    }

    // Authentication required
    if (!authContext) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // Validate access using AuthorizationManager
    const accessResult = this.authzManager.validateAccess(authContext, {
      roles: authConfig.roles,
      permissions: authConfig.permissions,
      scopes: authConfig.scopes,
    });

    if (!accessResult.allowed) {
      this.logger?.warn?.(
        {
          serviceName,
          methodName,
          reason: accessResult.reason,
          details: accessResult.details,
        },
        '[WS Auth] Access validation failed'
      );
      return accessResult;
    }

    // Evaluate policies if PolicyEngine is available
    if (authConfig.policies && this.policyEngine) {
      const execContext = buildExecutionContext(authContext, serviceName, methodName, args, metadata);

      try {
        let policyDecision;

        if (Array.isArray(authConfig.policies)) {
          // Array of policy names - evaluate all (AND logic)
          policyDecision = await this.policyEngine.evaluateAll(authConfig.policies, execContext);
        } else if (
          typeof authConfig.policies === 'object' &&
          'all' in authConfig.policies &&
          Array.isArray(authConfig.policies.all)
        ) {
          // Explicit AND logic
          policyDecision = await this.policyEngine.evaluateAll(authConfig.policies.all as string[], execContext);
        } else if (
          typeof authConfig.policies === 'object' &&
          'any' in authConfig.policies &&
          Array.isArray(authConfig.policies.any)
        ) {
          // Explicit OR logic
          policyDecision = await this.policyEngine.evaluateAny(authConfig.policies.any as string[], execContext);
        } else {
          // Policy expression (complex AND/OR/NOT)
          policyDecision = await this.policyEngine.evaluateExpression(
            authConfig.policies as PolicyExpression,
            execContext
          );
        }

        if (!policyDecision.allowed) {
          this.logger?.warn?.(
            {
              serviceName,
              methodName,
              reason: policyDecision.reason,
              userId: authContext.userId,
            },
            '[WS Auth] Policy evaluation failed'
          );

          return {
            allowed: false,
            reason: policyDecision.reason || 'Access denied by policy',
            details: { policyDecision },
          };
        }

        this.logger?.debug?.(
          {
            serviceName,
            methodName,
            userId: authContext.userId,
            evaluationTime: policyDecision.evaluationTime,
          },
          '[WS Auth] Policy evaluation succeeded'
        );
      } catch (error) {
        this.logger?.error?.('[WS Auth] Policy evaluation error', { error, serviceName, methodName });
        return {
          allowed: false,
          reason: error instanceof Error ? error.message : 'Policy evaluation failed',
        };
      }
    } else if (authConfig.policies && !this.policyEngine) {
      this.logger?.warn?.({ serviceName, methodName }, '[WS Auth] Policies defined but PolicyEngine not configured');
    }

    return { allowed: true };
  }
}

/**
 * Create a WebSocket auth handler
 */
export function createWebSocketAuthHandler(
  authManager: AuthenticationManager,
  authzManager: AuthorizationManager,
  options?: Partial<Omit<WebSocketAuthOptions, 'authenticationManager' | 'authorizationManager'>>
): WebSocketAuthHandler {
  return new WebSocketAuthHandler({
    authenticationManager: authManager,
    authorizationManager: authzManager,
    ...options,
  });
}
