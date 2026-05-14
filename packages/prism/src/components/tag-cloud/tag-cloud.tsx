'use client';

/**
 * Tag Cloud — visualises a list of tags as either a sized chip cloud
 * (font-size proportional to popularity) or a vertical list with
 * count + description.
 *
 * Generic over `T extends TagCloudItem` so callers pass their domain
 * tag DTOs directly without mapping. Renders no domain assumptions;
 * navigation is delegated via `onTagClick`, which is the consumer's
 * job (react-router, next/link, etc.).
 *
 * Accessibility:
 *  - List variant: each item is a button (MUI ListItemButton) with
 *    aria-label that spells out the popularity rather than relying
 *    on the visible count alone ("4 posts" not just "4").
 *  - Cloud variant: chips carry an aria-label that names both the
 *    tag and the relative weight, so screen readers don't see only
 *    a font-size signal.
 *  - Optional `trending` flag highlights a tag visually AND
 *    semantically (aria-label suffix).
 *
 * @module @omnitron-dev/prism/components/tag-cloud
 */

import type { ReactNode } from 'react';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

export interface TagCloudItem {
  id: string;
  name: string;
  slug: string;
  postCount: number;
  description?: string | null;
  /** Optional badge — drives the trending highlight. */
  trending?: boolean;
  /** Optional moderation status — 'featured' adds a subtle accent. */
  status?: string;
}

export interface TagCloudProps<T extends TagCloudItem = TagCloudItem> {
  tags: T[];
  variant?: 'cloud' | 'list';
  /** Called on activation. The consumer routes to the tag page. */
  onTagClick?: (tag: T) => void;
  /** Truncate to first N items. */
  maxItems?: number;
  /**
   * Render the right-hand stat of a list-variant row. Defaults to
   * the formatted postCount; override for custom signals
   * (e.g. follower count, freshness).
   */
  renderStat?: (tag: T) => ReactNode;
  /**
   * Optional adornment shown after the tag name on cloud variant.
   * Used to slot in a 🔥 / ⭐ icon component without bloating this
   * file with icon assets.
   */
  renderAdornment?: (tag: T) => ReactNode;
  sx?: SxProps<Theme>;
}

/** Map a postCount to a font-size multiplier (0.75rem – 1.5rem). */
function computeSize(count: number, min: number, max: number): number {
  if (max === min) return 1;
  const t = (count - min) / (max - min);
  return 0.75 + t * 0.75;
}

function formatShort(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

export function TagCloud<T extends TagCloudItem = TagCloudItem>({
  tags,
  variant = 'cloud',
  onTagClick,
  maxItems,
  renderStat,
  renderAdornment,
  sx,
}: TagCloudProps<T>): ReactNode {
  const theme = useTheme();
  const visible = maxItems ? tags.slice(0, maxItems) : tags;

  // --- List variant -----------------------------------------------------
  if (variant === 'list') {
    return (
      <List disablePadding sx={sx}>
        {visible.map((tag) => (
          <ListItemButton
            key={tag.id}
            onClick={onTagClick ? () => onTagClick(tag) : undefined}
            aria-label={`Tag ${tag.name}, ${tag.postCount} posts${tag.trending ? ', trending' : ''}`}
            sx={{
              borderRadius: 1,
              px: 1.5,
              py: 0.75,
              '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
            }}
          >
            <ListItemText
              primary={
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                  <span>{`#${tag.name}`}</span>
                  {tag.trending && (
                    <Box
                      component="span"
                      sx={{
                        ml: 0.5,
                        px: 0.75,
                        py: 0.125,
                        fontSize: 10,
                        lineHeight: 1.4,
                        fontWeight: 700,
                        borderRadius: 0.75,
                        color: theme.palette.warning.contrastText,
                        bgcolor: theme.palette.warning.main,
                      }}
                    >
                      TRENDING
                    </Box>
                  )}
                  {renderAdornment?.(tag)}
                </Box>
              }
              secondary={tag.description}
              slotProps={{
                primary: { variant: 'body2', sx: { fontWeight: 500 } },

                secondary: {
                  variant: 'caption',
                  noWrap: true,
                  sx: { mt: 0.25 },
                }
              }} />
            <Typography
              variant="caption"
              sx={{
                color: "text.disabled",
                ml: 1,
                flexShrink: 0
              }}>
              {renderStat ? renderStat(tag) : formatShort(tag.postCount)}
            </Typography>
          </ListItemButton>
        ))}
      </List>
    );
  }

  // --- Cloud variant ---------------------------------------------------
  const counts = visible.map((t) => t.postCount);
  const min = counts.length > 0 ? Math.min(...counts) : 0;
  const max = counts.length > 0 ? Math.max(...counts) : 0;

  return (
    <Stack
      direction="row"
      useFlexGap
      sx={[{
        flexWrap: "wrap",
        gap: 1,
        alignItems: "center"
      }, ...(Array.isArray(sx) ? sx : [sx])]}>
      {visible.map((tag) => {
        const size = computeSize(tag.postCount, min, max);
        const isFeatured = tag.status === 'featured';
        return (
          <Chip
            key={tag.id}
            label={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                <span>{`#${tag.name}`}</span>
                {renderAdornment?.(tag)}
              </Box>
            }
            variant={tag.trending || isFeatured ? 'filled' : 'outlined'}
            color={tag.trending ? 'warning' : isFeatured ? 'primary' : 'default'}
            onClick={onTagClick ? () => onTagClick(tag) : undefined}
            aria-label={`Tag ${tag.name}, ${tag.postCount} posts${tag.trending ? ', trending' : ''}${isFeatured ? ', featured' : ''}`}
            sx={{
              height: 'auto',
              fontSize: `${size}rem`,
              fontWeight: 500,
              borderRadius: 1.5,
              cursor: onTagClick ? 'pointer' : 'default',
              transition: 'all 0.15s',
              '& .MuiChip-label': { px: 1.25, py: 0.5 },
              '&:hover': onTagClick
                ? {
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    borderColor: 'primary.main',
                    color: 'primary.main',
                  }
                : undefined,
            }}
          />
        );
      })}
    </Stack>
  );
}
