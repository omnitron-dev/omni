/**
 * Dashboard Topnav
 *
 * Horizontal top navigation bar for dashboard layouts.
 * Used in 'topnav' and 'combo' navigation modes.
 * Implements WCAG 2.1 accessibility with proper ARIA attributes.
 *
 * @module @omnitron-dev/prism/layouts/dashboard/topnav
 */

import type { ReactNode } from 'react';
import { styled, alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import type { SxProps, Theme, Breakpoint } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useNavActive } from '../core/context.js';
import { ARIA_LABELS } from '../../core/accessibility/index.js';
import { LAYOUT_CSS_VARS, type LayoutNavData, type LayoutNavItem } from '../types.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const TopnavRoot = styled('nav')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  minHeight: 48,
  borderBottom: `1px solid ${theme.palette.divider}`,
  backgroundColor: `var(${LAYOUT_CSS_VARS.navBg}, ${theme.palette.background.paper})`,
  paddingLeft: theme.spacing(2),
  paddingRight: theme.spacing(2),
  gap: theme.spacing(0.5),
  overflowX: 'auto',
  // Hide scrollbar but keep scroll functional
  scrollbarWidth: 'none',
  '&::-webkit-scrollbar': { display: 'none' },
}));

// =============================================================================
// COMPONENTS
// =============================================================================

export interface TopnavProps {
  /** Navigation data */
  navData?: LayoutNavData;
  /** Navigation item renderer */
  renderNavItem?: (item: LayoutNavItem, depth: number) => ReactNode;
  /** Layout breakpoint (hides below this on combo mode) */
  layoutQuery?: Breakpoint;
  /** Accessible label */
  'aria-label'?: string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Dashboard Topnav - Horizontal navigation bar.
 *
 * Renders navigation sections as a horizontal list.
 * For 'combo' mode, visible only on desktop alongside the sidenav.
 * For 'topnav' mode, always visible.
 *
 * @example
 * ```tsx
 * <Topnav
 *   navData={navigationConfig}
 *   renderNavItem={(item) => <NavLink key={item.id} to={item.path}>{item.title}</NavLink>}
 * />
 * ```
 */
export function Topnav({
  navData,
  renderNavItem,
  layoutQuery = 'lg',
  'aria-label': ariaLabel = ARIA_LABELS.mainNav,
  sx,
}: TopnavProps): ReactNode {
  return (
    <TopnavRoot aria-label={ariaLabel} sx={sx}>
      {navData?.map((section) =>
        section.items.map((item) =>
          renderNavItem ? renderNavItem(item, 0) : <DefaultTopnavItem key={item.id} item={item} />
        )
      )}
    </TopnavRoot>
  );
}

// =============================================================================
// DEFAULT NAV ITEM — smart routing + active state
// =============================================================================

interface DefaultTopnavItemProps {
  item: LayoutNavItem;
}

function DefaultTopnavItem({ item }: DefaultTopnavItemProps): ReactNode {
  const { pathname } = useLocation();
  const { isItemActive } = useNavActive(pathname);
  const active = isItemActive(item);

  return (
    <Box
      component={item.path ? RouterLink : 'div'}
      {...(item.path ? { to: item.path } : {})}
      role="menuitem"
      tabIndex={0}
      aria-disabled={item.disabled || undefined}
      aria-current={active ? 'page' : undefined}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        borderRadius: 1,
        whiteSpace: 'nowrap',
        textDecoration: 'none',
        color: active ? 'primary.main' : 'text.primary',
        typography: 'body2',
        fontWeight: active ? 600 : 500,
        cursor: item.disabled ? 'default' : 'pointer',
        opacity: item.disabled ? 0.5 : 1,
        ...(active && {
          bgcolor: alpha(theme.palette.primary.main, 0.08),
        }),
        '&:hover': {
          bgcolor: item.disabled ? undefined : active ? alpha(theme.palette.primary.main, 0.16) : 'action.hover',
        },
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      })}
    >
      {item.icon && (
        <Box
          component="span"
          aria-hidden="true"
          sx={{ display: 'flex', color: active ? 'primary.main' : 'text.secondary' }}
        >
          {item.icon}
        </Box>
      )}
      <span>{item.title}</span>
      {item.info}
    </Box>
  );
}
