'use client';

/**
 * useCopyToClipboard Hook
 *
 * Copy text to clipboard with success/error state tracking.
 *
 * @module @omnitron/prism/core/hooks/use-copy-to-clipboard
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
  /** Copy text to clipboard */
  copy: (text: string) => Promise<boolean>;
  /** Reset state to idle */
  reset: () => void;
}

/**
 * Options for useCopyToClipboard.
 */
export interface UseCopyToClipboardOptions {
  /** Reset to idle after this many ms (default: 2000) */
  resetTimeout?: number;
  /** Callback on successful copy */
  onSuccess?: (text: string) => void;
  /** Callback on copy error */
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

  // Cleanup timeout on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  const reset = useCallback(() => {
    // Clear any pending timeout when manually resetting
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setState('idle');
    setCopiedText(null);
  }, []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Check if clipboard API is available
      if (!navigator?.clipboard) {
        const error = new Error('Clipboard API not available');
        setState('error');
        onError?.(error);
        return false;
      }

      try {
        await navigator.clipboard.writeText(text);
        setCopiedText(text);
        setState('success');
        onSuccess?.(text);

        // Auto-reset after timeout
        if (resetTimeout > 0) {
          timeoutRef.current = setTimeout(reset, resetTimeout);
        }

        return true;
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to copy');
        setState('error');
        onError?.(error);

        // Auto-reset after timeout
        if (resetTimeout > 0) {
          timeoutRef.current = setTimeout(reset, resetTimeout);
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
