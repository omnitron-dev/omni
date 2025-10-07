/**
 * Image - Advanced image component with lazy loading and fallback support
 *
 * Features:
 * - Lazy loading with Intersection Observer
 * - Placeholder/skeleton while loading
 * - Error fallback support
 * - Responsive images with srcset
 * - Object-fit control
 * - Loading states (loading, loaded, error)
 * - onLoad and onError callbacks
 * - ARIA support for accessibility
 */

import { defineComponent, onCleanup } from '../core/component/index.js';
import type { WritableSignal } from '../core/reactivity/types.js';
import { signal } from '../core/reactivity/index.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type ImageLoadingStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface ImageProps {
  /** Image source URL */
  src: string;
  /** Alternative text */
  alt: string;
  /** Srcset for responsive images */
  srcset?: string;
  /** Sizes attribute */
  sizes?: string;
  /** Whether to lazy load */
  lazy?: boolean;
  /** Object fit */
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  /** Placeholder content while loading */
  placeholder?: any;
  /** Fallback content on error */
  fallback?: any;
  /** Called when image loads */
  onLoad?: (event: Event) => void;
  /** Called when image fails to load */
  onError?: (event: Event) => void;
  /** Additional props */
  [key: string]: any;
}

// ============================================================================
// Image
// ============================================================================

export const Image = defineComponent<ImageProps>((props) => {
  const lazy = props.lazy ?? true;
  const fit = props.fit ?? 'cover';

  const imgRef: { current: HTMLImageElement | null } = { current: null };
  const status: WritableSignal<ImageLoadingStatus> = signal<ImageLoadingStatus>('idle');

  let observer: IntersectionObserver | null = null;

  const handleLoad = (e: Event) => {
    status.set('loaded');
    props.onLoad?.(e);
  };

  const handleError = (e: Event) => {
    status.set('error');
    props.onError?.(e);
  };

  const startLoading = () => {
    if (status() === 'idle') {
      status.set('loading');
    }
  };

  // Setup lazy loading
  if (lazy && typeof IntersectionObserver !== 'undefined') {
    const setupObserver = () => {
      const img = imgRef.current;
      if (!img) return;

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              startLoading();
              if (observer) {
                observer.disconnect();
              }
            }
          });
        },
        { rootMargin: '50px' },
      );

      observer.observe(img);
    };

    // Setup on next tick
    setTimeout(setupObserver, 0);
  } else {
    // Not lazy, start loading immediately
    startLoading();
  }

  onCleanup(() => {
    if (observer) {
      observer.disconnect();
    }
  });

  return () => {
    const {
      src,
      alt,
      srcset,
      sizes,
      placeholder,
      fallback,
      onLoad: _onLoad,
      onError: _onError,
      lazy: _lazy,
      fit: _fit,
      ...rest
    } = props;

    const currentStatus = status();

    // Show placeholder while loading
    if (currentStatus === 'loading' && placeholder) {
      return jsx('div', {
        'data-image-placeholder': '',
        role: 'img',
        'aria-label': alt,
        ...rest,
        children: placeholder,
      });
    }

    // Show fallback on error
    if (currentStatus === 'error' && fallback) {
      return jsx('div', {
        'data-image-fallback': '',
        role: 'img',
        'aria-label': alt,
        ...rest,
        children: fallback,
      });
    }

    // Render actual image
    return jsx('img', {
      ref: imgRef,
      'data-image': '',
      'data-status': currentStatus,
      src: currentStatus === 'loading' || currentStatus === 'loaded' ? src : undefined,
      srcset: currentStatus === 'loading' || currentStatus === 'loaded' ? srcset : undefined,
      sizes,
      alt,
      loading: lazy ? 'lazy' : 'eager',
      style: {
        objectFit: fit,
      },
      onLoad: handleLoad,
      onError: handleError,
      ...rest,
    });
  };
});
