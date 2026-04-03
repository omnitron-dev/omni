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

  const handleUpdate = useCallback(() => {
    const now = new Date();
    const { days, hours, minutes, seconds } = calculateTimeDifference(targetDate, now);

    setValue({
      days: formatTime(days),
      hours: formatTime(hours),
      minutes: formatTime(minutes),
      seconds: formatTime(seconds),
    });
  }, [targetDate]);

  useEffect(() => {
    // Initial update
    handleUpdate();

    // Set up interval for updates
    const interval = setInterval(handleUpdate, 1000);

    return () => clearInterval(interval);
  }, [handleUpdate]);

  return value;
}
