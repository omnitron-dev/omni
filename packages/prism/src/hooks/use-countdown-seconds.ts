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

    const intervalId = setInterval(() => {
      setValue((prev) => {
        if (prev <= 1) {
          setIsCounting(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isCounting]);

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
