'use client';

/**
 * useCountdownSeconds Hook
 *
 * Simple countdown timer in seconds. Ideal for OTP resend timers,
 * session timeouts, and other time-limited operations.
 *
 * @module @omnitron-dev/prism/hooks
 */

import type { Dispatch, SetStateAction } from 'react';
import { useState, useEffect, useCallback, useMemo } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Return type for useCountdownSeconds hook.
 */
export interface UseCountdownSecondsReturn {
  /** Current countdown value in seconds */
  value: number;
  /** Start the countdown */
  start: () => void;
  /** Reset countdown to initial value and stop */
  reset: () => void;
  /** Whether countdown is currently active */
  isCounting: boolean;
  /** Manually set the countdown value */
  setValue: Dispatch<SetStateAction<number>>;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to create a simple countdown timer in seconds.
 *
 * Perfect for:
 * - OTP resend timers
 * - Session timeout warnings
 * - Rate limiting UI feedback
 * - Game timers
 *
 * @param initialSeconds - Initial countdown value in seconds
 * @returns Countdown state and control functions
 *
 * @example
 * ```tsx
 * // OTP resend timer
 * function OTPForm() {
 *   const { value, start, reset, isCounting } = useCountdownSeconds(60);
 *
 *   const handleResend = async () => {
 *     await resendOTP();
 *     reset();
 *     start();
 *   };
 *
 *   return (
 *     <div>
 *       <input placeholder="Enter OTP" />
 *       <button onClick={handleResend} disabled={isCounting}>
 *         {isCounting ? `Resend in ${value}s` : 'Resend OTP'}
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Session timeout warning
 * function SessionWarning() {
 *   const { value, start, isCounting } = useCountdownSeconds(30);
 *
 *   useEffect(() => {
 *     if (showWarning) start();
 *   }, [showWarning]);
 *
 *   useEffect(() => {
 *     if (value === 0) logout();
 *   }, [value]);
 *
 *   return isCounting && (
 *     <Alert severity="warning">
 *       Session expires in {value} seconds
 *     </Alert>
 *   );
 * }
 * ```
 */
export function useCountdownSeconds(initialSeconds: number): UseCountdownSecondsReturn {
  const [value, setValue] = useState(initialSeconds);
  const [isCounting, setIsCounting] = useState(false);

  const start = useCallback(() => {
    setIsCounting(true);
  }, []);

  const reset = useCallback(() => {
    setIsCounting(false);
    setValue(initialSeconds);
  }, [initialSeconds]);

  useEffect(() => {
    if (!isCounting) return undefined;

    // The updater only computes. Stopping used to happen inside it —
    // `setIsCounting(false)` from within a `setValue` updater — and an
    // updater must be pure: React is entitled to run it more than once, and
    // under `StrictMode` it does so deliberately. Nothing visible went wrong
    // here because stopping twice is stopping once, but the sibling hook
    // `useCountdown` had the same shape around an `onComplete` callback and
    // fired it four times.
    const intervalId = setInterval(() => {
      setValue((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isCounting]);

  // Reaching zero is what stops the countdown, and that is a decision about
  // the state after it settles rather than part of computing it.
  useEffect(() => {
    if (value === 0) setIsCounting(false);
  }, [value]);

  return useMemo(
    () => ({
      value,
      setValue,
      isCounting,
      start,
      reset,
    }),
    [value, isCounting, start, reset]
  );
}
