/**
 * Authentication client for Netron Browser
 * Handles authentication, token management, and auto-refresh
 */

import type {
  AuthContext,
  AuthResult,
  AuthOptions,
  AuthState,
  RefreshConfig,
  LogoutConfig,
  SessionMetadata,
  TokenStorage,
} from './types.js';
import { LocalTokenStorage } from './storage.js';

/**
 * Default options
 */
const DEFAULT_OPTIONS = {
  storage: new LocalTokenStorage(),
  storageKey: 'netron_auth_token',
  autoRefresh: true,
  refreshThreshold: 5 * 60 * 1000, // 5 minutes
  autoAttach: true,
  refreshConfig: undefined as RefreshConfig | undefined,
  logoutConfig: undefined as LogoutConfig | undefined,
  inactivityConfig: {
    timeout: 30 * 60 * 1000, // 30 minutes
    events: ['click', 'keypress', 'mousemove'] as string[],
    onInactivity: undefined as (() => void) | undefined,
  },
  crossTabSync: {
    enabled: true,
    syncKey: 'netron_auth_sync',
  },
} as const;

/**
 * Authentication event types
 */
export type AuthEventType =
  | 'authenticated'
  | 'unauthenticated'
  | 'token-refreshed'
  | 'error'
  | 'inactivity'
  | 'cross-tab-sync';

/**
 * Authentication event handler
 */
export type AuthEventHandler = (data: any) => void;

/**
 * Serializable auth state for storage
 */
interface SerializableAuthState {
  authenticated: boolean;
  context?: AuthContext;
  token?: string;
  expiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
  sessionMetadata?: Omit<SessionMetadata, 'loginTime'> & { loginTime: string };
}

/**
 * Merged options type
 */
type MergedOptions = {
  storage: TokenStorage;
  storageKey: string;
  autoRefresh: boolean;
  refreshThreshold: number;
  autoAttach: boolean;
  refreshConfig?: RefreshConfig;
  logoutConfig?: LogoutConfig;
  inactivityConfig: {
    timeout?: number;
    events?: string[];
    onInactivity?: () => void;
  };
  crossTabSync: {
    enabled: boolean;
    syncKey: string;
  };
};

/**
 * Authentication client
 */
export class AuthenticationClient {
  private options: MergedOptions;
  private state: AuthState;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private inactivityTimer?: ReturnType<typeof setTimeout>;
  private lastActivity: number = Date.now();
  private eventHandlers = new Map<AuthEventType, Set<AuthEventHandler>>();
  private refreshPromise?: Promise<AuthResult>;
  private storageListener?: (event: StorageEvent) => void;
  private activityListener?: () => void;

  constructor(options: AuthOptions = {}) {
    // Initialize storage with custom key if provided
    const storage =
      options.storage || (options.storageKey ? new LocalTokenStorage(options.storageKey) : DEFAULT_OPTIONS.storage);

    this.options = {
      storage,
      storageKey: options.storageKey ?? DEFAULT_OPTIONS.storageKey,
      autoRefresh: options.autoRefresh ?? DEFAULT_OPTIONS.autoRefresh,
      refreshThreshold: options.refreshThreshold ?? DEFAULT_OPTIONS.refreshThreshold,
      autoAttach: options.autoAttach ?? DEFAULT_OPTIONS.autoAttach,
      refreshConfig: options.refreshConfig,
      logoutConfig: options.logoutConfig,
      inactivityConfig: {
        timeout: options.inactivityConfig?.timeout ?? DEFAULT_OPTIONS.inactivityConfig.timeout,
        events: options.inactivityConfig?.events ?? DEFAULT_OPTIONS.inactivityConfig.events,
        onInactivity: options.inactivityConfig?.onInactivity,
      },
      crossTabSync: {
        enabled: options.crossTabSync?.enabled ?? DEFAULT_OPTIONS.crossTabSync.enabled,
        syncKey: options.crossTabSync?.syncKey ?? DEFAULT_OPTIONS.crossTabSync.syncKey,
      },
    };

    this.state = {
      authenticated: false,
    };

    // Try to restore auth state from storage
    this.restoreFromStorage();

    // Enable cross-tab sync if configured
    if (this.options.crossTabSync.enabled) {
      this.enableCrossTabSync();
    }

    // Set up inactivity tracking if configured
    if (this.options.inactivityConfig.timeout && this.options.inactivityConfig.timeout > 0) {
      this.setupInactivityTracking();
    }
  }

  /**
   * Get current auth state
   */
  getState(): Readonly<AuthState> {
    return { ...this.state };
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.state.authenticated && !!this.state.context;
  }

