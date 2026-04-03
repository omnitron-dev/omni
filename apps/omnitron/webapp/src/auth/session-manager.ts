/**
 * Session Manager — Proactive Session Renewal for Omnitron Console
 *
 * Adapted from @apps/portal session-manager. Handles:
 * 1. Proactive refresh — schedules refresh before JWT/session expiry
 * 2. Visibility-aware — refreshes when tab becomes visible
 * 3. Promise coalescing — concurrent refresh calls share single request
 * 4. Retry with backoff — transient errors retried, terminal errors force logout
 */

import { authRpc, setStorageToken } from 'src/netron/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_KEY = 'omnitron_token';

/** Refresh this many ms before effective expiry */
const REFRESH_THRESHOLD_MS = 30 * 1000; // 30 seconds before expiry

/** Minimum interval between refresh attempts */
const MIN_REFRESH_INTERVAL_MS = 5 * 1000;

/** Fallback heartbeat when no expiresAt is known */
const FALLBACK_HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes

/** Max retries for transient refresh failures */
const MAX_REFRESH_RETRIES = 3;

/** Base delay between retries (exponential: 2s → 4s → 8s) */
const RETRY_BASE_DELAY_MS = 2000;

/** Error codes that indicate a dead session — no point retrying */
const TERMINAL_CODES = new Set(['SESSION_EXPIRED', 'SESSION_REVOKED']);

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

type SessionEventHandler = (event: 'refreshed' | 'expired') => void;

class SessionManager {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private expiresAt: Date | null = null;
  private lastRefreshAt = 0;
  private inflightRefresh: Promise<boolean> | null = null;
  private running = false;
  private handler: SessionEventHandler | null = null;
  private boundVisibilityHandler: (() => void) | null = null;

  /**
   * Start the session manager after successful sign-in or session validation.
   */
  start(expiresAt: string | Date, onEvent: SessionEventHandler): void {
    this.stop();
    this.running = true;
    this.handler = onEvent;
    this.expiresAt = new Date(expiresAt);
    this.scheduleRefresh();
    this.setupVisibilityListener();
  }

  /** Stop the session manager (sign-out). */
  stop(): void {
    this.running = false;
    this.handler = null;
    this.cancelTimer();
    this.removeVisibilityListener();
    this.expiresAt = null;
    this.inflightRefresh = null;
  }

  get isActive(): boolean {
    return this.running;
  }

  /**
   * Refresh the session. Returns true if successful.
   * Coalesces concurrent calls — all callers share the same in-flight request.
   */
  async refresh(): Promise<boolean> {
    if (!this.getSessionId()) return false;

    // Coalesce
    if (this.inflightRefresh) return this.inflightRefresh;

    // Throttle
    if (Date.now() - this.lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return true;

    this.inflightRefresh = this.performRefreshWithRetry();
    try {
      return await this.inflightRefresh;
    } finally {
      this.inflightRefresh = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async performRefreshWithRetry(): Promise<boolean> {
    for (let attempt = 0; attempt <= MAX_REFRESH_RETRIES; attempt++) {
      try {
        return await this.performRefresh();
      } catch (err: any) {
        const errCode = String(err?.code ?? '');
        const isTerminal = TERMINAL_CODES.has(errCode);

        if (isTerminal) {
          const handler = this.handler;
          this.stop();
          handler?.('expired');
          return false;
        }

        if (attempt < MAX_REFRESH_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        } else {
          return false;
        }
      }
    }
    return false;
  }

  private async performRefresh(): Promise<boolean> {
    const sid = this.getSessionId();
    if (!sid) return false;

    // refreshSession is @Public — use skipAuth to bypass expired JWT
    const result: any = await authRpc('refreshSession', sid);

    if (!result?.success || !result?.result) return false;

    const { accessToken, session } = result.result;

    // Update token
    if (accessToken) {
      sessionStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
      setStorageToken(accessToken);
    }

    // Update expiry
    if (session?.expiresAt) {
      this.expiresAt = new Date(session.expiresAt);
    }

    this.lastRefreshAt = Date.now();

    // Schedule next refresh
    if (this.running) {
      this.scheduleRefresh();
    }

    this.handler?.('refreshed');
    return true;
  }

  private scheduleRefresh(): void {
    this.cancelTimer();
    if (!this.running || !this.expiresAt) return;

    const now = Date.now();

    // Use the earlier of session expiry and JWT expiry
    let effectiveExpiry = this.expiresAt.getTime();
    const jwtExpiry = this.getJwtExpiryMs();
    if (jwtExpiry && jwtExpiry < effectiveExpiry) {
      effectiveExpiry = jwtExpiry;
    }

    let delay = effectiveExpiry - now - REFRESH_THRESHOLD_MS;
    if (delay <= 0) delay = 0;
    delay = Math.min(delay, FALLBACK_HEARTBEAT_MS);

    this.refreshTimer = setTimeout(() => {
      if (this.running) void this.refresh();
    }, delay);
  }

  private getJwtExpiryMs(): number | null {
    try {
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  private getSessionId(): string | null {
    try {
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      return payload.sid ?? null;
    } catch {
      return null;
    }
  }

  private cancelTimer(): void {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Visibility API
  // -------------------------------------------------------------------------

  private setupVisibilityListener(): void {
    this.removeVisibilityListener();
    this.boundVisibilityHandler = () => {
      if (this.running && document.visibilityState === 'visible') {
        void this.refresh();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);
  }

  private removeVisibilityListener(): void {
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
  }
}

// ---------------------------------------------------------------------------
// HMR-safe Singleton
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__omnitronSessionManager';

function getOrCreateManager(): SessionManager {
  const existing = (window as any)[GLOBAL_KEY] as SessionManager | undefined;
  if (existing) return existing;
  const manager = new SessionManager();
  (window as any)[GLOBAL_KEY] = manager;
  return manager;
}

export const sessionManager = typeof window !== 'undefined' ? getOrCreateManager() : new SessionManager();

if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => {});
}
