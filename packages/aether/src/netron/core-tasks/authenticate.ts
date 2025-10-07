/**
 * Authentication core-task for Netron
 * Handles user authentication and stores auth context in peer
 */

import type { RemotePeer } from '../remote-peer.js';
import type { AuthCredentials, AuthResult } from '../auth/types.js';
import { TitanError, ErrorCode } from '../errors.js';

/**
 * Authenticate a peer using provided credentials
 *
 * This core-task:
 * 1. Validates credentials using AuthenticationManager
 * 2. Stores auth context in the RemotePeer if successful
 * 3. Returns authentication result
 *
 * @param peer - The remote peer requesting authentication
 * @param credentials - Authentication credentials (username/password or token)
 * @returns Authentication result with context if successful
 *
 * @throws {TitanError} When authentication is not configured or fails
 *
 * @example
 * // Authenticate with username/password
 * const result = await peer.runTask('authenticate', {
 *   username: 'user@example.com',
 *   password: 'secret123'
 * });
 *
 * @example
 * // Authenticate with token
 * const result = await peer.runTask('authenticate', {
 *   token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
 * });
 */
export async function authenticate(
  peer: RemotePeer,
  credentials: AuthCredentials,
): Promise<AuthResult> {
  // Get AuthenticationManager from Netron
  // Note: This will need to be exposed via netron.authenticationManager
  const authManager = (peer.netron as any).authenticationManager;

  if (!authManager) {
    throw new TitanError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: 'Authentication not configured',
      details: {
        hint: 'Call netron.configureAuth() to set up authentication',
      },
    });
  }

  let result: AuthResult;

  try {
    // If token is provided, use token validation
    if (credentials.token) {
      result = await authManager.validateToken(credentials.token);
    } else {
      // Otherwise use credential-based authentication
      result = await authManager.authenticate(credentials);
    }

    // Store auth context in peer if authentication succeeded
    if (result.success && result.context) {
      peer.setAuthContext(result.context);

      peer.logger.info(
        {
          userId: result.context.userId,
          roles: result.context.roles,
        },
        'Peer authenticated successfully',
      );
    } else {
      peer.logger.warn(
        {
          error: result.error,
        },
        'Authentication failed',
      );
    }

    return result;
  } catch (error: any) {
    peer.logger.error(
      {
        error,
        credentials: { ...credentials, password: '***', token: '***' },
      },
      'Authentication error',
    );

    return {
      success: false,
      error: error.message || 'Authentication failed',
      metadata: {
        errorCode: error.code,
      },
    };
  }
}
