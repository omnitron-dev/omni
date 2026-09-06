'use client';

/**
 * useCountdown Hook
 *
 * Countdown timer with start, pause, and reset controls.
 *
 * @module core/hooks/use-countdown
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Countdown state.
 */
export interface CountdownState {
  /** Remaining time in seconds */
  seconds: number;
  /** Whether countdown is running */
  isRunning: boolean;
  /** Whether countdown has finished */
  isFinished: boolean;
}

/**
 * Countdown controls.
 */
export interface CountdownControls {
  /** Start or resume the countdown */
  start: () => void;
  /** Pause the countdown */
  pause: () => void;
  /** Reset to initial duration */
  reset: () => void;
  /** Set a new duration and reset */
  setDuration: (seconds: number) => void;
}

/**
 * Return type for useCountdown.
 */
export interface UseCountdownReturn extends CountdownState, CountdownControls {
  /** Formatted time string (MM:SS or HH:MM:SS) */
  formatted: string;
  /** Time parts for custom formatting */
  parts: {
    hours: number;
    minutes: number;
    seconds: number;
  };
}

/**
 * Options for useCountdown.
 */
export interface UseCountdownOptions {
  /** Initial duration in seconds */
  duration: number;
  /** Auto-start countdown (default: false) */
  autoStart?: boolean;
  /** Callback when countdown finishes */
  onComplete?: () => void;
  /** Callback on each tick */
  onTick?: (remaining: number) => void;
  /** Tick interval in ms (default: 1000) */
  interval?: number;
}

/**
 * Format seconds into time parts.
 */
function getTimeParts(totalSeconds: number): { hours: number; minutes: number; seconds: number } {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { hours, minutes, seconds };
}

/**
 * Format seconds into a time string.
 */
function formatTime(totalSeconds: number): string {
  const { hours, minutes, seconds } = getTimeParts(totalSeconds);
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * useCountdown - Countdown timer hook.
 *
 * @example
 * ```tsx
 * function OTPTimer() {
 *   const { formatted, isFinished, reset } = useCountdown({
 *     duration: 60,
 *     autoStart: true,
 *     onComplete: () => console.log('Timer finished!'),
 *   });
 *
 *   return (
 *     <div>
 *       {isFinished ? (
 *         <Button onClick={reset}>Resend OTP</Button>
 *       ) : (
 *         <Typography>Resend in {formatted}</Typography>
 *       )}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * function QuizTimer() {
 *   const countdown = useCountdown({
 *     duration: 300, // 5 minutes
 *     onTick: (remaining) => {
 *       if (remaining === 60) {
 *         showWarning('1 minute remaining!');
 *       }
 *     },
 *     onComplete: () => submitQuiz(),
 *   });
 *
 *   return (
 *     <Box>
 *       <Typography variant="h4">{countdown.formatted}</Typography>
 *       <Button onClick={countdown.start}>Start</Button>
 *       <Button onClick={countdown.pause}>Pause</Button>
 *       <Button onClick={countdown.reset}>Reset</Button>
 *     </Box>
 *   );
 * }
 * ```
 *
 * @param options - Countdown options
 * @returns Countdown state and controls
 */
export function useCountdown(options: UseCountdownOptions): UseCountdownReturn {
  const { duration, autoStart = false, onComplete, onTick, interval = 1000 } = options;

  const [seconds, setSeconds] = useState(duration);
  const [isRunning, setIsRunning] = useState(autoStart);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onCompleteRef = useRef(onComplete);
  const onTickRef = useRef(onTick);

  /**
   * The remaining time, tracked outside React state.
   *
   * The tick needs to read the current value and act on it in the same
   * breath, and doing that inside a `setSeconds` updater is what broke this
   * hook: an updater must be pure, and React is entitled to run it more than
   * once — which under `StrictMode` it does, deliberately, to surface exactly
   * this. Measured before the fix, a two-second countdown called `onTick`
   * ten times with `[1, 1, 0, 0, -1, -1, …]` and `onComplete` eight times.
   */
  const remainingRef = useRef(duration);

  /**
   * Whether `onComplete` has already been delivered for this run.
   *
   * The old guard was `next <= 0`, a property of the computed value rather
   * than of the countdown, so every tick after zero satisfied it again. The
   * interval kept firing until the effect tore down, and each firing
   * completed the countdown once more — four times without `StrictMode`.
   * `onComplete` is where a caller submits the quiz.
   */
  const completedRef = useRef(false);

  // Update refs to avoid stale closures
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onTickRef.current = onTick;
  }, [onComplete, onTick]);

  // Cleanup interval on unmount
  useEffect(
    () => () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    },
    []
  );

  // Run countdown
  useEffect(() => {
    if (!isRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return undefined;
    }

    intervalRef.current = setInterval(() => {
      // Stopping is the effect's job, but it can only do it on the next
      // render, and several ticks can queue before one happens — a long task,
      // a burst of work, a test advancing a fake clock. The callback has to
      // be inert on its own once the countdown is over, not merely
      // uninteresting.
      if (completedRef.current) return;

      // Everything here is a side effect, so none of it belongs in a state
      // updater. The arithmetic reads a ref, the state is set from the
      // result, and the callbacks fire once each.
      const next = Math.max(0, remainingRef.current - 1);
      remainingRef.current = next;
      setSeconds(next);
      onTickRef.current?.(next);

      if (next === 0) {
        setIsRunning(false);
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.();
        }
      }
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRunning, interval]);

  const start = useCallback(() => {
    if (seconds > 0) {
      setIsRunning(true);
    }
  }, [seconds]);

  const pause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    remainingRef.current = duration;
    completedRef.current = false;
    setSeconds(duration);
  }, [duration]);

  const setDuration = useCallback((newDuration: number) => {
    setIsRunning(false);
    remainingRef.current = newDuration;
    completedRef.current = false;
    setSeconds(newDuration);
  }, []);

  return {
    seconds,
    isRunning,
    isFinished: seconds <= 0,
    formatted: formatTime(seconds),
    parts: getTimeParts(seconds),
    start,
    pause,
    reset,
    setDuration,
  };
}
