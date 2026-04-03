/**
 * Authentication Context and Provider
 */

import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
  AuthenticationClient,
  type AuthContext as NetronAuthContext,
  type AuthResult,
  type AuthCredentials,
} from '@omnitron-dev/netron-browser';

// ============================================================================
// Types
// ============================================================================

/**
 * Auth state for React context
 */
export interface AuthState {
  /** Is user authenticated */
  isAuthenticated: boolean;
  /** Is authentication loading */
  isLoading: boolean;
  /** Current user info */
  user: User | null;
  /** Current access token */
  token: string | null;
  /** Auth error */
  error: Error | null;
}

/**
 * User info (extracted from auth context)
 */
export interface User {
  id: string;
  email?: string;
  name?: string;
  roles?: string[];
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * Auth context value
 */
export interface AuthContextValue extends AuthState {
  /** Login with credentials */
  login: (credentials: AuthCredentials) => Promise<AuthResult>;
  /** Logout */
  logout: () => Promise<void>;
  /** Refresh token */
  refresh: () => Promise<AuthResult>;
  /** Get auth headers for requests */
  getAuthHeaders: () => Record<string, string>;
  /** Check if user has role */
  hasRole: (role: string) => boolean;
  /** Check if user has permission */
  hasPermission: (permission: string) => boolean;
  /** Check if user has any of the roles */
  hasAnyRole: (roles: string[]) => boolean;
  /** Check if user has all roles */
  hasAllRoles: (roles: string[]) => boolean;
}

/**
 * Auth provider props
 */
export interface AuthProviderProps {
  /** Netron AuthenticationClient instance */
  client?: AuthenticationClient;
  /** Auth configuration */
  config?: {
    refreshEndpoint?: string;
    logoutEndpoint?: string;
    storage?: 'local' | 'session' | 'memory';
    autoRefresh?: boolean;
    refreshThreshold?: number;
  };
  /** Called when authenticated */
  onAuthenticated?: (user: User) => void;
  /** Called when logged out */
  onLogout?: () => void;
  /** Called on auth error */
  onError?: (error: Error) => void;
  /** Children */
  children: ReactNode;
}

// ============================================================================
// Context
// ============================================================================

const AuthContext = createContext<AuthContextValue | null>(null);

AuthContext.displayName = 'AuthContext';

// ============================================================================
// Provider
// ============================================================================

/**
 * AuthProvider
 *
 * Provides authentication state and methods to child components.
 */
export function AuthProvider({
  client: externalClient,
  config,
  onAuthenticated,
  onLogout,
  onError,
  children,
}: AuthProviderProps): React.JSX.Element {
  // Create or use provided client
  const [authClient] = useState<AuthenticationClient>(() => {
    if (externalClient) return externalClient;

    return new AuthenticationClient({
      storage: config?.storage === 'session' ? undefined : config?.storage === 'memory' ? undefined : undefined,
      autoRefresh: config?.autoRefresh ?? true,
      refreshThreshold: config?.refreshThreshold ?? 5 * 60 * 1000,
      refreshConfig: config?.refreshEndpoint ? { endpoint: config.refreshEndpoint } : undefined,
      logoutConfig: config?.logoutEndpoint ? { endpoint: config.logoutEndpoint } : undefined,
    });
  });

  // State
  const [isAuthenticated, setIsAuthenticated] = useState(() => authClient.isAuthenticated());
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<User | null>(() => extractUser(authClient.getContext()));
  const [token, setToken] = useState<string | null>(() => authClient.getToken() ?? null);
  const [error, setError] = useState<Error | null>(null);

  // Setup auth client event listeners
  useEffect(() => {
    const handleAuthenticated = (data: { context?: NetronAuthContext }) => {
      const extractedUser = extractUser(data.context);
      setIsAuthenticated(true);
      setUser(extractedUser);
      setToken(authClient.getToken() ?? null);
      setError(null);

      if (extractedUser) {
        onAuthenticated?.(extractedUser);
      }
    };

    const handleUnauthenticated = () => {
      setIsAuthenticated(false);
      setUser(null);
      setToken(null);
      onLogout?.();
    };

    const handleError = (data: { error: Error }) => {
      setError(data.error);
      onError?.(data.error);
    };

    const handleTokenRefreshed = () => {
      setToken(authClient.getToken() ?? null);
    };

    authClient.on('authenticated', handleAuthenticated);
    authClient.on('unauthenticated', handleUnauthenticated);
    authClient.on('error', handleError);
    authClient.on('token-refreshed', handleTokenRefreshed);

    return () => {
      authClient.off('authenticated', handleAuthenticated);
      authClient.off('unauthenticated', handleUnauthenticated);
      authClient.off('error', handleError);
      authClient.off('token-refreshed', handleTokenRefreshed);
    };
  }, [authClient, onAuthenticated, onLogout, onError]);

  // Login
  const login = useCallback(
    async (_credentials: AuthCredentials): Promise<AuthResult> => {
      setIsLoading(true);
      setError(null);

      try {
        // This would typically call your auth endpoint
        // For now, we simulate by directly setting auth
        // In real usage, you'd call an auth service

        // Placeholder - replace with actual auth logic
        const result: AuthResult = {
          success: false,
          error: 'Login not implemented - use setAuth directly or provide login endpoint',
        };

        if (!result.success) {
          throw new Error(result.error ?? 'Login failed');
        }

        authClient.setAuth(result);
        return result;
      } catch (err) {
        const normalizedError = err instanceof Error ? err : new Error(String(err));
        setError(normalizedError);
        throw normalizedError;
      } finally {
        setIsLoading(false);
      }
    },
    [authClient]
  );

  // Logout
  const logout = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    try {
      await authClient.logout();
    } catch (err) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      setError(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoading(false);
    }
  }, [authClient]);

  // Refresh
  const refresh = useCallback(async (): Promise<AuthResult> => {
    setIsLoading(true);
    try {
      const result = await authClient.refreshToken();
      if (!result.success) {
        throw new Error(result.error ?? 'Token refresh failed');
      }
      return result;
    } catch (err) {
      const normalizedError = err instanceof Error ? err : new Error(String(err));
      setError(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoading(false);
    }
  }, [authClient]);

  // Get auth headers
  const getAuthHeaders = useCallback((): Record<string, string> => authClient.getAuthHeaders(), [authClient]);

  // Role/permission checks
  const hasRole = useCallback((role: string): boolean => user?.roles?.includes(role) ?? false, [user]);

  const hasPermission = useCallback(
    (permission: string): boolean => user?.permissions?.includes(permission) ?? false,
    [user]
  );

  const hasAnyRole = useCallback(
    (roles: string[]): boolean => roles.some((role) => user?.roles?.includes(role)),
    [user]
  );

  const hasAllRoles = useCallback(
    (roles: string[]): boolean => roles.every((role) => user?.roles?.includes(role)),
    [user]
  );

  // Context value
  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated,
      isLoading,
      user,
      token,
      error,
      login,
      logout,
      refresh,
      getAuthHeaders,
      hasRole,
      hasPermission,
      hasAnyRole,
      hasAllRoles,
    }),
    [
      isAuthenticated,
      isLoading,
      user,
      token,
      error,
      login,
      logout,
      refresh,
      getAuthHeaders,
      hasRole,
      hasPermission,
      hasAnyRole,
      hasAllRoles,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * useAuth hook
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/**
 * useAuthRequired hook - throws if not authenticated
 */
export function useAuthRequired(): AuthContextValue {
  const auth = useAuth();
  if (!auth.isAuthenticated) {
    throw new Error('Authentication required');
  }
  return auth;
}

/**
 * useUser hook - returns user or null
 */
export function useUser(): User | null {
  const { user } = useAuth();
  return user;
}

/**
 * useIsAuthenticated hook
 */
export function useIsAuthenticated(): boolean {
  const { isAuthenticated } = useAuth();
  return isAuthenticated;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Extract user from auth context
 */
function extractUser(context?: NetronAuthContext): User | null {
  if (!context) return null;

  return {
    id: context.userId ?? 'unknown',
    email: context.metadata?.email as string | undefined,
    name: context.metadata?.name as string | undefined,
    roles: context.metadata?.roles as string[] | undefined,
    permissions: context.metadata?.permissions as string[] | undefined,
    metadata: context.metadata,
  };
}
