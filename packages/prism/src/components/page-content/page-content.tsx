'use client';

/**
 * PageContent — Unified page layout primitives
 *
 * Provides consistent spacing across all pages:
 * - PageContent: vertical stack with standardized gap
 * - PageContent.CardGrid: responsive grid for cards with equal height
 *
 * @example
 * <PageContent>
 *   <Breadcrumbs ... />
 *   <PageContent.CardGrid columns={2}>
 *     <Card>...</Card>
 *     <Card>...</Card>
 *   </PageContent.CardGrid>
 * </PageContent>
 *
 * @module @omnitron/prism/components/page-content
 */

import type { ReactNode } from 'react';
import { forwardRef, Children } from 'react';
import Stack from '@mui/material/Stack';
import Grid from '@mui/material/Grid';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default spacing between top-level page sections (theme spacing units) */
const PAGE_GAP = 3;

/** Default spacing between grid items (theme spacing units) */
const GRID_GAP = 3;

// =============================================================================
// PageContent
// =============================================================================

export interface PageContentProps {
  children: ReactNode;
  /** Override gap between sections. Default: 3 (24px). */
  gap?: number;
  /** Stretch to fill available height (for centered empty states). */
  fill?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Page-level vertical layout with consistent spacing.
 *
 * Wraps children in a `Stack` with standardized gap.
 * Use `fill` to stretch for empty-state centering.
 */
export const PageContent = forwardRef<HTMLDivElement, PageContentProps>(
  ({ children, gap = PAGE_GAP, fill, sx, ...rest }, ref) => (
    <Stack
      ref={ref}
      spacing={gap}
      sx={{ ...(fill && { flex: 1 }), ...sx as any }}
      {...rest}
    >
      {children}
    </Stack>
  ),
);

PageContent.displayName = 'PageContent';

// =============================================================================
// CardGrid
// =============================================================================

export interface CardGridProps {
  children: ReactNode;
  /** Number of columns at `md` breakpoint. Default: 2. */
  columns?: 1 | 2 | 3 | 4;
  /** Override gap between cards. Default: 3 (24px). */
  gap?: number;
  sx?: SxProps<Theme>;
}

const COLUMN_SIZE: Record<number, { xs: number; sm?: number; md: number }> = {
  1: { xs: 12, md: 12 },
  2: { xs: 12, md: 6 },
  3: { xs: 12, sm: 6, md: 4 },
  4: { xs: 12, sm: 6, md: 3 },
};

/**
 * Responsive card grid with equal-height items.
 *
 * Each direct child is wrapped in a Grid item sized by `columns`.
 * Cards should use `height: '100%'` or be wrapped in a full-height container.
 */
export function CardGrid({ children, columns = 2, gap = GRID_GAP, sx }: CardGridProps) {
  const size = COLUMN_SIZE[columns] ?? COLUMN_SIZE[2];

  return (
    <Grid container spacing={gap} sx={sx}>
      {Children.map(children, (child) =>
        child != null ? (
          <Grid size={size} sx={{ display: 'flex' }}>
            {child}
          </Grid>
        ) : null,
      )}
    </Grid>
  );
}
