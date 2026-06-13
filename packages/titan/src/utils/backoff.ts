/**
 * Exponential backoff with optional jitter.
 *
 * Pre-fix this same `Math.min(base * pow(factor, attempt), max)`
 * shape appeared in three places across titan-* with slightly
 * different jitter handling and attempt-numbering conventions:
 *
 *   - titan-pm process-health.ts (delay between health-check
 *     retries, 30 % jitter)
 *   - titan-pm process-pool.ts (per-worker backoff multiplier
 *     before re-checking a failing worker, no jitter)
 *   - titan-scheduler scheduler.executor.ts (delay between job
 *     retries, configurable factor, no jitter)
 *
 * Consolidating into one helper eliminates the chance that a
 * future fix to one site (e.g., "cap jitter at 100 ms to keep
 * retries bounded") silently misses the other two.
 *
 * Semantic
 * --------
 *   delay = min(baseMs * factor^attempt, maxMs) + jitter
 *
 * where `jitter` is uniformly distributed in
 * `[0, jitter * exponentialDelay)`. `attempt` is 0-indexed
 * (attempt=0 → base delay). `factor` defaults to 2 (classic
 * exponential), `jitter` defaults to 0 (no jitter).
 *
 * Inputs are validated — negative attempts treated as 0,
 * non-finite factors fall back to 2, jitter clamped to [0, 1].
 * These guards make the helper safe to call from a retry loop
 * that might receive corrupted state.
 */
export interface IBackoffOptions {
  /** Retry attempt number (0-indexed). */
  attempt: number;
  /** Delay for attempt 0, in milliseconds. */
  baseMs: number;
  /** Maximum delay before jitter, in milliseconds. */
  maxMs: number;
  /** Exponential growth factor. Default 2. */
  factor?: number;
  /**
   * Jitter fraction (0..1). When > 0, jitter is applied per `jitterMode`.
   * Default 0 (no jitter). Common choice: 0.3 to prevent thundering herds
   * across N parallel retriers.
   */
  jitter?: number;
  /**
   * Jitter distribution:
   *   - `'additive'` (default): a value from `[0, jitter * delay)` is ADDED,
   *     so the delay only ever grows. Result is NOT clamped to `maxMs`
   *     post-jitter (preserves the original behaviour of the titan-pm /
   *     scheduler callers).
   *   - `'centered'`: a value from `[-0.5, +0.5) * jitter * delay` is added,
   *     keeping the mean at the exponential value. The result IS clamped to
   *     `[minMs, maxMs]` (centered jitter can push below/above). This is the
   *     reconnect-backoff shape used by the netron transports (WIRE-4).
   */
  jitterMode?: 'additive' | 'centered';
  /**
   * Lower bound applied AFTER centered jitter (ignored for `'additive'`).
   * Default 0. The netron reconnect path uses `minMs = baseMs` so a downward
   * jitter never schedules a reconnect sooner than the base delay.
   */
  minMs?: number;
  /**
   * RNG override — defaults to `Math.random`. Lets tests
   * deterministically check the jitter envelope.
   */
  random?: () => number;
}

export function computeBackoff(options: IBackoffOptions): number {
  const attempt = Math.max(0, Math.floor(options.attempt));
  const baseMs = Math.max(0, options.baseMs);
  const maxMs = Math.max(0, options.maxMs);
  const factor = Number.isFinite(options.factor) && options.factor! > 0 ? options.factor! : 2;
  const jitter = Math.min(1, Math.max(0, options.jitter ?? 0));
  const random = options.random ?? Math.random;

  const exponential = Math.min(baseMs * Math.pow(factor, attempt), maxMs);
  if (jitter === 0) return exponential;

  if (options.jitterMode === 'centered') {
    const minMs = Math.max(0, options.minMs ?? 0);
    const jittered = exponential + (random() - 0.5) * exponential * jitter;
    return Math.min(Math.max(jittered, minMs), maxMs);
  }

  // 'additive' (default) — unchanged historical behaviour.
  return exponential + random() * exponential * jitter;
}
