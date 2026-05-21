/**
 * Authentication module for Netron Browser Client
 */

// Types
export type {
  AuthCredentials,
  AuthContext,
  AuthResult,
  TokenStorage,
  AuthOptions,
  AuthState,
  RefreshConfig,
  LogoutConfig,
  InactivityConfig,
  CrossTabSyncConfig,
  SessionMetadata,
} from './types.js';

// Client
export { AuthenticationClient } from './client.js';
export type { AuthEventType, AuthEventHandler } from './client.js';

// Storage implementations
export { LocalTokenStorage, SessionTokenStorage, MemoryTokenStorage, NoopTokenStorage } from './storage.js';

// Token transport strategies (T#176)
export * from './client-token-transport.js';
export * from './client-token-transports/index.js';
