'use client';

/**
 * NavCardGrid
 *
 * Canonical container for `<NavCard>` rows on admin/dashboard
 * overview pages. Replaces the ad-hoc `<Grid container spacing={3}>`
 * + `<Grid size={{md:3}}>` pattern, which has two failure modes
 * when the tile count is uneven against the column count:
 *
 *   1. The empty trailing cells visually extend the row above's
 *      column borders into nothing — reading as orphan vertical
 *      "sticks" between cards on dark themes.
 *   2. Cards across rows can end up with different heights when
 *      their descriptions wrap differently.
 *
 * NavCardGrid solves both with a CSS Grid:
 *
 *   - `auto-fit` (not `auto-fill`) collapses empty trailing tracks,
 *     so the last row's cards expand to fill the width and their
 *     right edges no longer align with the row above.
 *   - `minmax(<min>, 1fr)` caps the column count on wide viewports
 *     (otherwise 5+ tiny tiles can pack a row).
 *   - `grid-auto-rows: 1fr` guarantees equal card height across
 *     rows regardless of per-card content length.
 *
 * Use as a drop-in replacement for the Grid wrapper around NavCards
 * in admin dashboards. The contained `<NavCard>` should typically
 * use `orientation="vertical"` so the tiles work at narrow widths.
 *
 * @example
 * ```tsx
 * <NavCardGrid>
 *   <NavCard title="Users" icon={<UsersIcon />} to="/admin/users" />
 *   <NavCard title="Shops" icon={<ShopsIcon />} to="/admin/shops" />
 *   ...
 * </NavCardGrid>
 * ```
 *
 * @module @omnitron-dev/prism/components/nav-card
 */

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

export interface NavCardGridProps {
  children: ReactNode;
  /**
   * Minimum tile width before wrap. Effectively caps the column
   * count via `minmax`. Default 260px which gives 4 columns on a
   * typical 1200px content area, 3 on tablet, 2 on small laptops,
   * and 1 on mobile.
   */
  minTileWidth?: number;
  /** Gap between tiles in spacing units. Default 3 (24px). */
  gap?: number;
  /** Custom sx overrides. */
  sx?: SxProps<Theme>;
}

export function NavCardGrid({
  children,
  minTileWidth = 260,
  gap = 3,
  sx,
}: NavCardGridProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap,
        // Always 1 column on xs to avoid horizontal overflow on tiny
        // viewports; `auto-fit` from sm upward.
        gridTemplateColumns: {
          xs: '1fr',
          sm: `repeat(auto-fit, minmax(${minTileWidth}px, 1fr))`,
        },
        gridAutoRows: '1fr',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}
