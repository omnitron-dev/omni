'use client';

/**
 * useClickOutside Hook
 *
 * Detects clicks outside of a specified element.
 *
 * @module @omnitron/prism/core/hooks
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Hook to detect clicks outside of an element.
 *
 * @template T - Element type (defaults to HTMLElement)
 * @param {function} handler - Callback when clicked outside
 * @param {RefObject<T>} [providedRef] - Optional external ref
 * @returns {RefObject<T>} Ref to attach to the element
 *
 * @example
 * ```tsx
 * function Dropdown() {
 *   const [isOpen, setIsOpen] = useState(false);
 *   const ref = useClickOutside<HTMLDivElement>(() => setIsOpen(false));
 *
 *   return (
 *     <div ref={ref}>
 *       <button onClick={() => setIsOpen(true)}>Open</button>
 *       {isOpen && <DropdownMenu />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useClickOutside<T extends HTMLElement = HTMLElement>(
  handler: (event: MouseEvent | TouchEvent) => void,
  providedRef?: RefObject<T | null>
): RefObject<T | null> {
  const internalRef = useRef<T | null>(null);
  const ref = providedRef ?? internalRef;

  // Use ref to always call latest handler without re-attaching listeners
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const element = ref.current;

      // Do nothing if clicking ref's element or its descendants
      if (!element || element.contains(event.target as Node)) {
        return;
      }

      handlerRef.current(event);
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref]);

  return ref;
}
