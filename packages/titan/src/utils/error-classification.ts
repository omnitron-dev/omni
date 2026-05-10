/**
 * Operational vs Programming Error Classification
 *
 * The single source of truth for "is this error a transient operational
 * failure (network blip, DB connection drop, peer hangup) or a programming
 * bug (TypeError, ReferenceError, corrupt state)?"
 *
 * Used by every uncaught-error handler in the stack — Application,
 * LifecycleController, ProcessManager — so the daemon's behavior is
 * uniform: operational errors are logged and the underlying clients
 * (pg Pool, ioredis, …) get to reconnect; programming errors trigger
 * shutdown so corrupt state never leaks beyond the failing process.
 *
 * Keeping the predicate in one place is what lets multiple handlers
 * coexist on the same `'uncaughtException'` event without one of them
 * tearing the daemon down for an error another already absorbed.
 *
 * @module utils/error-classification
 */

/**
 * Postgres SQLSTATE codes that mean the connection (or the server) was
 * lost — the client owns reconnection, the daemon must not crash here.
 *
 *   57P01 admin_shutdown        — server-side admin terminated the connection
 *   57P02 crash_shutdown        — server crashed
 *   57P03 cannot_connect_now    — startup/shutdown in progress
 *   08000 connection_exception
 *   08001 sqlclient_unable_to_establish_sqlconnection
 *   08003 connection_does_not_exist
 *   08004 sqlserver_rejected_establishment_of_sqlconnection
 *   08006 connection_failure
 *   08007 transaction_resolution_unknown
 *   53300 too_many_connections  — transient pressure, retry will succeed
 */
export const OPERATIONAL_PG_SQLSTATES: ReadonlySet<string> = new Set([
  '57P01', '57P02', '57P03',
  '08000', '08001', '08003', '08004', '08006', '08007',
  '53300',
]);

/**
 * libuv / net errno strings that mean the network or peer dropped under
 * us. Application-level retry loops handle the recovery; we just must
 * not let one drop kill the daemon.
 */
export const OPERATIONAL_NET_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
  'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN',
  'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTDOWN', 'ENOTCONN',
]);

/**
 * True if `error` is an *operational* failure rather than a programming
 * bug. Crashing the daemon for operational errors prevents legitimate
 * self-healing in the underlying clients (pg Pool, ioredis, etc.) —
 * they expect transient errors and reconnect on the next operation.
 *
 * Walks one level of `error.cause` so wrapped errors (Errors thrown
 * with `{ cause: pgErr }`) are still classified correctly.
 */
export function isOperationalError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; errno?: unknown; cause?: unknown };
  if (typeof e.code === 'string') {
    if (OPERATIONAL_PG_SQLSTATES.has(e.code)) return true;
    if (OPERATIONAL_NET_CODES.has(e.code)) return true;
  }
  if (typeof e.errno === 'string' && OPERATIONAL_NET_CODES.has(e.errno)) return true;
  if (e.cause && e.cause !== error) return isOperationalError(e.cause);
  return false;
}

/**
 * Sliding-window counter that returns `true` once the count crosses
 * `maxErrors` within `windowMs`. Lets every uncaught-error handler share
 * the same circuit-breaker semantics: tolerate occasional operational
 * errors, but escalate to shutdown if they arrive faster than recovery
 * loops can absorb them — that level of churn means something deeper is
 * wrong and silent retries would mask it.
 *
 * Returns a closed-over function so callers can keep their own counter
 * (e.g., per-component) without static state leaking across instances.
 */
export function createOperationalErrorRecorder(
  options: { windowMs?: number; maxErrors?: number } = {}
): () => boolean {
  const windowMs = options.windowMs ?? 60_000;
  const maxErrors = options.maxErrors ?? 25;
  const window: number[] = [];
  return () => {
    const now = Date.now();
    window.push(now);
    while (window.length > 0 && now - window[0]! > windowMs) window.shift();
    return window.length > maxErrors;
  };
}
