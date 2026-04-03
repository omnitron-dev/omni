'use client';

/**
 * useIntersectionObserver Hook
 *
 * Observe element visibility using the Intersection Observer API.
 *
 * @module @omnitron/prism/hooks/use-intersection-observer
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface UseIntersectionObserverOptions {
  /** Root element for intersection (default: viewport) */
  root?: Element | Document | null;
  /** Root margin (default: '0px') */
  rootMargin?: string;
  /** Threshold(s) at which to trigger (default: 0) */
  threshold?: number | number[];
  /** Whether to disconnect after first intersection (default: false) */
  triggerOnce?: boolean;
  /** Whether to start observing immediately (default: true) */
  enabled?: boolean;
}

export interface UseIntersectionObserverReturn {
  /** Ref to attach to the target element */
  ref: (element: Element | null) => void;
  /** Current intersection entry */
  entry: IntersectionObserverEntry | null;
  /** Whether the element is intersecting */
  isIntersecting: boolean;
  /** Manually disconnect the observer */
  disconnect: () => void;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * useIntersectionObserver - Observe element visibility.
 *
 * Uses the Intersection Observer API to track when an element
 * enters or exits the viewport (or a custom root element).
 *
 * @example
 * ```tsx
 * // Lazy loading images
 * function LazyImage({ src }: { src: string }) {
 *   const { ref, isIntersecting } = useIntersectionObserver({
 *     triggerOnce: true,
 *   });
 *
 *   return (
 *     <div ref={ref}>
 *       {isIntersecting ? (
 *         <img src={src} alt="" />
 *       ) : (
 *         <Skeleton variant="rectangular" height={200} />
 *       )}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Infinite scroll
 * function InfiniteList({ items, onLoadMore }) {
 *   const { ref, isIntersecting } = useIntersectionObserver({
 *     threshold: 0.5,
 *   });
 *
 *   useEffect(() => {
 *     if (isIntersecting) {
 *       onLoadMore();
 *     }
 *   }, [isIntersecting, onLoadMore]);
 *
 *   return (
 *     <Box>
 *       {items.map((item) => <Item key={item.id} {...item} />)}
 *       <div ref={ref} style={{ height: 1 }} />
 *     </Box>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Animate on scroll
 * function AnimatedSection({ children }) {
 *   const { ref, isIntersecting } = useIntersectionObserver({
 *     threshold: 0.1,
 *     triggerOnce: true,
 *   });
 *
 *   return (
 *     <Fade in={isIntersecting}>
 *       <Box ref={ref}>{children}</Box>
 *     </Fade>
 *   );
 * }
 * ```
 *
 * @param options - Observer options
 * @returns Ref, entry, intersection state, and disconnect function
 */
export function useIntersectionObserver(options: UseIntersectionObserverOptions = {}): UseIntersectionObserverReturn {
  const { root = null, rootMargin = '0px', threshold = 0, triggerOnce = false, enabled = true } = options;

  const [entry, setEntry] = useState<IntersectionObserverEntry | null>(null);
  const elementRef = useRef<Element | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const frozenRef = useRef(false);

  const disconnect = useCallback(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
  }, []);

  const ref = useCallback(
    (element: Element | null) => {
      // Disconnect previous observer
      disconnect();

      elementRef.current = element;

      // Don't observe if disabled, frozen, or no element
      if (!enabled || frozenRef.current || !element) {
        return;
      }

      // Check for IntersectionObserver support
      if (typeof IntersectionObserver === 'undefined') {
        // Fallback: assume visible
        setEntry({
          isIntersecting: true,
          intersectionRatio: 1,
          boundingClientRect: element.getBoundingClientRect(),
          intersectionRect: element.getBoundingClientRect(),
          rootBounds: null,
          target: element,
          time: Date.now(),
        } as IntersectionObserverEntry);
        return;
      }

      observerRef.current = new IntersectionObserver(
        ([observerEntry]) => {
          setEntry(observerEntry);

          if (triggerOnce && observerEntry.isIntersecting) {
            frozenRef.current = true;
            disconnect();
          }
        },
        { root, rootMargin, threshold }
      );

      observerRef.current.observe(element);
    },
    [enabled, root, rootMargin, threshold, triggerOnce, disconnect]
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      disconnect();
    },
    [disconnect]
  );

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
      ref,
      entry,
      isIntersecting: entry?.isIntersecting ?? false,
      disconnect,
    }),
    [entry, disconnect]
  );
}
