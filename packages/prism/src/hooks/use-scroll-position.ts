'use client';

/**
 * useScrollPosition Hook
 *
 * Tracks scroll position with performance optimization.
 *
 * @module @omnitron/prism/hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Scroll position data.
 */
export interface ScrollPosition {
  /** Scroll position from top */
  x: number;
  /** Scroll position from left */
  y: number;
  /** Scroll direction (1 = down/right, -1 = up/left, 0 = initial) */
  directionX: -1 | 0 | 1;
  directionY: -1 | 0 | 1;
  /** Whether scrolled past threshold */
  isScrolled: boolean;
  /** Whether at the top */
  isAtTop: boolean;
  /** Whether at the bottom */
  isAtBottom: boolean;
}

/**
 * Options for useScrollPosition hook.
 */
export interface UseScrollPositionOptions {
  /** Element to track (default: window) */
  element?: HTMLElement | null;
  /** Throttle delay in ms (default: 100) */
  throttle?: number;
  /** Threshold to consider "scrolled" (default: 0) */
  threshold?: number;
  /** Offset from bottom to consider "at bottom" (default: 10) */
  bottomOffset?: number;
}

/**
 * useScrollPosition - Hook for tracking scroll position.
 *
 * @example
 * ```tsx
 * // Track window scroll
 * const { y, isScrolled, directionY } = useScrollPosition();
 *
 * // Show header shadow when scrolled
 * <Header className={isScrolled ? 'shadow' : ''} />
 *
 * // Hide header on scroll down, show on scroll up
 * const showHeader = directionY !== 1 || y < 50;
 *
 * // Track specific element
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { isAtBottom } = useScrollPosition({ element: containerRef.current });
 *
 * // Load more when near bottom
 * useEffect(() => {
 *   if (isAtBottom) loadMore();
 * }, [isAtBottom]);
 * ```
 */
export function useScrollPosition(options: UseScrollPositionOptions = {}): ScrollPosition {
  const { element = null, throttle = 100, threshold = 0, bottomOffset = 10 } = options;

  const [position, setPosition] = useState<ScrollPosition>({
    x: 0,
    y: 0,
    directionX: 0,
    directionY: 0,
    isScrolled: false,
    isAtTop: true,
    isAtBottom: false,
  });

  const lastPosition = useRef({ x: 0, y: 0 });
  const ticking = useRef(false);

  const updatePosition = useCallback(() => {
    // SSR guard - only run on client
    if (typeof window === 'undefined') return;

    const target = element ?? window;
    const scrollX = element ? element.scrollLeft : window.scrollX;
    const scrollY = element ? element.scrollTop : window.scrollY;

    // Calculate max scroll
    const maxScrollY = element
      ? element.scrollHeight - element.clientHeight
      : document.documentElement.scrollHeight - window.innerHeight;

    // Calculate direction
    const directionX = scrollX > lastPosition.current.x ? 1 : scrollX < lastPosition.current.x ? -1 : 0;
    const directionY = scrollY > lastPosition.current.y ? 1 : scrollY < lastPosition.current.y ? -1 : 0;

    lastPosition.current = { x: scrollX, y: scrollY };

    setPosition({
      x: scrollX,
      y: scrollY,
      directionX: directionX as -1 | 0 | 1,
      directionY: directionY as -1 | 0 | 1,
      isScrolled: scrollY > threshold,
      isAtTop: scrollY <= 0,
      isAtBottom: scrollY >= maxScrollY - bottomOffset,
    });

    ticking.current = false;
  }, [element, threshold, bottomOffset]);

  const handleScroll = useCallback(() => {
    if (!ticking.current) {
      if (throttle > 0) {
        window.requestAnimationFrame(() => {
          updatePosition();
        });
      } else {
        updatePosition();
      }
      ticking.current = true;

      if (throttle > 0) {
        setTimeout(() => {
          ticking.current = false;
        }, throttle);
      }
    }
  }, [throttle, updatePosition]);

  useEffect(() => {
    // SSR guard
    if (typeof window === 'undefined') return undefined;

    const target = element ?? window;

    // Initial position
    updatePosition();

    target.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      target.removeEventListener('scroll', handleScroll);
    };
  }, [element, handleScroll, updatePosition]);

  return position;
}

/**
 * useScrollToTop - Hook for scrolling to top functionality.
 *
 * @example
 * ```tsx
 * const { scrollToTop, showButton } = useScrollToTop({ threshold: 300 });
 *
 * {showButton && (
 *   <Fab onClick={scrollToTop}>
 *     <ArrowUpIcon />
 *   </Fab>
 * )}
 * ```
 */
export function useScrollToTop(options: { threshold?: number } = {}): {
  scrollToTop: () => void;
  showButton: boolean;
} {
  const { threshold = 300 } = options;
  const { y } = useScrollPosition({ threshold });

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return {
    scrollToTop,
    showButton: y > threshold,
  };
}

/**
 * useScrollLock - Hook for locking body scroll.
 *
 * @example
 * ```tsx
 * const { lock, unlock, isLocked } = useScrollLock();
 *
 * // Lock when modal opens
 * useEffect(() => {
 *   if (isOpen) lock();
 *   else unlock();
 * }, [isOpen]);
 * ```
 */
export function useScrollLock(): {
  lock: () => void;
  unlock: () => void;
  isLocked: boolean;
} {
  const [isLocked, setIsLocked] = useState(false);
  const scrollY = useRef(0);

  const lock = useCallback(() => {
    if (typeof document === 'undefined') return;

    scrollY.current = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY.current}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    setIsLocked(true);
  }, []);

  const unlock = useCallback(() => {
    if (typeof document === 'undefined') return;

    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflow = '';
    window.scrollTo(0, scrollY.current);
    setIsLocked(false);
  }, []);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (isLocked) {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
      }
    },
    [isLocked]
  );

  return { lock, unlock, isLocked };
}
