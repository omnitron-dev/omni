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

  /** Get stored value by key */
  getValue(key: string): string | null;

  /** Set value by key */
  setValue(key: string, value: string): void;

  /** Remove value by key */
  removeValue(key: string): void;
}

/**
 * Refresh token configuration
 */
export interface RefreshConfig {
  /** Refresh endpoint URL */
  endpoint: string;

  /** HTTP method (default: POST) */
  method?: 'POST' | 'GET' | 'PUT';

  /** Custom headers */
  headers?: Record<string, string>;

  /** Request body builder (receives refresh token) */
  buildBody?: (refreshToken: string) => any;
}

/**
 * Logout configuration
 */
export interface LogoutConfig {
  /** Logout endpoint URL */
  endpoint: string;

  /** HTTP method (default: POST) */
  method?: 'POST' | 'GET' | 'DELETE';

  /** Custom headers */
  headers?: Record<string, string>;

  /** Include access token in request */
  includeToken?: boolean;
}

/**
 * Inactivity configuration
 */
export interface InactivityConfig {
  /** Timeout in milliseconds (default: 30 minutes) */
  timeout?: number;

  /** Events to track (default: ['click', 'keypress', 'mousemove']) */
  events?: string[];

  /** Callback when inactivity timeout occurs */
  onInactivity?: () => void;
}

/**
 * Cross-tab sync configuration
 */
export interface CrossTabSyncConfig {
  /** Enable cross-tab synchronization (default: true) */
  enabled?: boolean;

  /** Storage key for sync events (default: 'netron_auth_sync') */
  syncKey?: string;
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** Session ID */
  sessionId: string;

  /** Login timestamp */
  loginTime: Date;

  /** Device/browser info */
  deviceInfo?: {
    userAgent?: string;
    platform?: string;
    language?: string;
  };

  /** Custom metadata */
  [key: string]: any;
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

  /** Refresh token configuration */
  refreshConfig?: RefreshConfig;

  /** Logout configuration */
  logoutConfig?: LogoutConfig;

  /** Inactivity timeout configuration */
  inactivityConfig?: InactivityConfig;

  /** Cross-tab synchronization configuration */
  crossTabSync?: CrossTabSyncConfig;
}

/**
 * Auth state
 */
export interface AuthState {
  /** Whether user is authenticated */
  authenticated: boolean;

  /** Current auth context */
  context?: AuthContext;

  /** Current access token */
  token?: string;

  /** Token expiry time */
  expiresAt?: Date;

  /** Refresh token */
  refreshToken?: string;

  /** Refresh token expiry time */
  refreshTokenExpiresAt?: Date;

  /** Session metadata */
  sessionMetadata?: SessionMetadata;
}
