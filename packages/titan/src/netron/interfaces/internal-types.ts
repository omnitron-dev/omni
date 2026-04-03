/**
 * Internal type definitions for Netron framework.
 * These types expose internal properties that are accessed within the framework.
 *
 * @internal
 * @since 0.5.0
 */

import type { INetron, ILocalPeer } from './core-types.js';
import type { ServiceStub } from '../service-stub.js';
import type { AuthCredentials, AuthResult } from '../auth/types.js';

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
