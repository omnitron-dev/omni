'use client';

/**
 * useClientRect Hook
 *
 * Gets bounding client rect and scroll dimensions of a DOM element.
 * SSR-safe with automatic updates on resize/scroll.
 *
 * @module @omnitron-dev/prism/hooks
 */

import { useState, useCallback, useEffect, useRef, type RefObject } from 'react';

/**
 * Scroll element dimensions.
 */
export interface ScrollElValue {
  /** Scrollable width */
  scrollWidth: number;
  /** Scrollable height */
  scrollHeight: number;
}

/**
 * DOMRect values (SSR-safe).
 */
export interface DOMRectValue {
  top: number;
  right: number;
  bottom: number;
  left: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Return type for useClientRect hook.
 */
export interface UseClientRectReturn<T extends HTMLElement = HTMLElement> extends DOMRectValue, ScrollElValue {
  /** Ref to attach to the target element */
  elementRef: RefObject<T | null>;
  /** Force update measurements */
  update: () => void;
}

/**
 * Default values for SSR and when element is not available.
 */
const defaultValues: DOMRectValue & ScrollElValue = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  scrollWidth: 0,
  scrollHeight: 0,
};

/**
 * useClientRect - Hook to get bounding rect and scroll dimensions.
 *
 * @example
 * ```tsx
 * // Basic usage - auto-creates ref
 * const { elementRef, width, height, top, left } = useClientRect();
 *
 * return (
 *   <div ref={elementRef}>
 *     Width: {width}, Height: {height}
 *   </div>
 * );
 *
 * // With existing ref
 * const myRef = useRef<HTMLDivElement>(null);
 * const { width, scrollWidth } = useClientRect(myRef);
 *
 * // Listen to scroll events
 * const { y, scrollHeight } = useClientRect(ref, 'scroll');
 *
 * // Calculate scroll progress
 * const progress = y / (scrollHeight - height);
 * ```
 */
export function useClientRect<T extends HTMLElement = HTMLElement>(
  inputRef?: RefObject<T | null>,
  eventType?: 'scroll' | 'resize'
): UseClientRectReturn<T> {
  const internalRef = useRef<T>(null);
  const elementRef = (inputRef ?? internalRef) as RefObject<T | null>;

  const [rect, setRect] = useState<DOMRectValue & ScrollElValue>(defaultValues);

  const update = useCallback(() => {
    const element = elementRef.current;

    if (!element) {
      setRect(defaultValues);
      return;
    }

    const domRect = element.getBoundingClientRect();

    setRect({
      top: domRect.top,
      right: domRect.right,
      bottom: domRect.bottom,
      left: domRect.left,
      x: domRect.x,
      y: domRect.y,
      width: domRect.width,
      height: domRect.height,
      scrollWidth: element.scrollWidth,
      scrollHeight: element.scrollHeight,
    });
  }, [elementRef]);

  useEffect(() => {
    const element = elementRef.current;

    // Initial measurement
    update();

    if (!element || typeof window === 'undefined') return undefined;

    // Observe resize with ResizeObserver
    const resizeObserver = new ResizeObserver(() => {
      update();
    });
    resizeObserver.observe(element);

    // Optional event listener
    const target = eventType === 'scroll' ? element : window;
    const event = eventType ?? 'resize';

    const handleEvent = () => {
      update();
    };

    target.addEventListener(event, handleEvent, { passive: true });

    return () => {
      resizeObserver.disconnect();
      target.removeEventListener(event, handleEvent);
    };
  }, [elementRef, eventType, update]);

  return {
    ...rect,
    elementRef,
    update,
  };
}
