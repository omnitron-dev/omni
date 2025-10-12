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
 */
export function isAuthenticateResponse(obj: any): obj is AuthenticateResponse {
  return obj && typeof obj === 'object' && 'success' in obj && typeof obj.success === 'boolean';
}
