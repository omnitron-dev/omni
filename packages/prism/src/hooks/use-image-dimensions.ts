'use client';

/**
 * useImageDimensions Hook
 *
 * Detects the natural dimensions of an image from a URL.
 *
 * @module @omnitron-dev/prism/hooks/use-image-dimensions
 */

import { useCallback, useEffect, useState } from 'react';

/**
 * Image dimensions result.
 */
export interface ImageDimensions {
  /** Natural width of the image in pixels */
  width: number;
  /** Natural height of the image in pixels */
  height: number;
  /** Aspect ratio (width / height) */
  aspectRatio: number;
}

/**
 * Return type for useImageDimensions hook.
 */
export interface UseImageDimensionsReturn {
  /** Image dimensions (null if not loaded or error) */
  dimensions: ImageDimensions | null;
  /** Loading state */
  loading: boolean;
  /** Error if image failed to load */
  error: Error | null;
  /** Manually retry loading the image */
  retry: () => void;
}

/**
 * Options for useImageDimensions hook.
 */
export interface UseImageDimensionsOptions {
  /** Cross-origin setting for image loading */
  crossOrigin?: 'anonymous' | 'use-credentials';
  /** Timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Whether to start loading immediately (default: true) */
  immediate?: boolean;
}

/**
 * useImageDimensions - Detects image dimensions from a URL.
 *
 * Loads an image in memory to get its natural width and height.
 *
 * @example
 * ```tsx
 * function ImagePreview({ src }: { src: string }) {
 *   const { dimensions, loading, error } = useImageDimensions(src);
 *
 *   if (loading) return <CircularProgress />;
 *   if (error) return <Alert severity="error">Failed to load image</Alert>;
 *   if (!dimensions) return null;
 *
 *   return (
 *     <Box>
 *       <Typography>
 *         {dimensions.width} x {dimensions.height}
 *       </Typography>
 *       <Typography>
 *         Aspect ratio: {dimensions.aspectRatio.toFixed(2)}
 *       </Typography>
 *       <img
 *         src={src}
 *         alt="preview"
 *         style={{ maxWidth: '100%', aspectRatio: dimensions.aspectRatio }}
 *       />
 *     </Box>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With manual control
 * function LazyImage({ src }: { src: string }) {
 *   const { dimensions, loading, retry } = useImageDimensions(src, {
 *     immediate: false,
 *   });
 *
 *   return (
 *     <Box>
 *       {!dimensions && !loading && (
 *         <Button onClick={retry}>Load dimensions</Button>
 *       )}
 *       {loading && <CircularProgress />}
 *       {dimensions && (
 *         <Typography>{dimensions.width} x {dimensions.height}</Typography>
 *       )}
 *     </Box>
 *   );
 * }
 * ```
 *
 * @param src - Image URL to load
 * @param options - Hook options
 * @returns Dimensions, loading state, error, and retry function
 */
export function useImageDimensions(
  src: string | null | undefined,
  options: UseImageDimensionsOptions = {}
): UseImageDimensionsReturn {
  const { crossOrigin, timeout = 10000, immediate = true } = options;

  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const loadImage = useCallback(() => {
    if (!src) {
      setDimensions(null);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    setError(null);

    const img = new Image();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const cleanup = () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      if (cancelled) return;
      cleanup();

      const { naturalWidth: width, naturalHeight: height } = img;
      setDimensions({
        width,
        height,
        aspectRatio: height > 0 ? width / height : 1,
      });
      setLoading(false);
      setError(null);
    };

    img.onerror = () => {
      if (cancelled) return;
      cleanup();

      setDimensions(null);
      setLoading(false);
      setError(new Error(`Failed to load image: ${src}`));
    };

    // Set timeout
    timeoutId = setTimeout(() => {
      if (cancelled) return;
      cleanup();

      setDimensions(null);
      setLoading(false);
      setError(new Error(`Image load timeout: ${src}`));
    }, timeout);

    // Set cross-origin if specified
    if (crossOrigin) {
      img.crossOrigin = crossOrigin;
    }

    // Start loading
    img.src = src;

    // Return cleanup function for effect
    return cleanup;
  }, [src, crossOrigin, timeout]);

  // Auto-load when src changes (if immediate)
  useEffect(() => {
    if (!immediate) return undefined;
    return loadImage();
  }, [loadImage, immediate]);

  const retry = useCallback(() => {
    loadImage();
  }, [loadImage]);

  return {
    dimensions,
    loading,
    error,
    retry,
  };
}

/**
 * Get dimensions of multiple images.
 *
 * @example
 * ```tsx
 * function Gallery({ urls }: { urls: string[] }) {
 *   const results = useMultipleImageDimensions(urls);
 *
 *   return (
 *     <Grid container>
 *       {results.map((result, i) => (
 *         <Grid item key={urls[i]}>
 *           {result.loading && <Skeleton />}
 *           {result.dimensions && (
 *             <img
 *               src={urls[i]}
 *               style={{ aspectRatio: result.dimensions.aspectRatio }}
 *             />
 *           )}
 *         </Grid>
 *       ))}
 *     </Grid>
 *   );
 * }
 * ```
 */
export function useMultipleImageDimensions(
  urls: (string | null | undefined)[],
  options: UseImageDimensionsOptions = {}
): UseImageDimensionsReturn[] {
  const { crossOrigin, timeout = 10000, immediate = true } = options;

  const [results, setResults] = useState<
    Map<string, { dimensions: ImageDimensions | null; loading: boolean; error: Error | null }>
  >(new Map());

  useEffect(() => {
    if (!immediate) return undefined;

    const cleanups: (() => void)[] = [];

    urls.forEach((url) => {
      if (!url) return;

      setResults((prev) => {
        const next = new Map(prev);
        next.set(url, { dimensions: null, loading: true, error: null });
        return next;
      });

      const img = new Image();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let cancelled = false;

      const cleanup = () => {
        cancelled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        img.onload = null;
        img.onerror = null;
      };

      cleanups.push(cleanup);

      img.onload = () => {
        if (cancelled) return;
        cleanup();

        const { naturalWidth: width, naturalHeight: height } = img;
        setResults((prev) => {
          const next = new Map(prev);
          next.set(url, {
            dimensions: { width, height, aspectRatio: height > 0 ? width / height : 1 },
            loading: false,
            error: null,
          });
          return next;
        });
      };

      img.onerror = () => {
        if (cancelled) return;
        cleanup();

        setResults((prev) => {
          const next = new Map(prev);
          next.set(url, {
            dimensions: null,
            loading: false,
            error: new Error(`Failed to load: ${url}`),
          });
          return next;
        });
      };

      timeoutId = setTimeout(() => {
        if (cancelled) return;
        cleanup();

        setResults((prev) => {
          const next = new Map(prev);
          next.set(url, {
            dimensions: null,
            loading: false,
            error: new Error(`Timeout: ${url}`),
          });
          return next;
        });
      }, timeout);

      if (crossOrigin) {
        img.crossOrigin = crossOrigin;
      }

      img.src = url;
    });

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [urls.join(','), crossOrigin, timeout, immediate]);

  return urls.map((url) => {
    if (!url) {
      return {
        dimensions: null,
        loading: false,
        error: null,
        retry: () => {},
      };
    }

    const result = results.get(url);
    return {
      dimensions: result?.dimensions ?? null,
      loading: result?.loading ?? false,
      error: result?.error ?? null,
      retry: () => {
        // Trigger reload by updating state
        setResults((prev) => {
          const next = new Map(prev);
          next.delete(url);
          return next;
        });
      },
    };
  });
}
