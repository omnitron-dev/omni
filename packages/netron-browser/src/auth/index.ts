/**
 * Authentication module for Netron Browser Client
 */

// Types
export type { AuthCredentials, AuthContext, AuthResult, TokenStorage, AuthOptions, AuthState } from './types.js';

// Client
export { AuthenticationClient } from './client.js';
export type { AuthEventType, AuthEventHandler } from './client.js';

// Storage implementations
export { LocalTokenStorage, SessionTokenStorage, MemoryTokenStorage } from './storage.js';
