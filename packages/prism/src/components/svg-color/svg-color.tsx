'use client';

/**
 * SvgColor Component
 *
 * Colorable SVG icon component using CSS mask.
 *
 * @module @omnitron/prism/components/svg-color
 */

import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import { styled } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface SvgColorProps {
  /** SVG file URL */
  src: string;
  /** Color (uses currentColor by default, inheriting from parent) */
  color?: string;
  /** Width and height */
  size?: number | string;
  /** Width */
  width?: number | string;
  /** Height */
  height?: number | string;
  /** Additional class name */
  className?: string;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// STYLED COMPONENT
// =============================================================================

const SvgRoot = styled('span')(() => ({
  flexShrink: 0,
  display: 'inline-flex',
  backgroundColor: 'currentColor',
}));

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * SvgColor - Colorable SVG component.
 *
 * This component uses CSS mask to allow SVG icons to inherit text color.
 * The SVG file is loaded via URL and can be colored using the color prop
 * or by inheriting from parent's color/text color.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <SvgColor src="/icons/check.svg" />
 * ```
 *
 * @example
 * ```tsx
 * // With custom color
 * <SvgColor
 *   src="/icons/star.svg"
 *   color="primary.main"
 *   size={32}
 * />
 * ```
 *
 * @example
 * ```tsx
 * // Inherit color from parent
 * <Box color="error.main">
 *   <SvgColor src="/icons/alert.svg" />
 *   Error message
 * </Box>
 * ```
 */
export const SvgColor = forwardRef<HTMLSpanElement, SvgColorProps>(function SvgColor(
  { src, color, size = 24, width, height, className, sx },
  ref
) {
  const computedWidth = width ?? size;
  const computedHeight = height ?? size;

  return (
    <SvgRoot
      ref={ref}
      className={className}
      sx={[
        {
          width: computedWidth,
          height: computedHeight,
          mask: `url(${src}) no-repeat center / contain`,
          WebkitMask: `url(${src}) no-repeat center / contain`,
          ...(color && { color }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
});

// =============================================================================
// ICON SET COMPONENT
// =============================================================================

export interface IconProps extends Omit<SvgColorProps, 'src'> {
  /** Icon name (without extension) */
  name: string;
  /** Base path for icons */
  basePath?: string;
}

/**
 * Creates an Icon component factory with a custom base path.
 *
 * @example
 * ```tsx
 * // Create icon component
 * const Icon = createIconComponent('/assets/icons');
 *
 * // Use it
 * <Icon name="home" size={24} />
 * ```
 */
export function createIconComponent(basePath: string) {
  function Icon({ name, ...props }: IconProps): ReactNode {
    return <SvgColor src={`${basePath}/${name}.svg`} {...props} />;
  }
  return Icon;
}
