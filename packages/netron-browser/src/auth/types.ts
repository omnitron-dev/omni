/**
 * Authentication types for Netron Browser Client
 * Adapted from @omnitron-dev/titan/netron/auth for browser compatibility
 */

/**
 * Authentication credentials
 */
export interface AuthCredentials {
  /** Username or email */
  username?: string;

  /** Password (for password-based auth) */
  password?: string;

  /** Token (for token-based auth) */
  token?: string;

  /** Custom credentials */
  [key: string]: any;
}

/**
 * Authentication context
 * Contains user identity and authorization data
 */
export interface AuthContext {
  /** Unique user identifier */
  userId: string;

  /** User roles for RBAC */
  roles: string[];

  /** User permissions */
  permissions: string[];

  /** OAuth2/OIDC scopes */
  scopes?: string[];

  /** Token metadata */
  token?: {
    type: 'bearer' | 'mac' | 'custom';
    expiresAt?: Date;
    issuer?: string;
    audience?: string[];
  };

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication was successful */
  success: boolean;

  /** Auth context if successful */
  context?: AuthContext;

  /** Error message if failed */
  error?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Token storage interface
 * Can be implemented to use localStorage, sessionStorage, or custom storage
 */
export interface TokenStorage {
  /** Get stored token */
  getToken(): string | null;

  /** Set token */
  setToken(token: string): void;

  /** Remove token */
  removeToken(): void;

  /** Check if token exists */
  hasToken(): boolean;
}

/**
 * Authentication options for client
 */
export interface AuthOptions {
  /** Token storage implementation */
  storage?: TokenStorage;

  /** Storage key for token */
  storageKey?: string;

  /** Auto-refresh token before expiry */
  autoRefresh?: boolean;

  /** Refresh threshold (ms before expiry to refresh) */
  refreshThreshold?: number;

  /** Include auth token in all requests */
  autoAttach?: boolean;
}

/**
 * Auth state
 */
export interface AuthState {
  /** Whether user is authenticated */
  authenticated: boolean;

  /** Current auth context */
  context?: AuthContext;

  /** Current token */
  token?: string;

  /** Token expiry time */
  expiresAt?: Date;
}
