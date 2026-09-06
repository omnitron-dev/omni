'use client';

/**
 * useCarousel Hook
 *
 * Carousel state — index, bounds, autoplay — for a slider you render
 * yourself.
 *
 * It does NOT drive `<Carousel>`, and the two are not connected in any way.
 * That component keeps its own copy of this state and exposes no controlled
 * props: `initialSlide` seeds it and `onSlideChange` observes it, so nothing
 * a caller does with this hook can move it. The two implementations are
 * parallel, not paired.
 *
 * Said this plainly because the header used to read "state management hook
 * for the Carousel component" and the example below wired the two together,
 * neither of which was true.
 *
 * @module components/carousel
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
 * The previous example here did not compile and could not have worked:
 * it rendered `<CarouselSlide>`, which this package exports as a TYPE and
 * not as a component, and passed `ref={carousel.carouselRef}` to
 * `<Carousel>`, which is a plain function component that never reads a ref.
 * Between those two and the pairing that does not exist, three claims in
 * eight lines.
 *
 * @example
 * ```tsx
 * // Your own markup — that is the point of the hook.
 * const carousel = useCarousel({ totalSlides: items.length, autoplay: true });
 *
 * return (
 *   <div onMouseEnter={carousel.pause} onMouseLeave={carousel.play}>
 *     {items.slice(carousel.currentIndex, carousel.currentIndex + 3).map(render)}
 *     <button onClick={carousel.prev} disabled={!carousel.canPrev}>Back</button>
 *     <button onClick={carousel.next} disabled={!carousel.canNext}>Next</button>
 *   </div>
 * );
 * ```
 *
 * For a ready-made slider use `<Carousel>` and leave this hook alone; it
 * cannot control that component.
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

  /**
   * The current index, readable from inside the autoplay timer.
   *
   * The timer used to close over `currentIndex` and list it as an effect
   * dependency, so it advanced one slide per RE-ARM rather than per tick.
   * That is invisible while every tick is followed by a render — which is
   * the normal case — and wrong the moment two callbacks land before one:
   * a throttled background tab, a long task, a test advancing a fake clock.
   * Measured: ten 100ms ticks over three slides moved the carousel once.
   *
   * Reading the ref also takes `currentIndex` out of the effect's
   * dependencies, so the interval is no longer torn down and rebuilt on
   * every slide — which had been measuring each gap from the render rather
   * than from the previous tick.
   *
   * Written in `goTo` rather than during render, because a render is exactly
   * what a burst does not give you.
   */
  const currentIndexRef = useRef(currentIndex);

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

      // Only when it moved. `onSlideChange` fired on every call, including
      // the ones clamping back to where the carousel already was — so a
      // strip parked at its last slide with autoplay on reported a slide
      // change every interval, forever, with the same index.
      if (newIndex === currentIndexRef.current) return;

      currentIndexRef.current = newIndex;
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
        goTo(currentIndexRef.current + slidesToScroll);
      }, autoplayInterval);

      return () => {
        if (autoplayRef.current) {
          clearInterval(autoplayRef.current);
          autoplayRef.current = null;
        }
      };
    }
    return undefined;
  }, [isPlaying, slidesToScroll, autoplayInterval, totalSlides, slidesToShow, goTo]);

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
