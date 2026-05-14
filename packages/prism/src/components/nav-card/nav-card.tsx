'use client';

/**
 * Nav Card
 *
 * Horizontal navigation tile used on admin/dashboard overview pages:
 * colored icon on the left, title + description in the middle, and a
 * trailing chevron on the right. Renders as a router link when `to`
 * is supplied, otherwise as a button-like Card with `onClick`.
 *
 * Equal-height rows are guaranteed by `height: 100%` — pair the card
 * with a `<Grid container>` whose items share the same column span.
 *
 * @module @omnitron-dev/prism/components/nav-card
 */

import type { ElementType, ReactNode } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SxProps, Theme } from '@mui/material/styles';

export interface NavCardProps {
  /** Card title (rendered as subtitle1, weight 600). */
  title: ReactNode;
  /** Secondary line below the title. */
  description?: ReactNode;
  /** Icon element rendered inside a colored square on the left. */
  icon?: ReactNode;
  /**
   * Palette key for the icon background (e.g. `'primary'`, `'error'`,
   * `'warning.dark'`). Defaults to `'primary'`. The hover border picks
   * up the same color.
   */
  color?: string;
  /**
   * Optional counter shown as a small chip next to the title. Falsy
   * values (`0`, `undefined`, `null`) hide the chip.
   */
  badge?: number | string | null;
  /** Palette key for the badge chip (defaults to `'warning'`). */
  badgeColor?: 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
  /**
   * Navigate to this route. When set, the card renders as the
   * supplied `linkComponent` (e.g. `RouterLink` from react-router) and
   * the whole card becomes a real anchor — Cmd/Ctrl-click opens a new
   * tab, screen readers expose link semantics.
   */
  to?: string;
  /** Custom router link component. Required when `to` is used. */
  linkComponent?: ElementType;
  /** Click handler — used when `to` is not supplied. */
  onClick?: () => void;
  /**
   * Trailing chevron. Pass `false` to suppress, or a ReactNode to
   * substitute (e.g. a status indicator). Default `true`.
   */
  arrow?: boolean | ReactNode;
  /** Square icon size in pixels (default 48). */
  iconSize?: number;
  /** Extra styles applied to the outer Card. */
  sx?: SxProps<Theme>;
  /** Accessible label override. Defaults to `${title} — ${description}`. */
  ariaLabel?: string;
}

export function NavCard({
  title,
  description,
  icon,
  color = 'primary',
  badge,
  badgeColor = 'warning',
  to,
  linkComponent,
  onClick,
  arrow = true,
  iconSize = 48,
  sx,
  ariaLabel,
}: NavCardProps) {
  const interactive = Boolean(to) || Boolean(onClick);
  const linkProps = to && linkComponent ? { component: linkComponent, to } : {};

  const showBadge =
    badge !== undefined && badge !== null && badge !== '' && !(typeof badge === 'number' && badge === 0);

  const label =
    ariaLabel ??
    (typeof title === 'string' && typeof description === 'string' ? `${title} — ${description}` : undefined);

  return (
    <Card
      variant="outlined"
      {...linkProps}
      onClick={!to ? onClick : undefined}
      aria-label={label}
      role={interactive && !to ? 'button' : undefined}
      tabIndex={interactive && !to ? 0 : undefined}
      onKeyDown={
        interactive && !to
          ? (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      sx={{
        height: '100%',
        cursor: interactive ? 'pointer' : 'default',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'border-color 0.2s, transform 0.2s',
        '&:hover': interactive
          ? { borderColor: `${color}.main`, transform: 'translateY(-2px)' }
          : undefined,
        '&:focus-visible': {
          outline: 2,
          outlineColor: `${color}.main`,
          outlineOffset: 2,
        },
        ...sx,
      }}
    >
      <CardContent
        sx={{
          p: 3,
          '&:last-child': { pb: 3 },
          height: '100%',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
            {icon && (
              <Box
                sx={{
                  width: iconSize,
                  height: iconSize,
                  borderRadius: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: `${color}.main`,
                  color: `${color}.contrastText`,
                  flexShrink: 0,
                }}
              >
                {icon}
              </Box>
            )}
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ lineHeight: 1.3 }}>
                  {title}
                </Typography>
                {showBadge && (
                  <Chip
                    size="small"
                    label={badge}
                    color={badgeColor}
                    sx={{ height: 20, fontSize: '0.7rem', fontWeight: 700 }}
                  />
                )}
              </Box>
              {description && (
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                  {description}
                </Typography>
              )}
            </Box>
          </Box>
          {arrow !== false && (
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0, color: 'text.secondary' }}>
              {arrow === true ? <ChevronRightIcon /> : arrow}
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
