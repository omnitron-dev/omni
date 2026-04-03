'use client';

/**
 * Image Component
 *
 * Enhanced image component with lazy loading, aspect ratio, and fallback support.
 *
 * @module @omnitron/prism/components/image
 */

import type { ReactNode, ImgHTMLAttributes } from 'react';
import { useState, useCallback, forwardRef } from 'react';
import Box from '@mui/material/Box';
import { styled, alpha } from '@mui/material/styles';
import type { SxProps, Theme, Breakpoint } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type AspectRatio = '2/3' | '3/2' | '4/3' | '3/4' | '16/9' | '9/16' | '21/9' | '1/1' | `${number}/${number}`;

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError'> {
  /** Image source URL */
  src: string;
  /** Alt text */
  alt: string;
  /** Aspect ratio (auto-sizes based on width) */
  ratio?: AspectRatio | Partial<Record<Breakpoint, AspectRatio>>;
  /** Fallback content on error */
  fallback?: ReactNode;
  /** Fallback image URL */
  fallbackSrc?: string;
  /** Disable lazy loading */
  disableLazy?: boolean;
  /** Object fit style */
  objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** Show loading placeholder */
  placeholder?: boolean;
  /** Overlay content */
  overlay?: ReactNode;
  /** Additional styles */
  sx?: SxProps<Theme>;
  /** Image styles */
  imgSx?: SxProps<Theme>;
  /** Called when image loads */
  onLoad?: () => void;
  /** Called when image fails to load */
  onError?: () => void;
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

interface ImageRootProps {
  ownerState: {
    ratio?: AspectRatio | Partial<Record<Breakpoint, AspectRatio>>;
    hasError: boolean;
  };
}

const ImageRoot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<ImageRootProps>(({ theme, ownerState }) => {
  const { ratio, hasError } = ownerState;

  const getRatioStyles = () => {
    if (!ratio) return {};

    if (typeof ratio === 'string') {
      return {
        width: '100%',
        aspectRatio: ratio,
      };
    }

    // Responsive ratio
    const breakpointStyles: Record<string, string | Record<string, string>> = { width: '100%' };
    for (const [bp, r] of Object.entries(ratio)) {
      if (bp === 'xs') {
        breakpointStyles.aspectRatio = r;
      } else {
        breakpointStyles[theme.breakpoints.up(bp as Breakpoint)] = {
          aspectRatio: r,
        };
      }
    }
    return breakpointStyles;
  };

  return {
    position: 'relative',
    display: 'block',
    overflow: 'hidden',
    borderRadius: 'inherit',
    ...getRatioStyles(),
    ...(hasError && {
      backgroundColor: alpha(theme.palette.grey[500], 0.08),
    }),
  };
});

const StyledImg = styled('img')(() => ({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
}));

const PlaceholderBox = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: alpha(theme.palette.grey[500], 0.08),
  '&::after': {
    content: '""',
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '3px solid',
    borderColor: alpha(theme.palette.grey[500], 0.16),
    borderTopColor: theme.palette.primary.main,
    animation: 'spin 1s linear infinite',
    '@keyframes spin': {
      from: { transform: 'rotate(0deg)' },
      to: { transform: 'rotate(360deg)' },
    },
  },
}));

const OverlayBox = styled(Box)(() => ({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}));

const FallbackBox = styled(Box)(({ theme }) => ({
  width: '100%',
  height: '100%',
  minHeight: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.text.disabled,
}));

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Image - Enhanced image component with lazy loading and fallback.
 *
 * @example
 * ```tsx
 * <Image
 *   src="/avatar.jpg"
 *   alt="User avatar"
 *   ratio="1/1"
 *   sx={{ width: 100, borderRadius: 1 }}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With aspect ratio
 * <Image
 *   src="/banner.jpg"
 *   alt="Banner"
 *   ratio="16/9"
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With fallback
 * <Image
 *   src="/product.jpg"
 *   alt="Product"
 *   fallback={<ProductPlaceholder />}
 * />
 * ```
 */
export const Image = forwardRef<HTMLDivElement, ImageProps>(function Image(
  {
    src,
    alt,
    ratio,
    fallback,
    fallbackSrc,
    disableLazy = false,
    objectFit = 'cover',
    placeholder = true,
    overlay,
    sx,
    imgSx,
    onLoad,
    onError,
    ...imgProps
  },
  ref
) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    if (fallbackSrc && currentSrc !== fallbackSrc) {
      setCurrentSrc(fallbackSrc);
    } else {
      setHasError(true);
    }
    onError?.();
  }, [fallbackSrc, currentSrc, onError]);

  const ownerState = {
    ratio,
    hasError,
  };

  // Render fallback content on error
  if (hasError && fallback) {
    return (
      <ImageRoot ref={ref} ownerState={ownerState} sx={sx}>
        <FallbackBox>{fallback}</FallbackBox>
      </ImageRoot>
    );
  }

  return (
    <ImageRoot ref={ref} ownerState={ownerState} sx={sx}>
      {/* Loading placeholder */}
      {placeholder && !isLoaded && !hasError && <PlaceholderBox />}

      {/* Main image */}
      <StyledImg
        src={currentSrc}
        alt={alt}
        loading={disableLazy ? 'eager' : 'lazy'}
        onLoad={handleLoad}
        onError={handleError}
        sx={[
          {
            objectFit,
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 300ms ease-in-out',
          },
          ...(Array.isArray(imgSx) ? imgSx : [imgSx]),
        ]}
        {...imgProps}
      />

      {/* Overlay */}
      {overlay && <OverlayBox>{overlay}</OverlayBox>}
    </ImageRoot>
  );
});

// =============================================================================
// DEFAULT FALLBACK
// =============================================================================

function DefaultImageIcon() {
  return (
    <Box component="svg" viewBox="0 0 24 24" sx={{ width: 48, height: 48, opacity: 0.5 }}>
      <path
        fill="currentColor"
        d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"
      />
    </Box>
  );
}

/**
 * ImageWithDefault - Image with default fallback icon.
 */
export function ImageWithDefault(props: ImageProps): ReactNode {
  return <Image fallback={<DefaultImageIcon />} {...props} />;
}
