/**
 * Internal type definitions for Netron framework.
 * These types expose internal properties that are accessed within the framework.
 *
 * @internal
 * @since 0.5.0
 */

import type { INetron, ILocalPeer, IAuthorizationManager } from './core-types.js';
import type { ServiceStub } from '../service-stub.js';
import type { AuthCredentials, AuthResult } from '../auth/types.js';
import type { ITokenTransport } from '../auth/token-transport.js';
import type { PolicyEngine } from '../auth/policy-engine.js';

/**
 * Internal interface for AuthenticationManager.
 * Exposes methods that are accessed by transport servers and core-tasks.
 * @internal
 */
export interface IAuthenticationManager {
  /**
   * Authenticate a user with credentials
   * @param credentials - User credentials (username/password or token)
   * @returns Authentication result with context if successful
   */
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;

  /**
   * Validate a token and return auth context
   * @param token - Token to validate
   * @returns Authentication result with context if successful
   */
  validateToken(token: string): Promise<AuthResult>;

  /**
   * Invalidate a single token in the cache (T#37).
   * Returns `true` if a cached entry was removed. No-op when caching
   * is disabled or the token isn't cached.
   */
  invalidateToken(token: string): boolean;

  /**
   * Invalidate every cached AuthResult belonging to the given user
   * (T#37). Returns the count of removed entries.
   */
  invalidateUser(userId: string): number;

  /**
   * Clear the entire token cache (T#37). Use for shutdown or as a
   * last-resort revocation.
   */
  clearCache(): void;
}

/**
 * Extended Netron interface with internal properties.
 * This interface exposes internal properties that are accessed within the framework.
 * @internal
 */
export interface INetronInternal extends INetron {
  /**
   * Authentication manager for user authentication.
   * Optional - only present when authentication is configured.
   * @internal
   */
  authenticationManager?: IAuthenticationManager;

  /**
   * Authorization manager for method-level access control
   * (roles/permissions/scopes). Optional — only present when
   * authorization is configured via `Netron.configureAuth(authn, authz)`.
   * Transport servers read this to auto-wire NetronAuthMiddleware so
   * that `@Public({ auth: { roles, permissions, scopes } })`
   * decorations on services are enforced uniformly.
   * @internal
   */
  authorizationManager?: IAuthorizationManager;

  /**
   * Policy engine for `@Public({ auth: { policies } })` evaluation. Optional —
   * when a method declares `policies` but no engine is configured, the wire/HTTP
   * enforcement FAILS CLOSED. Read by `RemotePeer.enforceMethodAccess`.
   * @internal
   */
  policyEngine?: PolicyEngine;

  /**
   * Token transport strategy. The `Netron` class always initializes
   * this to a {@link BearerTokenTransport} default — but at the
   * interface level we leave it optional to match the existing
   * `authenticationManager` / `authorizationManager` pattern and keep
   * structural type compatibility with `LocalPeer.netron` casts. All
   * callers must use optional chaining (`netron?.tokenTransport`).
   * @internal
   */
  tokenTransport?: ITokenTransport;
}

/**
 * Extended LocalPeer interface with internal properties.
 * This interface exposes internal properties that are accessed within the framework.
 * @internal
 */
export interface ILocalPeerInternal extends ILocalPeer {
  /**
   * Map of service stubs indexed by definition ID.
   * @internal
   */
  stubs: Map<string, ServiceStub>;

  /**
   * Map of service instances to their corresponding stubs.
   * @internal
   */
  serviceInstances: Map<unknown, ServiceStub>;

  /**
   * Get a service stub by its definition ID.
   * @param defId - Definition ID
   * @returns Service stub
   * @throws {Error} If stub not found
   * @internal
   */
  getStubByDefinitionId(defId: string): ServiceStub;

  /**
   * Associated Netron instance with internal properties.
   * @internal
   */
  netron: INetronInternal;
}
