/**
 * Authentication core-task for Netron Browser Client
 * Adapted from Titan's authenticate task for client-side use
 */

import type { AuthCredentials, AuthResult } from '../auth/types.js';

/**
 * Authenticate request payload
 */
export interface AuthenticateRequest {
  credentials: AuthCredentials;
}

/**
 * Authenticate response
 */
export interface AuthenticateResponse extends AuthResult {}

/**
 * Core task name for authentication.
 *
 * MUST be the BARE task name — the server's TaskManager routes by `fn.name`
 * (`export async function authenticate(...)` → `'authenticate'`) and matches it
 * exactly via `tasks.get(name)`. A `netron.`-prefixed value never matched, so
 * this constant was dead (NB-2). (Long-term these live in @omnitron-dev/
 * netron-protocol shared with the server — see SHARED-PROTO.)
 */
export const CORE_TASK_AUTHENTICATE = 'authenticate';

/**
 * Create an authenticate request
 */
export function createAuthenticateRequest(credentials: AuthCredentials): AuthenticateRequest {
  return { credentials };
}

/**
 * Validate authenticate response
 * Checks for proper success flag and context structure
 */
export function isAuthenticateResponse(obj: any): obj is AuthenticateResponse {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  if (!('success' in obj) || typeof obj.success !== 'boolean') {
    return false;
  }

  // Successful response must have context
  if (obj.success === true) {
    if (!obj.context || typeof obj.context !== 'object') {
      return false;
    }
    // Context must have userId
    if (!('userId' in obj.context)) {
      return false;
    }
  }

  return true;
}
