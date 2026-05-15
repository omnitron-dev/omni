/**
 * Consecutive-failure tracker for log-spam suppression.
 *
 * Why this exists
 * ---------------
 * Infrastructure modules (distributed locks, health checks, cache
 * adapters, network clients) typically run inside hot loops. When
 * an underlying dependency goes sour — Redis hits OOM, a Postgres
 * pool is exhausted, a remote API starts 503-ing — each loop tick
 * produces an identical error.
 *
 * Pre-fix, every tick logged at ERROR with the full payload:
 *   158 lines/minute during the May-15 Redis OOM incident, every
 *   one from `[DistributedLock] Failed to acquire lock`, every
 *   one identical apart from a timestamp. The diagnostic value
 *   was zero, the noise was infinite, and the actual root cause
 *   (Redis OOM, fixable in seconds) was buried beneath the spam.
 *
 * What this provides
 * ------------------
 * A per-category state machine that fires log callbacks at edge
 * transitions rather than every tick:
 *
 *   first failure       → WARN, "X started failing"
 *   subsequent failures → DEBUG with running count + elapsed time
 *   threshold crossed   → ERROR exactly once, "X persistent failure"
 *   first success       → INFO, "X recovered after Nms (M failures)"
 *
 * Same `recordFailure(category, ctx)` / `recordSuccess(category)`
 * surface across all consumers. The tracker holds no logger of its
 * own — it returns a `decision` for the caller to apply with their
 * own logger context, so the same primitive works for pino, console,
 * or a test spy without coupling.
 *
 * Memory bound
 * ------------
 * The tracker stores at most one entry per category. Categories
 * are usually small bounded sets (one per lock key, one per
 * worker id) — but a misuse-safe default is included: when a
 * category has been continuously healthy for `cleanupAfterMs` and
 * has never recorded a failure, it is dropped. This costs nothing
 * in the failure path and prevents accidental unbounded growth
 * from rare-but-large key spaces.
 */

/**
 * Edge-transition decisions emitted by the tracker. Callers map
 * these to their own log levels / sinks.
 */
export type FailureLogLevel =
  /** First failure after a healthy / quiet stretch. */
  | 'first'
  /** Continued failure below the persistent-threshold. */
  | 'continuing'
  /** Reached the persistent threshold for the first time. */
  | 'persistent'
  /** Beyond the persistent threshold — suppress entirely. */
  | 'suppress'
  /** First success after a failure streak. */
  | 'recovery';

export interface IFailureDecision {
  level: FailureLogLevel;
  /** Running consecutive-failure count (post-record). */
  count: number;
  /** Milliseconds since the first failure in this streak. */
  elapsedMs: number;
}

export interface IFailureTrackerOptions {
  /**
   * Number of consecutive failures at which the tracker escalates
   * to `persistent` (one ERROR-worthy decision). Default 10.
   */
  persistentThreshold?: number;
  /**
   * Drop a category's tracker entry once it has been healthy for
   * this many milliseconds. Default 5 minutes. Keeps the in-memory
   * map bounded under category-churn workloads.
   */
  cleanupAfterMs?: number;
  /**
   * Clock function — overridable so tests don't need fake timers.
   * Default `Date.now`.
   */
  now?: () => number;
}

interface IStreakState {
  /** Consecutive failure count in the current streak (0 = healthy). */
  count: number;
  /** Timestamp of the first failure in the current streak. */
  startedAt: number;
  /** Timestamp of the most recent activity (record* call). */
  lastSeenAt: number;
  /** Whether we have already emitted `persistent` for this streak. */
  persistentEmitted: boolean;
}

export class FailureTracker {
  private readonly persistentThreshold: number;
  private readonly cleanupAfterMs: number;
  private readonly now: () => number;
  private readonly streaks = new Map<string, IStreakState>();

  constructor(options: IFailureTrackerOptions = {}) {
    this.persistentThreshold = options.persistentThreshold ?? 10;
    this.cleanupAfterMs = options.cleanupAfterMs ?? 300_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Record a failure for `category`. Returns a decision the caller
   * uses to pick the appropriate log level + message.
   */
  recordFailure(category: string): IFailureDecision {
    const now = this.now();
    const existing = this.streaks.get(category);
    if (!existing) {
      this.streaks.set(category, {
        count: 1,
        startedAt: now,
        lastSeenAt: now,
        persistentEmitted: false,
      });
      return { level: 'first', count: 1, elapsedMs: 0 };
    }
    existing.count++;
    existing.lastSeenAt = now;
    const elapsedMs = now - existing.startedAt;
    if (existing.count < this.persistentThreshold) {
      return { level: 'continuing', count: existing.count, elapsedMs };
    }
    if (!existing.persistentEmitted) {
      existing.persistentEmitted = true;
      return { level: 'persistent', count: existing.count, elapsedMs };
    }
    return { level: 'suppress', count: existing.count, elapsedMs };
  }

  /**
   * Record a success for `category`. Returns a decision: `recovery`
   * on the first success that closes an active failure streak,
   * `null` for an unbroken healthy stretch (no log expected).
   */
  recordSuccess(category: string): IFailureDecision | null {
    const now = this.now();
    const existing = this.streaks.get(category);
    if (!existing || existing.count === 0) {
      // No prior failure → nothing to announce. Opportunistically
      // sweep stale entries while we're touching the map.
      this.sweepStale(now);
      return null;
    }
    const decision: IFailureDecision = {
      level: 'recovery',
      count: existing.count,
      elapsedMs: now - existing.startedAt,
    };
    this.streaks.delete(category);
    this.sweepStale(now);
    return decision;
  }

  /**
   * Snapshot for diagnostics — returns an array of currently-failing
   * categories with their counts and ages.
   */
  snapshot(): Array<{ category: string; count: number; elapsedMs: number }> {
    const now = this.now();
    return Array.from(this.streaks.entries())
      .filter(([, s]) => s.count > 0)
      .map(([category, s]) => ({
        category,
        count: s.count,
        elapsedMs: now - s.startedAt,
      }));
  }

  /**
   * Forget all tracked state. Useful at shutdown.
   */
  clear(): void {
    this.streaks.clear();
  }

  private sweepStale(now: number): void {
    if (this.streaks.size === 0) return;
    for (const [category, s] of this.streaks) {
      if (s.count === 0 && now - s.lastSeenAt > this.cleanupAfterMs) {
        this.streaks.delete(category);
      }
    }
  }
}
