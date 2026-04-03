'use client';

/**
 * useCarousel Hook
 *
 * State management hook for the Carousel component.
 * Handles navigation, autoplay, and responsive behavior.
 *
 * @module @omnitron-dev/prism/components/carousel
 */

import { useState, useCallback, useRef, useEffect } from 'react';

import type { UseCarouselReturn } from './types.js';

// =============================================================================
// USE CAROUSEL OPTIONS
// =============================================================================

/**
 * Options for useCarousel hook.
 */
export interface UseCarouselOptions {
  /** Total number of slides */
  totalSlides: number;
  /** Initial slide index */
  initialSlide?: number;
  /** Number of slides to show */
  slidesToShow?: number;
  /** Number of slides to scroll */
  slidesToScroll?: number;
  /** Enable infinite loop */
  loop?: boolean;
  /** Enable autoplay */
  autoplay?: boolean;
  /** Autoplay interval in ms */
  autoplayInterval?: number;
  /** Callback when slide changes */
  onSlideChange?: (index: number) => void;
}

// =============================================================================
// USE CAROUSEL HOOK
// =============================================================================

/**
 * Hook for managing carousel state.
 *
 * @example
 * ```tsx
 * const carousel = useCarousel({
 *   totalSlides: items.length,
 *   slidesToShow: 3,
 *   autoplay: true,
 * });
 *
 * return (
 *   <Carousel ref={carousel.carouselRef}>
 *     {items.map((item, i) => (
 *       <CarouselSlide key={i}>{item}</CarouselSlide>
 *     ))}
 *   </Carousel>
 * );
 * ```
 */
export function useCarousel(options: UseCarouselOptions): UseCarouselReturn {
  const {
    totalSlides,
    initialSlide = 0,
    slidesToShow = 1,
    slidesToScroll = 1,
    loop = false,
    autoplay = false,
    autoplayInterval = 3000,
    onSlideChange,
  } = options;

  const [currentIndex, setCurrentIndex] = useState(initialSlide);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Calculate max index
  const maxIndex = Math.max(0, totalSlides - slidesToShow);

  // Can navigate
  const canPrev = loop || currentIndex > 0;
  const canNext = loop || currentIndex < maxIndex;

  // Navigation handlers
  const goTo = useCallback(
    (index: number) => {
      let newIndex = index;

      if (loop) {
        if (index < 0) {
          newIndex = maxIndex;
        } else if (index > maxIndex) {
          newIndex = 0;
        }
      } else {
        newIndex = Math.max(0, Math.min(index, maxIndex));
      }

      setCurrentIndex(newIndex);
      onSlideChange?.(newIndex);
    },
    [loop, maxIndex, onSlideChange]
  );

  const next = useCallback(() => {
    if (canNext) {
      goTo(currentIndex + slidesToScroll);
    }
  }, [canNext, currentIndex, slidesToScroll, goTo]);

  const prev = useCallback(() => {
    if (canPrev) {
      goTo(currentIndex - slidesToScroll);
    }
  }, [canPrev, currentIndex, slidesToScroll, goTo]);

  // Autoplay handlers
  const pause = useCallback(() => {
    setIsPlaying(false);
    if (autoplayRef.current) {
      clearInterval(autoplayRef.current);
      autoplayRef.current = null;
    }
  }, []);

  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  // Autoplay effect
  useEffect(() => {
    if (isPlaying && totalSlides > slidesToShow) {
      autoplayRef.current = setInterval(() => {
        goTo(currentIndex + slidesToScroll);
      }, autoplayInterval);

      return () => {
        if (autoplayRef.current) {
          clearInterval(autoplayRef.current);
          autoplayRef.current = null;
        }
      };
    }
    return undefined;
  }, [isPlaying, currentIndex, slidesToScroll, autoplayInterval, totalSlides, slidesToShow, goTo]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (autoplayRef.current) {
        clearInterval(autoplayRef.current);
      }
    },
    []
  );

  return {
    currentIndex,
    totalSlides,
    canPrev,
    canNext,
    goTo,
    next,
    prev,
    pause,
    play,
    isPlaying,
    carouselRef,
  };
}