  /**
   * Get current auth context
   */
  getContext(): AuthContext | undefined {
    return this.state.context;
  }

  /**
   * Get current access token
   */
  getToken(): string | undefined {
    return this.state.token;
  }

  /**
   * Get current refresh token
   */
  getRefreshToken(): string | undefined {
    return this.state.refreshToken;
  }

  /**
   * Get session metadata
   */
  getSessionMetadata(): SessionMetadata | undefined {
    return this.state.sessionMetadata;
  }

  /**
   * Set authentication context and token
   */
  setAuth(result: AuthResult): void {
    if (!result.success || !result.context) {
      return;
    }

    const token = result.context.token?.type === 'bearer' ? this.extractTokenValue(result) : undefined;
    const refreshToken = result.metadata?.refreshToken as string | undefined;

    // Create or update session metadata
    const sessionMetadata: SessionMetadata = this.state.sessionMetadata || {
      sessionId: this.generateSessionId(),
      loginTime: new Date(),
      deviceInfo: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
        language: typeof navigator !== 'undefined' ? navigator.language : undefined,
      },
    };

    this.state = {
      authenticated: true,
      context: result.context,
      token,
      expiresAt: result.context.token?.expiresAt ? new Date(result.context.token.expiresAt) : undefined,
      refreshToken,
      refreshTokenExpiresAt: result.metadata?.refreshTokenExpiresAt
        ? new Date(result.metadata.refreshTokenExpiresAt as any)
        : undefined,
      sessionMetadata,
    };

    // Persist entire state to storage
    this.persistToStorage();

    // Set up auto-refresh if enabled
    if (this.options.autoRefresh && this.state.expiresAt) {
      this.scheduleRefresh();
    }

    // Reset inactivity timer
    this.resetInactivityTimer();

