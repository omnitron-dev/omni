'use client';

/**
 * useDoubleClick Hook
 *
 * Differentiates between single and double click events.
 * Single click is delayed to ensure it's not a double click.
 *
 * @module @omnitron-dev/prism/hooks
 */

import type { MouseEvent, SyntheticEvent } from 'react';
import { useRef, useCallback, useEffect } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Props for useDoubleClick hook.
 */
export interface UseDoubleClickProps {
  /**
   * Timeout in milliseconds to differentiate between single and double clicks.
   * @default 250
   */
  timeout?: number;
  /** Handler for single click (optional) */
  click?: (event: SyntheticEvent) => void;
  /** Handler for double click (required) */
  doubleClick: (event: SyntheticEvent) => void;
}

/**
 * Return type - a click handler function.
 */
export type UseDoubleClickReturn = (event: MouseEvent<HTMLElement>) => void;

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to handle single and double click events on an element.
 *
 * Uses event.detail to detect click count:
 * - detail === 1: single click (delayed by timeout)
 * - detail === 2: double click (immediate)
 *
 * The single click handler is called after a timeout, but only if
 * no second click occurs within that time.
 *
 * @param props - Hook configuration
 * @returns Click handler function to attach to element
 *
 * @example
 * ```tsx
 * function FileItem({ file }) {
 *   const handleClick = useDoubleClick({
 *     click: () => selectFile(file),
 *     doubleClick: () => openFile(file),
 *     timeout: 300,
 *   });
 *
 *   return (
 *     <div onClick={handleClick}>
 *       {file.name}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Double-click only (no single click handler)
 * const handleClick = useDoubleClick({
 *   doubleClick: () => console.log('Double clicked!'),
 * });
 * ```
 */
export function useDoubleClick({ click, doubleClick, timeout = 250 }: UseDoubleClickProps): UseDoubleClickReturn {
  const clickTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearClickTimeout = useCallback(() => {
    if (clickTimeout.current) {
      clearTimeout(clickTimeout.current);
      clickTimeout.current = null;
    }
  }, []);

  const handleEvent = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      clearClickTimeout();

      // Single click - delay execution
      if (click && event.detail === 1) {
        // React 17+ does not pool synthetic events, so the event reference remains valid
        clickTimeout.current = setTimeout(() => {
          click(event);
        }, timeout);
      }

      // Double click (or any even number of clicks) - execute immediately
      if (event.detail % 2 === 0) {
        doubleClick(event);
      }
    },
    [click, doubleClick, timeout, clearClickTimeout]
  );

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(
    () => () => {
      clearClickTimeout();
    },
    [clearClickTimeout]
  );

  return handleEvent;
}
