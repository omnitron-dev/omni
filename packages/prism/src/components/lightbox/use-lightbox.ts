/**
 * useLightbox Hook
 *
 * State management hook for the Lightbox component.
 * Handles open/close, navigation, and zoom state.
 *
 * @module @omnitron-dev/prism/components/lightbox
 */

'use client';

import { useState, useCallback } from 'react';

import type { UseLightboxReturn } from './types.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

// =============================================================================
// USE LIGHTBOX HOOK
// =============================================================================

/**
 * Options for useLightbox hook.
 */
export interface UseLightboxOptions {
  /** Initial open state */
  defaultOpen?: boolean;
  /** Initial slide index */
  defaultIndex?: number;
  /** Total number of slides (for navigation bounds) */
  totalSlides?: number;
  /** Enable infinite loop */
  loop?: boolean;
}

/**
 * Hook for managing lightbox state.
 *
 * @example
 * ```tsx
 * const lightbox = useLightbox({ totalSlides: images.length });
 *
 * return (
 *   <>
 *     {images.map((img, i) => (
 *       <img key={i} src={img.src} onClick={() => lightbox.onOpen(i)} />
 *     ))}
 *     <Lightbox slides={images} {...lightbox.getLightboxProps()} />
 *   </>
 * );
 * ```
 */
export function useLightbox(options: UseLightboxOptions = {}): UseLightboxReturn {
  const { defaultOpen = false, defaultIndex = 0, totalSlides = 0, loop = false } = options;

  const [open, setOpen] = useState(defaultOpen);
  const [index, setIndex] = useState(defaultIndex);
  const [zoomLevel, setZoomLevel] = useState(MIN_ZOOM);

  // Navigation
  const goTo = useCallback(
    (newIndex: number) => {
      if (totalSlides === 0) {
        setIndex(newIndex);
        return;
      }

      if (loop) {
        setIndex((newIndex + totalSlides) % totalSlides);
      } else {
        setIndex(Math.max(0, Math.min(newIndex, totalSlides - 1)));
      }
      // Reset zoom when changing slides
      setZoomLevel(MIN_ZOOM);
    },
    [totalSlides, loop]
  );

  const next = useCallback(() => {
    goTo(index + 1);
  }, [index, goTo]);

  const prev = useCallback(() => {
    goTo(index - 1);
  }, [index, goTo]);

  // Open/Close
  const onOpen = useCallback((slideIndex = 0) => {
    setIndex(slideIndex);
    setZoomLevel(MIN_ZOOM);
    setOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
    setZoomLevel(MIN_ZOOM);
  }, []);

  // Zoom
  const zoomIn = useCallback(() => {
    setZoomLevel((prevZoom) => Math.min(prevZoom + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomLevel((prevZoom) => Math.max(prevZoom - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const zoomReset = useCallback(() => {
    setZoomLevel(MIN_ZOOM);
  }, []);

  // Index change handler for Lightbox
  const onIndexChange = useCallback(
    (newIndex: number) => {
      goTo(newIndex);
    },
    [goTo]
  );

  // Props getter
  const getLightboxProps = useCallback(
    () => ({
      open,
      onClose,
      index,
      onIndexChange,
    }),
    [open, onClose, index, onIndexChange]
  );

  return {
    open,
    index,
    onOpen,
    onClose,
    goTo,
    next,
    prev,
    zoomLevel,
    zoomIn,
    zoomOut,
    zoomReset,
    getLightboxProps,
  };
}
