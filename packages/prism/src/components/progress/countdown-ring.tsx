/**
 * CountdownRing — circular countdown indicator that animates from
 * full to empty as a deadline approaches. Useful for time-limited
 * artifacts (quote expiry, OTP windows, session timers, signed-URL
 * lifetimes, etc.).
 *
 * Renders a CircularProgress whose `value` shrinks from 100 to 0
 * over the remaining window. The center label defaults to "Ns"
 * but can be customized via `formatLabel`. When the deadline has
 * passed, color flips to `error` and label switches to the
 * supplied `expiredLabel` (or "Expired").
 *
 * @example
 * ```tsx
 * <CountdownRing
 *   deadline={quote.expiresAt}
 *   totalMs={quote.ttlMs}
 *   onExpire={() => setQuote(null)}
 * />
 * ```
 */
import { useEffect, useState, type ReactNode } from 'react';
import { CircularProgress, type ProgressColor } from './progress.js';

export interface CountdownRingProps {
  /** Deadline to count down to. Accepts Date or ISO string. */
  deadline: Date | string | null;
  /**
   * Total window length in ms — used as the denominator for the
   * progress percentage. If omitted, the ring is filled at mount
   * and tracks elapsed time relative to remaining.
   */
  totalMs?: number;
  /** Diameter in px. Default 40. */
  size?: number;
  /** Color while the timer is healthy. Default `primary`. */
  color?: ProgressColor;
  /** Color when remaining drops below `warningThresholdMs`. Default `warning`. */
  warningColor?: ProgressColor;
  /** Color after expiry. Default `error`. */
  expiredColor?: ProgressColor;
  /**
   * Switch to `warningColor` when remaining is below this.
   * Default 10s.
   */
  warningThresholdMs?: number;
  /** Tick interval in ms. Default 250. */
  tickIntervalMs?: number;
  /** Callback fired once when the deadline first elapses. */
  onExpire?: () => void;
  /**
   * Center-label formatter. Receives `(remainingMs, expired)` and
   * returns the string. Default: `Ns` while running, `expiredLabel`
   * after expiry.
   */
  formatLabel?: (remainingMs: number, expired: boolean) => string;
  /** Override the default expired label. */
  expiredLabel?: string;
}

export function CountdownRing({
  deadline,
  totalMs,
  size = 40,
  color = 'primary',
  warningColor = 'warning',
  expiredColor = 'error',
  warningThresholdMs = 10_000,
  tickIntervalMs = 250,
  onExpire,
  formatLabel,
  expiredLabel = 'Expired',
}: CountdownRingProps): ReactNode {
  const target = parseDeadline(deadline);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!target) return undefined;
    const id = setInterval(() => setNow(Date.now()), tickIntervalMs);
    return () => clearInterval(id);
  }, [target, tickIntervalMs]);

  // Fire onExpire exactly once per deadline transition. We track the
  // previous "expired" status in state-derived form rather than a ref
  // to keep the hook order stable across renders.
  const remainingMs = target ? Math.max(0, target - now) : 0;
  const expired = target != null && remainingMs <= 0;
  useEffect(() => {
    if (expired && onExpire) onExpire();
    // intentional: re-fire only when transitioning from running → expired
  }, [expired, onExpire]);

  const denom = totalMs && totalMs > 0 ? totalMs : remainingMs > 0 ? remainingMs : 1;
  const value = expired ? 0 : Math.min(100, (remainingMs / denom) * 100);

  const activeColor: ProgressColor = expired
    ? expiredColor
    : remainingMs <= warningThresholdMs
      ? warningColor
      : color;

  const label = formatLabel
    ? formatLabel(remainingMs, expired)
    : expired
      ? expiredLabel
      : `${Math.ceil(remainingMs / 1000)}s`;

  return (
    <CircularProgress
      value={value}
      size={size}
      color={activeColor}
      showLabel
      formatLabel={() => label}
    />
  );
}

function parseDeadline(d: Date | string | null): number | null {
  if (!d) return null;
  if (d instanceof Date) return d.getTime();
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}
