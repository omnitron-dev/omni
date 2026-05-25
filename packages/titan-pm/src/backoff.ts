/**
 * Shared backoff library — single source of truth for inter-restart
 * delay computation across titan-pm + downstream consumers.
 *
 * Pre-this-module two divergent implementations lived inside the
 * codebase:
 *
 *   1. `ProcessSupervisor.computeBackoffDelay` (initial=300ms).
 *   2. `OrchestratorService.calculateBackoff` (initial=1000ms).
 *
 * A classic-mode crash thus waited 3.3× longer than a bootstrap-mode
 * crash for the same backoff config. Both implementations also had
 * subtle differences in `factor` defaults and how the `restartCount`
 * mapped to the exponent (N vs N-1). Centralising the math here
 * gives one tested implementation that consumers `import` instead of
 * re-deriving.
 *
 * Defaults reflect the *supervisor* historical behaviour (300ms
 * initial, factor=2, max=30s) — short enough for a transient blip
 * to recover quickly, long enough that pathological crash loops
 * exhaust the sliding-window budget before pegging CPU.
 */

export type BackoffType = 'fixed' | 'linear' | 'exponential';

export interface BackoffConfig {
  /** Strategy. `exponential` by default — `initial × factor^n`. */
  type?: BackoffType;
  /** Base delay in ms. Default 300. */
  initial?: number;
  /** Multiplier (exponential) or step (linear). Default 2 for exp, 1 for linear. */
  factor?: number;
  /** Hard ceiling in ms. Default 30_000. */
  max?: number;
  /**
   * Optional jitter as a fraction of the computed delay (0..1).
   * `jitter: 0.25` adds up to ±25% random offset — prevents
   * thundering-herd on mass restart. Default 0 (deterministic).
   */
  jitter?: number;
}

/**
 * Compute the inter-restart delay for the `attempt`-th respawn
 * (1-indexed: the first restart after a crash is attempt=1, second
 * is attempt=2, etc.). Returns a non-negative integer ms value.
 *
 *  - `fixed`        → `initial` regardless of attempt.
 *  - `linear`       → `initial × (1 + factor × (attempt-1))`.
 *  - `exponential`  → `initial × factor^(attempt-1)`.
 *
 * Final result is clamped to `[0, max]` and jittered by `jitter`
 * (when supplied). The jitter is uniform in `±jitter*delay`.
 */
export function computeBackoff(attempt: number, config: BackoffConfig = {}): number {
  if (attempt <= 0) return 0;
  const initial = config.initial ?? 300;
  const max = config.max ?? 30_000;
  const type = config.type ?? 'exponential';
  const factor = config.factor ?? (type === 'linear' ? 1 : 2);

  const n = Math.max(0, attempt - 1);
  let delay: number;
  switch (type) {
    case 'fixed':
      delay = initial;
      break;
    case 'linear':
      delay = initial + factor * n * initial;
      break;
    case 'exponential':
    default:
      delay = initial * Math.pow(factor, n);
      break;
  }
  delay = Math.min(Math.max(0, delay), max);

  const jitter = config.jitter;
  if (jitter && jitter > 0) {
    const span = delay * jitter;
    delay += (Math.random() * 2 - 1) * span;
    delay = Math.min(Math.max(0, delay), max);
  }
  return Math.round(delay);
}

/**
 * Generator that yields successive backoff delays. Useful when the
 * caller wants to walk the schedule explicitly (e.g. a retry loop
 * that needs to compute "the next two delays" up front).
 */
export function* backoffSchedule(config: BackoffConfig = {}): Generator<number> {
  let attempt = 1;
  while (true) {
    yield computeBackoff(attempt, config);
    attempt += 1;
  }
}

/**
 * Sleep for the computed delay. Convenience for the common case
 * `await sleep(computeBackoff(n, cfg))`.
 */
export function sleepBackoff(attempt: number, config?: BackoffConfig): Promise<void> {
  const ms = computeBackoff(attempt, config);
  if (ms === 0) return Promise.resolve();
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
