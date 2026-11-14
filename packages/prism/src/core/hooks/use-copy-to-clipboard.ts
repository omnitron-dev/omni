'use client';

/**
 * useCopyToClipboard Hook
 *
 * Copy text to clipboard with success/error state tracking.
 *
 * @module core/hooks/use-copy-to-clipboard
 */

import { useCallback, useState, useRef, useEffect, useMemo } from 'react';

/**
 * Copy state types.
 */
export type CopyState = 'idle' | 'success' | 'error';

/**
 * Return type for useCopyToClipboard.
 */
export interface UseCopyToClipboardReturn {
  /** Current copy state */
  state: CopyState;
  /** Copied text (null if not copied) */
  copiedText: string | null;
  /** Copy text; only the latest request updates state or invokes callbacks. */
  copy: (text: string) => Promise<boolean>;
  /** Reset state to idle and invalidate pending requests. */
  reset: () => void;
}

/**
 * Options for useCopyToClipboard.
 */
export interface UseCopyToClipboardOptions {
  /** Reset to idle after this many ms (default: 2000) */
  resetTimeout?: number;
  /** Callback when the latest copy succeeds */
  onSuccess?: (text: string) => void;
  /** Callback when the latest copy fails */
  onError?: (error: Error) => void;
}

/**
 * useCopyToClipboard - Copy text to clipboard with state tracking.
 *
 * @example
 * ```tsx
 * function CopyButton({ text }: { text: string }) {
 *   const { state, copy } = useCopyToClipboard();
 *
 *   return (
 *     <Button onClick={() => copy(text)}>
 *       {state === 'success' ? 'Copied!' : 'Copy'}
 *     </Button>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With callback
 * function ShareLink({ url }: { url: string }) {
 *   const { state, copy } = useCopyToClipboard({
 *     onSuccess: () => enqueueSnackbar('Link copied!'),
 *     onError: (err) => enqueueSnackbar(`Failed to copy: ${err.message}`, { variant: 'error' }),
 *   });
 *
 *   return (
 *     <IconButton onClick={() => copy(url)}>
 *       {state === 'success' ? <CheckIcon /> : <CopyIcon />}
 *     </IconButton>
 *   );
 * }
 * ```
 *
 * @param options - Hook options
 * @returns Copy function and state
 */
export function useCopyToClipboard(options: UseCopyToClipboardOptions = {}): UseCopyToClipboardReturn {
  const { resetTimeout = 2000, onSuccess, onError } = options;

  const [state, setState] = useState<CopyState>('idle');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const mountedRef = useRef(true);

  const invalidate = useCallback(() => {
    requestRef.current += 1;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidate();
    };
  }, [invalidate]);

  const reset = useCallback(() => {
    invalidate();
    if (!mountedRef.current) return;
    setState('idle');
    setCopiedText(null);
  }, [invalidate]);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!mountedRef.current) return false;
      reset();
      const request = requestRef.current;
      const isCurrent = () => mountedRef.current && requestRef.current === request;
      const scheduleReset = () => {
        if (isCurrent() && resetTimeout > 0) {
          timeoutRef.current = setTimeout(() => {
            if (isCurrent()) reset();
          }, resetTimeout);
        }
      };

      try {
        if (typeof navigator === 'undefined' || !navigator.clipboard) throw new Error('Clipboard API not available');
        await navigator.clipboard.writeText(text);
        if (isCurrent()) {
          setCopiedText(text);
          setState('success');
          onSuccess?.(text);
          scheduleReset();
        }

        return true;
      } catch (err) {
        if (isCurrent()) {
          const error = err instanceof Error ? err : new Error('Failed to copy');
          setState('error');
          onError?.(error);
          scheduleReset();
        }

        return false;
      }
    },
    [resetTimeout, reset, onSuccess, onError]
  );

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
      state,
      copiedText,
      copy,
      reset,
    }),
    [state, copiedText, copy, reset]
  );
}
