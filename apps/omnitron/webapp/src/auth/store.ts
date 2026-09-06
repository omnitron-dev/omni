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
import { sanitizeReturnTo } from 'src/utils/errors';

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
  /**
   * Why session restore ended without a user, when the reason was not "you
   * are signed out".
   *
   * Measured live with the daemon's database refused: the console spent 28
   * seconds on a bare progress bar — three RPCs at nine seconds each — and
   * then showed a sign-in page that said nothing. Every one of those calls
   * failed with ECONNREFUSED, which no amount of re-authenticating fixes.
   */
  initError: string | null;

  initialize: () => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setUser: (user: ConsoleUser | null) => void;
  clearInitError: () => void;
}

/**
 * Shown when the server did not send a role.
 *
 * These three sites defaulted to `'admin'`. `OmnitronAuthUser.role` is a
 * required field, so the fallback should never fire — which is exactly why
 * it was free to be wrong, and why it stayed the most privileged value
 * available. The console only displays the role (the settings page shows it
 * as a chip; nothing is gated on it client-side, and the daemon enforces
 * roles on the wire regardless), so the cost is not access — it is telling
 * an operator they are an admin when the server declined to say what they
 * are.
 *
 * An absent answer is not evidence of the highest privilege. It is not
 * evidence of anything.
 */
const UNKNOWN_ROLE = 'unknown';

// ---------------------------------------------------------------------------
// Session event handler
// ---------------------------------------------------------------------------

function handleSessionEvent(event: 'refreshed' | 'expired') {
  if (event === 'expired') {
    clearSession();
    useAuthStore.setState({ user: null, sessionId: null });
    // Redirect to sign-in
    if (typeof window !== 'undefined') {
      const raw = window.location.pathname + window.location.search;
      const returnTo = encodeURIComponent(sanitizeReturnTo(raw));
      window.location.href = `/auth/sign-in?returnTo=${returnTo}`;
    }
  }
}

/**
 * The in-flight `initialize()`, so concurrent callers share one run.
 *
 * The `initialized` flag alone cannot do this: it is set at the END of the
 * flow, several awaits in, and both guards call `initialize()` from a mount
 * effect. `StrictMode` runs that effect twice, and a route that renders both
 * guards would do the same — so the console opened with two concurrent
 * `validateSession` round trips whose only difference was which one finished
 * second. A flag set after an await guards the second call only when there
 * is no second caller.
 */
let initializing: Promise<void> | null = null;

/**
 * The body of `initialize()`, so the store method can stay a thin guard.
 */
/**
 * Could a token refresh fix this?
 *
 * The ladder below — refresh, validate, refresh again — exists for an expired
 * token. When the daemon answers 500 because it cannot reach its own
 * database, every rung fails identically and the console spends three RPC
 * timeouts on it. Worse, the ladder ends in `clearSession()`, so a session
 * that is probably still valid is thrown away and the operator is sent to
 * re-authenticate against the database that is down.
 *
 * The transport marks these: netron-browser copies the daemon's error code
 * onto the thrown error. An error without a code is treated as an auth
 * failure, which is what the ladder always assumed.
 */
function isAuthFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === undefined || code === null) return true;
  return code === 401 || code === 'UNAUTHORIZED' || code === 'SESSION_REVOKED';
}

/** What to show an operator when the daemon itself could not answer. */
function describeInitFailure(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === 'ECONNREFUSED' || code === 'SESSION_STORE_UNAVAILABLE') {
    return 'The daemon could not reach its database, so your session could not be checked. This is not a sign-in problem — run `omnitron doctor` for the reason.';
  }
  return 'The daemon could not check your session. Signing in again will not help until it can — run `omnitron doctor` for the reason.';
}

async function runInitialize(set: (partial: Partial<AuthState>) => void): Promise<void> {
  const sessionId = getSessionId();
  if (!sessionId) {
    set({ initialized: true });
    return;
  }

  try {
    // A live session does not imply a live token: the session lasts 24h,
    // the JWT one hour. Restoring from a session alone produced a console
    // that believed it was signed in while every RPC came back 401 — the
    // dashboard rendered "Applications 0 / No apps yet" and the status bar
    // said "Offline", which reads as "your applications died".
    //
    // Refresh first when the token is stale, so the app is handed a state
    // it can actually act on.
    if (sessionManager.isAccessTokenStale()) {
      await sessionManager.refresh().catch(() => false);
    }

    const result = await authRpc('validateSession', { sessionId: getSessionId() ?? sessionId });

    if (result.valid && result.user) {
      const expiresAt = result.session?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();

      set({
        user: {
          id: result.user.id,
          username: result.user.username,
          displayName: result.user.displayName ?? result.user.username,
          role: result.user.role ?? UNKNOWN_ROLE,
        },
        sessionId,
        initialized: true,
      });

      // Start proactive session refresh
      sessionManager.start(expiresAt, handleSessionEvent);
      return;
    }
  } catch (err) {
    if (!isAuthFailure(err)) {
      // Not something re-authenticating can fix. The session is left in place
      // — it is very likely still valid, and the daemon simply cannot say so.
      set({ initialized: true, initError: describeInitFailure(err) });
      return;
    }
    // Session invalid or daemon unreachable — try refresh
    try {
      const refreshed = await sessionManager.refresh();
      if (refreshed) {
        // Retry validation after refresh
        const refreshedSessionId = getSessionId();
        if (!refreshedSessionId) {
          clearSession();
          set({ initialized: true });
          return;
        }
        const retryResult = await authRpc('validateSession', { sessionId: refreshedSessionId });
        if (retryResult.valid && retryResult.user) {
          set({
            user: {
              id: retryResult.user.id,
              username: retryResult.user.username,
              displayName: retryResult.user.displayName ?? retryResult.user.username,
              role: retryResult.user.role ?? UNKNOWN_ROLE,
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
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  sessionId: null,
  initialized: false,
  initError: null,
  loading: false,

  clearInitError: () => set({ initError: null }),

  initialize: async () => {
    if (get().initialized) return;
    if (initializing) return initializing;

    initializing = runInitialize(set).finally(() => {
      initializing = null;
    });
    return initializing;
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
          role: data.user.role ?? UNKNOWN_ROLE,
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