    this.emit('authenticated', { context: result.context });
    this.notifyCrossTabSync('authenticated');
  }

  /**
   * Set refresh token
   */
  setRefreshToken(refreshToken: string, expiresAt?: Date): void {
    this.state.refreshToken = refreshToken;
    this.state.refreshTokenExpiresAt = expiresAt;
    this.persistToStorage();
  }

  /**
   * Clear authentication
   */
  clearAuth(): void {
    this.state = {
      authenticated: false,
    };

    this.clearStorage();
    this.cancelRefresh();
    this.cancelInactivityTimer();
    this.emit('unauthenticated', {});
    this.notifyCrossTabSync('unauthenticated');
  }

  /**
   * Logout (calls server endpoint if configured)
   */
  async logout(): Promise<void> {
    const config = this.options.logoutConfig;

    if (config) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...config.headers,
        };

        // Include access token if requested
        if (config.includeToken !== false && this.state.token) {
          headers.Authorization = `Bearer ${this.state.token}`;
        }

        const response = await fetch(config.endpoint, {
          method: config.method || 'POST',
          headers,
        });

        if (!response.ok) {
          throw new Error(`Logout failed: ${response.statusText}`);
        }
      } catch (error) {
        this.emit('error', { error, context: 'logout' });
        throw error;
      }
    }

    // Clear local auth state regardless of server response
    this.clearAuth();
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken?: string): Promise<AuthResult> {
    const tokenToUse = refreshToken || this.state.refreshToken;

    if (!tokenToUse) {
      const result: AuthResult = {
        success: false,
        error: 'No refresh token available',
      };
      return result;
    }

    if (!this.options.refreshConfig) {
      const result: AuthResult = {
        success: false,
        error: 'Refresh configuration not provided',
      };
      return result;
    }

    // Coalesce concurrent refresh requests
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh(tokenToUse);

    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  /**
   * Perform actual token refresh call to server
   */
  private async performTokenRefresh(refreshToken: string): Promise<AuthResult> {
    const config = this.options.refreshConfig!;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      let body: any;
      if (config.buildBody) {
        body = config.buildBody(refreshToken);
      } else {
        body = { refreshToken };
      }

      const response = await fetch(config.endpoint, {
        method: config.method || 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        // If refresh fails, clear auth
        this.clearAuth();

        const result: AuthResult = {
          success: false,
          error: `Token refresh failed: ${response.statusText}`,
        };

        this.emit('error', { error: result.error, context: 'refresh' });
        return result;
      }

      const data = await response.json();

      // Expect server to return AuthResult format
      const result: AuthResult = data;

      if (result.success && result.context) {
        // Update auth state with new tokens
        this.setAuth(result);
        this.emit('token-refreshed', { context: result.context });
      }

      return result;
    } catch (error) {
      // On error, clear auth
      this.clearAuth();

      const result: AuthResult = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during token refresh',
      };

      this.emit('error', { error, context: 'refresh' });
      return result;
    }
  }

  /**
   * Set token directly (for external token management)
   */
  setToken(token: string, context?: AuthContext): void {
    this.state = {
      authenticated: true,
      context,
      token,
      expiresAt: context?.token?.expiresAt,
      refreshToken: this.state.refreshToken, // Preserve existing refresh token
      refreshTokenExpiresAt: this.state.refreshTokenExpiresAt,
      sessionMetadata: this.state.sessionMetadata || {
        sessionId: this.generateSessionId(),
        loginTime: new Date(),
        deviceInfo: {
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
          platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
          language: typeof navigator !== 'undefined' ? navigator.language : undefined,
        },
      },
    };

    this.persistToStorage();

    if (this.options.autoRefresh && this.state.expiresAt) {
      this.scheduleRefresh();
    }

    this.resetInactivityTimer();
    this.emit('authenticated', { context });
    this.notifyCrossTabSync('authenticated');
  }

  /**
   * Get auth headers for requests
   */
  getAuthHeaders(): Record<string, string> {
    if (!this.state.token) {
      return {};
    }

    return {
      Authorization: `Bearer ${this.state.token}`,
    };
  }

  /**
   * Check if token is expired or about to expire
   */
  isTokenExpired(): boolean {
    if (!this.state.expiresAt) {
      return false;
    }

    return Date.now() >= this.state.expiresAt.getTime();
  }

  /**
   * Check if refresh token is expired
   */
  isRefreshTokenExpired(): boolean {
    if (!this.state.refreshTokenExpiresAt) {
      return false;
    }

    return Date.now() >= this.state.refreshTokenExpiresAt.getTime();
  }

  /**
   * Check if token needs refresh
   */
  needsRefresh(): boolean {
    if (!this.state.expiresAt || !this.options.autoRefresh) {
      return false;
    }

    const timeUntilExpiry = this.state.expiresAt.getTime() - Date.now();
    return timeUntilExpiry <= this.options.refreshThreshold;
  }

  /**
   * Enable cross-tab synchronization
   */
  enableCrossTabSync(): void {
    if (typeof window === 'undefined' || this.storageListener) {
      return;
    }

    this.storageListener = (event: StorageEvent) => {
      if (event.key === this.options.crossTabSync.syncKey && event.newValue) {
        try {
          const syncData = JSON.parse(event.newValue);

          if (syncData.type === 'authenticated' || syncData.type === 'unauthenticated') {
            // Restore state from storage
            this.restoreFromStorage();
            this.emit('cross-tab-sync', { type: syncData.type, timestamp: syncData.timestamp });
          }
        } catch (error) {
          console.error('Error processing cross-tab sync:', error);
        }
      }
    };

    window.addEventListener('storage', this.storageListener);
  }

  /**
   * Disable cross-tab synchronization
   */
  disableCrossTabSync(): void {
    if (typeof window !== 'undefined' && this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = undefined;
    }
  }

  /**
   * Set up inactivity tracking
   */
  private setupInactivityTracking(): void {
    if (typeof window === 'undefined' || this.activityListener) {
      return;
    }

    this.activityListener = () => {
      this.lastActivity = Date.now();
      this.resetInactivityTimer();
    };

    const events = this.options.inactivityConfig.events || ['click', 'keypress', 'mousemove'];
    events.forEach((event) => {
      window.addEventListener(event, this.activityListener!, { passive: true });
    });

    // Start the inactivity timer
    this.resetInactivityTimer();
  }

  /**
   * Reset inactivity timer
   */
  private resetInactivityTimer(): void {
    this.cancelInactivityTimer();

    if (!this.state.authenticated || !this.options.inactivityConfig.timeout) {
      return;
    }

    this.inactivityTimer = setTimeout(() => {
      this.handleInactivity();
    }, this.options.inactivityConfig.timeout);
  }

  /**
   * Cancel inactivity timer
   */
  private cancelInactivityTimer(): void {
    if (this.inactivityTimer !== undefined) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = undefined;
    }
  }

  /**
   * Handle inactivity timeout
   */
  private handleInactivity(): void {
    this.emit('inactivity', { lastActivity: new Date(this.lastActivity) });

    if (this.options.inactivityConfig.onInactivity) {
      this.options.inactivityConfig.onInactivity();
    }

    // Clear auth on inactivity
    this.clearAuth();
  }

  /**
   * Attach event listener
   */
  on(event: AuthEventType, handler: AuthEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Detach event listener
   */
  off(event: AuthEventType, handler: AuthEventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Emit event
   */
  private emit(event: AuthEventType, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in ${event} handler:`, error);
        }
      });
    }
  }

  /**
   * Extract token value from auth result
   */
  private extractTokenValue(result: AuthResult): string | undefined {
    // Try to find token in metadata
    if (result.metadata?.token) {
      return result.metadata.token;
    }

    // Try to find token in context metadata
    if (result.context?.metadata?.token) {
      return result.context.metadata.token;
    }

    return undefined;
  }

  /**
   * Restore auth state from storage
   */
  private restoreFromStorage(): void {
    try {
      // Try to restore full context
      const contextJson = this.options.storage.getValue(`${this.options.storageKey}_context`);
      if (contextJson) {
        const serialized: SerializableAuthState = JSON.parse(contextJson);

        this.state = {
          authenticated: serialized.authenticated,
          context: serialized.context,
          token: serialized.token,
          expiresAt: serialized.expiresAt ? new Date(serialized.expiresAt) : undefined,
          refreshToken: serialized.refreshToken,
          refreshTokenExpiresAt: serialized.refreshTokenExpiresAt
            ? new Date(serialized.refreshTokenExpiresAt)
            : undefined,
          sessionMetadata: serialized.sessionMetadata
            ? ({
                ...serialized.sessionMetadata,
                loginTime: new Date(serialized.sessionMetadata.loginTime),
              } as SessionMetadata)
            : undefined,
        };

        // Set up auto-refresh if needed
        if (this.options.autoRefresh && this.state.expiresAt) {
          this.scheduleRefresh();
        }

        return;
      }
    } catch (error) {
      console.error('Error restoring auth context from storage:', error);
    }

    // Fallback: restore just the token
    const token = this.options.storage.getToken();
    if (token) {
      this.state = {
        authenticated: true,
        token,
      };
    }
  }

  /**
   * Persist auth state to storage
   */
  private persistToStorage(): void {
    try {
      // Store access token
      if (this.state.token) {
        this.options.storage.setToken(this.state.token);
      }

      // Store full context
      const serialized: SerializableAuthState = {
        authenticated: this.state.authenticated,
        context: this.state.context,
        token: this.state.token,
        expiresAt: this.state.expiresAt?.toISOString(),
        refreshToken: this.state.refreshToken,
        refreshTokenExpiresAt: this.state.refreshTokenExpiresAt?.toISOString(),
        sessionMetadata: this.state.sessionMetadata
          ? {
              ...this.state.sessionMetadata,
              loginTime: this.state.sessionMetadata.loginTime.toISOString(),
            }
          : undefined,
      };

      this.options.storage.setValue(`${this.options.storageKey}_context`, JSON.stringify(serialized));
    } catch (error) {
      console.error('Error persisting auth state to storage:', error);
    }
  }

  /**
   * Clear all stored data
   */
  private clearStorage(): void {
    this.options.storage.removeToken();
    this.options.storage.removeValue(`${this.options.storageKey}_context`);
  }

  /**
   * Notify other tabs of auth state change
   */
  private notifyCrossTabSync(type: 'authenticated' | 'unauthenticated'): void {
    if (!this.options.crossTabSync.enabled || typeof window === 'undefined') {
      return;
    }

    try {
      const syncData = {
        type,
        timestamp: Date.now(),
      };

      // Use a separate key for sync events to trigger storage event
      this.options.storage.setValue(this.options.crossTabSync.syncKey, JSON.stringify(syncData));
    } catch (error) {
      console.error('Error notifying cross-tab sync:', error);
    }
  }

  /**
   * Schedule token refresh
   */
  private scheduleRefresh(): void {
    this.cancelRefresh();

    if (!this.state.expiresAt) {
      return;
    }

    const timeUntilRefresh = Math.max(0, this.state.expiresAt.getTime() - Date.now() - this.options.refreshThreshold);

    this.refreshTimer = setTimeout(async () => {
      // Attempt automatic refresh if refresh token is available
      if (this.state.refreshToken && this.options.refreshConfig) {
        await this.refreshToken();
      } else {
        // Just emit event for manual refresh
        this.emit('token-refreshed', { needsRefresh: true });
      }
    }, timeUntilRefresh);
  }

  /**
   * Cancel scheduled refresh
   */
  private cancelRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cancelRefresh();
    this.cancelInactivityTimer();
    this.disableCrossTabSync();

    // Clean up activity listener
    if (typeof window !== 'undefined' && this.activityListener) {
      const events = this.options.inactivityConfig.events || ['click', 'keypress', 'mousemove'];
      events.forEach((event) => {
        window.removeEventListener(event, this.activityListener!);
      });
      this.activityListener = undefined;
    }

    this.eventHandlers.clear();
  }
}
