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
 * Core task name for authentication
 */
export const CORE_TASK_AUTHENTICATE = 'netron.authenticate';

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
