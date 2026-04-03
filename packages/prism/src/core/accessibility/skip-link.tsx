/**
 * Skip Link Component
 *
 * Provides keyboard users a way to skip navigation and jump to main content.
 *
 * @module @omnitron-dev/prism/core/accessibility/skip-link
 */

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material';

/**
 * Props for SkipLink component.
 */
export interface SkipLinkProps {
  /** Target element ID to skip to */
  href: string;
  /** Link content (typically "Skip to main content") */
  children: ReactNode;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Skip link that is visually hidden until focused.
 * Allows keyboard users to skip navigation and jump to main content.
 *
 * @example
 * ```tsx
 * <SkipLink href="#main-content">Skip to main content</SkipLink>
 * ```
 */
export function SkipLink({ href, children, sx }: SkipLinkProps): ReactNode {
  return (
    <Box
      component="a"
      href={href}
      sx={[
        (theme) => ({
          position: 'absolute',
          top: '-100%',
          left: 0,
          right: 0,
          zIndex: theme.zIndex.tooltip + 1,
          padding: theme.spacing(1, 2),
          backgroundColor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          textAlign: 'center',
          textDecoration: 'none',
          fontWeight: theme.typography.fontWeightMedium,
          fontSize: theme.typography.body2.fontSize,
          // Show on focus
          '&:focus': {
            top: 0,
            outline: `2px solid ${theme.palette.primary.dark}`,
            outlineOffset: 2,
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}
