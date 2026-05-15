'use client';

/**
 * FlagIcon — purely visual country-flag wrapper.
 *
 * Asset-free by design. The consumer supplies the SVG / PNG URL via
 * the `src` prop; Prism stays publishable without bundling 250+ flag
 * images. The wrapper handles the chrome — fixed aspect ratio,
 * border-radius variants (rounded / circle / square), graceful
 * fallback when `src` is missing or fails to load (an outlined
 * neutral globe glyph).
 *
 * Usage:
 *   <FlagIcon src="/assets/countries/ru.svg" alt="Russia" />
 *   <FlagIcon src={getFlagSrc('ru')} shape="circle" size={20} />
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import Box from '@mui/material/Box';
import { styled } from '@mui/material/styles';

export type FlagShape = 'rounded' | 'circle' | 'square';

export interface FlagIconProps {
  /** Flag image URL. When missing, falls back to a neutral globe glyph. */
  src?: string | null;
  /** Accessible label (country name). Falls back to `code` or empty string. */
  alt?: string;
  /** Optional ISO code — surfaced in the `aria-label` when `alt` isn't provided. */
  code?: string | null;
  /** Visual shape. Default `rounded` (4px radius); `circle` clips to a disc. */
  shape?: FlagShape;
  /**
   * Height in pixels. Width is computed at the 4:3 aspect that
   * matches the bundled SVG set; the wrapper stays square in
   * `circle` mode so the disc isn't squashed.
   */
  size?: number;
  /** Additional className. */
  className?: string;
}

export function FlagIcon({
  src,
  alt,
  code,
  shape = 'rounded',
  size = 20,
  className,
}: FlagIconProps): ReactNode {
  const [errored, setErrored] = useState(false);
  // Circle mode forces a 1:1 frame (otherwise the 4:3 SVG becomes an
  // oval). Other shapes keep the natural aspect ratio.
  const width = shape === 'circle' ? size : Math.round((size * 4) / 3);
  const radius = shape === 'circle' ? '50%' : shape === 'square' ? '0' : '3px';
  const accessibleLabel = alt ?? (code ? code.toUpperCase() : '');

  if (!src || errored) {
    return (
      <FlagFallback
        className={className}
        sx={{ width, height: size, borderRadius: radius }}
        aria-label={accessibleLabel || undefined}
      >
        {/* Inline globe glyph — cheaper than a font / emoji,
            renders identically across platforms. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="60%" height="60%">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
      </FlagFallback>
    );
  }

  return (
    <FlagFrame
      className={className}
      sx={{ width, height: size, borderRadius: radius }}
    >
      <FlagImg
        src={src}
        alt={accessibleLabel}
        loading="lazy"
        onError={() => setErrored(true)}
      />
    </FlagFrame>
  );
}

const FlagFrame = styled('span')(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  flexShrink: 0,
  // Neutral 1px outline so flags with white edges (e.g. JP, CY) stay
  // legible on light surfaces. Uses an `inset` shadow rather than a
  // border to avoid disturbing the flag's intrinsic size.
  boxShadow: `inset 0 0 0 1px ${theme.palette.divider}`,
}));

const FlagImg = styled('img')({
  width: '100%',
  height: '100%',
  display: 'block',
  objectFit: 'cover',
  // Sharpen the rasterised SVG on Hi-DPI; no effect on vector but
  // costs nothing. Pixelated would be wrong for a flag, so the
  // browser default (auto smoothing) wins.
});

const FlagFallback = styled('span')(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  color: theme.palette.text.disabled,
  backgroundColor:
    theme.palette.mode === 'dark'
      ? theme.palette.action.hover
      : theme.palette.action.selected,
  boxShadow: `inset 0 0 0 1px ${theme.palette.divider}`,
}));
