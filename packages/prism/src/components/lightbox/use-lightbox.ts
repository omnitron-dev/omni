/**
 * useLightbox Hook
 *
 * State management hook for the Lightbox component.
 * Handles open/close and navigation. Zoom belongs to `<Lightbox>` itself —
 * see `UseLightboxReturn.getLightboxProps` for why it is not here.
 *
 * @module @omnitron-dev/prism/components/lightbox
 */

'use client';

import { useState, useCallback } from 'react';

import type { UseLightboxReturn } from './types.js';

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

  // Navigation
  const goTo = useCallback(
    (newIndex: number) => {
      // `totalSlides` is optional and defaults to 0, which is how the hook is
      // constructed when a caller lets the component do its own navigation —
      // `useLightbox()` with no arguments, as the portal does. Passing the
      // requested index straight through in that state let `next()` walk the
      // index upward without bound, past the end of a slide list the hook was
      // never told about. With no slides there is no index to be at; 0 is the
      // one that cannot be out of range.
      if (totalSlides === 0) {
        setIndex(0);
        return;
      }

      if (loop) {
        setIndex((newIndex + totalSlides) % totalSlides);
      } else {
        setIndex(Math.max(0, Math.min(newIndex, totalSlides - 1)));
      }
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
    setOpen(true);
  }, []);

  const onClose = useCallback(() => {
    setOpen(false);
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
    getLightboxProps,
  };
}
