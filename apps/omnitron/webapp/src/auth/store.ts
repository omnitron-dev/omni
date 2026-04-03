/**
 * Auth Store (Zustand)
 *
 * Authentication state for the Omnitron console.
 * Manages user session, JWT lifecycle, and proactive session refresh.
 */

import { create } from 'zustand';
import {
  getSessionId,
  setStorageToken,
  clearSession,
  authRpc,
} from 'src/netron/client';
import { sessionManager } from './session-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsoleUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

interface AuthState {
  user: ConsoleUser | null;
  sessionId: string | null;
  initialized: boolean;
  loading: boolean;

  initialize: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: ConsoleUser | null) => void;
}

// ---------------------------------------------------------------------------
// Session event handler
// ---------------------------------------------------------------------------

function handleSessionEvent(event: 'refreshed' | 'expired') {
  if (event === 'expired') {
    clearSession();
    useAuthStore.setState({ user: null, sessionId: null });
    // Redirect to sign-in
    if (typeof window !== 'undefined') {
      const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/auth/sign-in?returnTo=${returnTo}`;
    }
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  sessionId: null,
  initialized: false,
  loading: false,

  initialize: async () => {
    if (get().initialized) return;

    const sessionId = getSessionId();
    if (!sessionId) {
      set({ initialized: true });
      return;
    }

    try {
      const result = await authRpc('validateSession', { sessionId });

      if (result.valid && result.user) {
        const expiresAt = result.session?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

        set({
          user: {
            id: result.user.id,
            username: result.user.username,
            displayName: result.user.displayName ?? result.user.username,
            role: result.user.role ?? 'admin',
          },
          sessionId,
          initialized: true,
        });

        // Start proactive session refresh
        sessionManager.start(expiresAt, handleSessionEvent);
        return;
      }
    } catch {
      // Session invalid or daemon unreachable — try refresh
      try {
        const refreshed = await sessionManager.refresh();
        if (refreshed) {
          // Retry validation after refresh
          const retryResult = await authRpc('validateSession', { sessionId: getSessionId() });
          if (retryResult.valid && retryResult.user) {
            set({
              user: {
                id: retryResult.user.id,
                username: retryResult.user.username,
                displayName: retryResult.user.displayName ?? retryResult.user.username,
                role: retryResult.user.role ?? 'admin',
              },
              sessionId: getSessionId(),
              initialized: true,
            });
            return;
          }
        }
      } catch {
        // Refresh also failed
      }
    }

    clearSession();
    set({ initialized: true });
  },

  signIn: async (username, password) => {
    set({ loading: true });
    try {
      const data = await authRpc('signIn', { username, password });

      if (!data || typeof data !== 'object' || Array.isArray(data) || !data.user) {
        throw new Error('Invalid credentials');
      }

      if (data.accessToken) {
        setStorageToken(data.accessToken);
      }

      const sid = data.session?.id ?? getSessionId();
      const expiresAt = data.session?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

      set({
        user: {
          id: data.user.id,
          username: data.user.username,
          displayName: data.user.displayName ?? data.user.username,
          role: data.user.role ?? 'admin',
        },
        sessionId: sid,
        loading: false,
      });

      // Start proactive session refresh
      sessionManager.start(expiresAt, handleSessionEvent);
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  signOut: async () => {
    sessionManager.stop();
    const { sessionId } = get();
    try {
      if (sessionId) {
        await authRpc('signOut', { sessionId });
      }
    } finally {
      clearSession();
      set({ user: null, sessionId: null });
    }
  },

  setUser: (user) => set({ user }),
}));

/** Convenience selector */
export function useIsAuthenticated(): boolean {
  return useAuthStore((s) => s.user !== null);
}
