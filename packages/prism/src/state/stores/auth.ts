/**
 * Auth Store
 *
 * Manages authentication state (UI-side).
 * Server-side token validation should use Netron auth.
 *
 * SECURITY NOTE: Tokens are stored in session storage (not localStorage)
 * and are NOT persisted across browser sessions. Only the auth status
 * is persisted to allow checking login state on page load.
 *
 * @module @omnitron/prism/state/stores
 */

import { createPersistedStore, createUIStore, createSelectors } from '../create-store.js';

/**
 * Authentication status.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

/**
 * Auth store state (persisted - only status).
 */
export interface AuthStoreState {
  /** Current auth status */
  status: AuthStatus;
  /** Session ID (non-sensitive) */
  sessionId: string | null;

  // Actions
  setStatus: (status: AuthStatus) => void;
  setAuthenticated: (sessionId?: string) => void;
  setUnauthenticated: () => void;
  clearSession: () => void;
}

/**
 * Token store state (non-persisted - memory only).
 * Tokens should NEVER be persisted to localStorage.
 */
interface TokenStoreState {
  /** Access token (memory-only, cleared on page refresh) */
  token: string | null;
  setToken: (token: string | null) => void;
}

/**
 * Token store - memory-only, NOT persisted.
 * For XSS security, tokens should not be in localStorage.
 */
export const useTokenStore = createUIStore<TokenStoreState>(
  (set) => ({
    token: null,
    setToken: (token) => set({ token }),
  }),
  'token'
);

/**
 * Auth store with partial persistence.
 * Only status and sessionId are persisted, NOT the token.
 *
 * @example
 * ```tsx
 * function AuthGuard({ children }) {
 *   const status = useAuthStore((s) => s.status);
 *   const isAuthenticated = selectIsAuthenticated(useAuthStore.getState());
 *
 *   if (status === 'loading') return <Spinner />;
 *   if (!isAuthenticated) return <Navigate to="/login" />;
 *
 *   return children;
 * }
 * ```
 */
export const useAuthStore = createPersistedStore<AuthStoreState>(
  (set) => ({
    status: 'loading',
    sessionId: null,

    // Actions
    setStatus: (status) => set({ status }),

    setAuthenticated: (sessionId) => {
      set({
        status: 'authenticated',
        sessionId: sessionId ?? null,
      });
    },

    setUnauthenticated: () => {
      // Clear token from memory store
      useTokenStore.getState().setToken(null);
      set({
        status: 'unauthenticated',
        sessionId: null,
      });
    },

    clearSession: () => {
      // Clear token from memory
      useTokenStore.getState().setToken(null);
      // Clear any stored session data
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('sessionId');
      }
      set({
        status: 'unauthenticated',
        sessionId: null,
      });
    },
  }),
  'auth',
  {
    // Only persist non-sensitive data
    partialize: (state) =>
      ({
        status: state.status,
        sessionId: state.sessionId,
      }) as AuthStoreState,
  }
);

// =============================================================================
// SELECTORS (computed state helpers)
// =============================================================================

/**
 * Select whether auth is loading.
 */
export function selectIsLoading(state: AuthStoreState): boolean {
  return state.status === 'loading';
}

/**
 * Select whether user is authenticated.
 */
export function selectIsAuthenticated(state: AuthStoreState): boolean {
  return state.status === 'authenticated';
}

/**
 * Select whether user is unauthenticated.
 */
export function selectIsUnauthenticated(state: AuthStoreState): boolean {
  return state.status === 'unauthenticated';
}

/**
 * Auth store with auto-generated selectors.
 */
export const authStore = createSelectors(useAuthStore);

// =============================================================================
// HELPER HOOKS
// =============================================================================

/**
 * Hook to set both token and auth status atomically.
 *
 * @example
 * ```tsx
 * const { login, logout } = useAuth();
 *
 * // On successful login
 * login(accessToken, sessionId);
 *
 * // On logout
 * logout();
 * ```
 */
export function useAuth() {
  const setToken = useTokenStore((s) => s.setToken);
  const { setAuthenticated, setUnauthenticated, clearSession } = useAuthStore();

  return {
    login: (token: string, sessionId?: string) => {
      setToken(token);
      setAuthenticated(sessionId);
    },
    logout: () => {
      setUnauthenticated();
    },
    clearSession,
    getToken: () => useTokenStore.getState().token,
  };
}
