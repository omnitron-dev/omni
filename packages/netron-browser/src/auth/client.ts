/**
 * Authentication client for Netron Browser
 * Handles authentication, token management, and auto-refresh
 */

import type { AuthContext, AuthResult, AuthOptions, AuthState } from './types.js';
import { LocalTokenStorage } from './storage.js';

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<AuthOptions> = {
  storage: new LocalTokenStorage(),
  storageKey: 'netron_auth_token',
  autoRefresh: true,
  refreshThreshold: 5 * 60 * 1000, // 5 minutes
  autoAttach: true,
};

/**
 * Authentication event types
 */
export type AuthEventType = 'authenticated' | 'unauthenticated' | 'token-refreshed' | 'error';

/**
 * Authentication event handler
 */
export type AuthEventHandler = (data: any) => void;

/**
 * Authentication client
 */
export class AuthenticationClient {
  private options: Required<AuthOptions>;
  private state: AuthState;
  private refreshTimer?: number;
  private eventHandlers = new Map<AuthEventType, Set<AuthEventHandler>>();

  constructor(options: AuthOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Initialize storage with custom key if provided
    if (options.storageKey && !options.storage) {
      this.options.storage = new LocalTokenStorage(options.storageKey);
    }

    this.state = {
      authenticated: false,
    };

    // Try to restore auth state from storage
    this.restoreFromStorage();
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
   * Get current token
   */
  getToken(): string | undefined {
    return this.state.token;
  }

  /**
   * Set authentication context and token
   */
  setAuth(result: AuthResult): void {
    if (!result.success || !result.context) {
      return;
    }

    this.state = {
      authenticated: true,
      context: result.context,
      token: result.context.token?.type === 'bearer' ? this.extractTokenValue(result) : undefined,
      expiresAt: result.context.token?.expiresAt,
    };

    // Store token if available
    if (this.state.token) {
      this.options.storage.setToken(this.state.token);
    }

    // Set up auto-refresh if enabled
    if (this.options.autoRefresh && this.state.expiresAt) {
      this.scheduleRefresh();
    }

    this.emit('authenticated', { context: result.context });
  }

  /**
   * Clear authentication
   */
  clearAuth(): void {
    this.state = {
      authenticated: false,
    };

    this.options.storage.removeToken();
    this.cancelRefresh();
    this.emit('unauthenticated', {});
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
    };

    this.options.storage.setToken(token);

    if (this.options.autoRefresh && this.state.expiresAt) {
      this.scheduleRefresh();
    }

    this.emit('authenticated', { context });
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
    const token = this.options.storage.getToken();
    if (token) {
      this.state = {
        authenticated: true,
        token,
      };
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

    this.refreshTimer = window.setTimeout(() => {
      this.emit('token-refreshed', { needsRefresh: true });
    }, timeUntilRefresh);
  }

  /**
   * Cancel scheduled refresh
   */
  private cancelRefresh(): void {
    if (this.refreshTimer !== undefined) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.cancelRefresh();
    this.eventHandlers.clear();
  }
}
