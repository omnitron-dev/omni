'use client';

/**
 * useCountdownDate Hook
 *
 * Creates a countdown timer to a target date, returning formatted
 * days, hours, minutes, and seconds.
 *
 * Ported from minimal-shared for Prism design system.
 *
 * @module @omnitron-dev/prism/hooks/use-countdown-date
 */

import { useState, useEffect, useCallback } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Return type for useCountdownDate hook.
 */
export type UseCountdownDateReturn = {
  /** Formatted days (with leading zero) */
  days: string;
  /** Formatted hours (with leading zero) */
  hours: string;
  /** Formatted minutes (with leading zero) */
  minutes: string;
  /** Formatted seconds (with leading zero) */
  seconds: string;
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Formats a time value to ensure it is always two digits.
 */
function formatTime(value: number): string {
  return String(value).length === 1 ? `0${value}` : `${value}`;
}

/**
 * Calculates the time difference between a future date and the current date.
 */
function calculateTimeDifference(
  futureDate: Date,
  currentDate: Date
): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const distance = futureDate.getTime() - currentDate.getTime();

  if (distance < 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  return {
    days: Math.floor(distance / (1000 * 60 * 60 * 24)),
    hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((distance % (1000 * 60)) / 1000),
  };
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Custom hook to create a countdown timer to a target date.
 *
 * @param targetDate - The target date to count down to
 * @param placeholder - The placeholder value to display before the countdown starts (default: '- -')
 *
 * @returns An object containing the current countdown values in days, hours, minutes, and seconds
 *
 * @example
 * ```tsx
 * function SaleCountdown() {
 *   const { days, hours, minutes, seconds } = useCountdownDate(
 *     new Date('2024-12-31T23:59:59')
 *   );
 *
 *   return (
 *     <div>
 *       <span>{days}d</span>
 *       <span>{hours}h</span>
 *       <span>{minutes}m</span>
 *       <span>{seconds}s</span>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With custom placeholder
 * const countdown = useCountdownDate(launchDate, '--');
 * ```
 */
export function useCountdownDate(targetDate: Date, placeholder = '- -'): UseCountdownDateReturn {
  const [value, setValue] = useState<UseCountdownDateReturn>({
    days: placeholder,
    hours: placeholder,
    minutes: placeholder,
    seconds: placeholder,
  });

  /**
   * The instant, not the object holding it.
   *
   * `targetDate` used to be the dependency directly, and a `Date` is compared
   * by identity. The documented call — `useCountdownDate(new Date('…'))` —
   * builds a fresh one on every render, so the callback changed, the effect
   * re-armed, `handleUpdate` ran, `setValue` produced a new object, and that
   * re-rendered the component: an unbounded loop measured at **5003 renders
   * in 200 ms** before it was capped. The countdown displayed correctly
   * throughout, which is why it could have shipped as "sluggish page".
   *
   * A number is compared by value, so the same instant is the same
   * dependency however many `Date` wrappers a caller creates.
   */
  const targetMs = targetDate.getTime();

  const handleUpdate = useCallback(() => {
    const now = new Date();
    const { days, hours, minutes, seconds } = calculateTimeDifference(new Date(targetMs), now);

    const next = {
      days: formatTime(days),
      hours: formatTime(hours),
      minutes: formatTime(minutes),
      seconds: formatTime(seconds),
    };

    // Keep the previous object when nothing changed, so React can bail out.
    // A fresh object every second re-renders the consumer whether or not the
    // display moved — including after the target has passed, when the answer
    // is `00:00:00:00` for as long as the component stays mounted.
    setValue((prev) =>
      prev.days === next.days &&
      prev.hours === next.hours &&
      prev.minutes === next.minutes &&
      prev.seconds === next.seconds
        ? prev
        : next
    );
  }, [targetMs]);

  useEffect(() => {
    // Initial update
    handleUpdate();

    // Set up interval for updates
    const interval = setInterval(handleUpdate, 1000);

    return () => clearInterval(interval);
  }, [handleUpdate]);

  return value;
}
