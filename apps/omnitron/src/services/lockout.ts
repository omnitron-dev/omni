/**
 * How long an account stays locked after a run of failed sign-ins.
 *
 * A function of its own so the schedule can be tested. The daemon's auth
 * service had 469 lines and no tests at all, and the part worth pinning is
 * this one: it decides when an operator is shut out of the control plane, and
 * every mistake in it is either a lockout that never engages or one that
 * never lets go.
 *
 * The state it drives is persisted rather than held in memory, because a
 * daemon restart — which an attacker may be able to provoke — must not hand
 * back a clean slate.
 */

/** Consecutive failures tolerated before the account locks. */
export const MAX_FAILED_ATTEMPTS = 5;

/** First lockout duration; doubles with each further failure. */
export const LOCKOUT_BASE_MS = 60_000;

/** Ceiling for the exponential lockout. */
export const LOCKOUT_MAX_MS = 30 * 60_000;

/**
 * The lockout expiry after `attempts` consecutive failures.
 *
 * @param attempts the failure count INCLUDING the one just recorded
 * @param now injected for tests
 * @returns when the lock expires, or null while under the threshold
 */
export function computeLockout(attempts: number, now: number = Date.now()): Date | null {
  // A non-finite or negative count is not a smaller number of failures, it is
  // a broken one — and reading it as "under the threshold" would disable the
  // lockout entirely for whoever produced it.
  if (!Number.isFinite(attempts)) return new Date(now + LOCKOUT_BASE_MS);

  const overThreshold = Math.floor(attempts) - MAX_FAILED_ATTEMPTS;
  if (overThreshold < 0) return null;

  // 2 ** overThreshold overflows to Infinity around 1024 attempts; the min
  // against the cap handles that, but only because Infinity compares larger.
  const duration = Math.min(LOCKOUT_BASE_MS * 2 ** overThreshold, LOCKOUT_MAX_MS);
  return new Date(now + duration);
}
