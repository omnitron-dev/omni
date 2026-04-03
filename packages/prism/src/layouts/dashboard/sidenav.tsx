/**
 * Dashboard Sidenav
 *
 * Sidebar navigation for dashboard layouts.
 * Supports multiple variants: default, mini, and stacked.
 * Implements WCAG 2.1 accessibility with proper ARIA attributes.
 *
 * @module @omnitron/prism/layouts/dashboard/sidenav
 */

import { type ReactNode } from 'react';
import { styled, alpha } from '@mui/material/styles';
import Drawer from '@mui/material/Drawer';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListSubheader from '@mui/material/ListSubheader';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import type { SxProps, Theme, Breakpoint } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useLayoutContext, useNavActive } from '../core/context.js';
import { ARIA_LABELS } from '../../core/accessibility/index.js';
import { DRAWER_WIDTHS, HEADER_HEIGHTS, LAYOUT_CSS_VARS, type LayoutNavData, type SidenavVariant } from '../types.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

interface NavRootProps {
  variant: SidenavVariant;
  collapsed: boolean;
}

const NavRoot = styled(Box, {
  shouldForwardProp: (prop) => !['variant', 'collapsed'].includes(prop as string),
})<NavRootProps>(({ theme, variant, collapsed }) => {
  // Calculate width based on variant and collapse state
  let width: number = DRAWER_WIDTHS.full;
  if (collapsed) {
    width = variant === 'stacked' ? DRAWER_WIDTHS.stackedCollapsed : DRAWER_WIDTHS.mini;
  } else if (variant === 'mini') {
    width = DRAWER_WIDTHS.mini;
  } else if (variant === 'stacked') {
    width = DRAWER_WIDTHS.stackedExpanded;
  }

  return {
    position: 'fixed',
    top: 0,
    left: 0,
    height: '100%',
    width,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    zIndex: theme.zIndex.drawer,
    backgroundColor: `var(${LAYOUT_CSS_VARS.navBg}, ${theme.palette.background.paper})`,
    borderRight: `1px solid ${theme.palette.divider}`,
    transition: theme.transitions.create('width', {
      duration: theme.transitions.duration.shorter,
    }),
  };
});

const NavContent = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
});

const NavScrollArea = styled(Box)({
  flex: 1,
  overflow: 'auto',
  // Custom scrollbar
  '&::-webkit-scrollbar': {
    width: 6,
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 3,
  },
});

const CollapseButton = styled(IconButton)(({ theme }) => ({
  position: 'absolute',
  top: HEADER_HEIGHTS.desktop / 2,
  transform: 'translateY(-50%)',
  right: -12,
  width: 24,
  height: 24,
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
  boxShadow: theme.shadows[1],
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
  '& svg': {
    width: 16,
    height: 16,
  },
}));

// =============================================================================
// COMPONENTS
// =============================================================================

export interface SidenavProps {
  /** Logo component */
  logo?: ReactNode;
  /** Navigation data */
  navData?: LayoutNavData;
  /** Navigation item renderer */
  renderNavItem?: (item: LayoutNavData[number]['items'][number], depth: number) => ReactNode;
  /** Footer content (above collapse button) */
  footer?: ReactNode;
  /** Show collapse toggle button */
  showCollapseButton?: boolean;
  /** Layout breakpoint (hides on mobile) */
  layoutQuery?: Breakpoint;
  /** Accessible label for the navigation */
  'aria-label'?: string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Dashboard Sidenav - Sidebar navigation component.
 *
 * Supports three variants:
 * - `default`: Full-width sidebar with text labels
 * - `mini`: Icon-only collapsed sidebar
 * - `stacked`: Two-panel design with icon nav + content panel
 *
 * @example
 * ```tsx
 * <Sidenav
 *   logo={<Logo />}
 *   navData={navigationConfig}
 *   showCollapseButton
 * />
 * ```
 */
export function Sidenav({
  logo,
  navData,
  renderNavItem,
  footer,
  showCollapseButton = true,
  layoutQuery = 'md',
  'aria-label': ariaLabel = ARIA_LABELS.mainNav,
  sx,
}: SidenavProps): ReactNode {
  const { config, toggleSidenavCollapse } = useLayoutContext();
  const { sidenavVariant, sidenavCollapsed } = config;

  const showText = !sidenavCollapsed && sidenavVariant !== 'mini';

  return (
    <NavRoot
      role="navigation"
      aria-label={ariaLabel}
      variant={sidenavVariant}
      collapsed={sidenavCollapsed}
      sx={[
        (theme) => ({
          display: { xs: 'none', [layoutQuery]: 'flex' },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* Header area with logo — height matches HeaderSection */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: showText ? 'flex-start' : 'center',
          height: { xs: HEADER_HEIGHTS.mobile, md: HEADER_HEIGHTS.desktop },
          px: showText ? 3 : 1,
          flexShrink: 0,
        }}
      >
        {logo}
      </Box>

      <Divider />

      {/* Navigation content */}
      <NavContent>
        <NavScrollArea>
          {navData?.map((section, idx) => (
            <List
              key={section.id}
              subheader={
                showText && section.subheader ? (
                  <ListSubheader
                    disableSticky
                    sx={{
                      px: 2.5,
                      py: 1.5,
                      typography: 'overline',
                      color: 'text.secondary',
                      bgcolor: 'transparent',
                    }}
                  >
                    {section.subheader}
                  </ListSubheader>
                ) : !showText && idx > 0 ? (
                  <Divider sx={{ my: 1, mx: 1.5 }} />
                ) : null
              }
              sx={{ px: showText ? 1 : 0.5 }}
            >
              {section.items.map((item) =>
                renderNavItem ? (
                  renderNavItem(item, 0)
                ) : (
                  <NavItemWithActive key={item.id} item={item} showText={showText} depth={0} />
                )
              )}
            </List>
          ))}
        </NavScrollArea>

        {/* Footer area */}
        {footer && <Box sx={{ flexShrink: 0, p: 2 }}>{footer}</Box>}
      </NavContent>

      {/* Collapse toggle button */}
      {showCollapseButton && sidenavVariant !== 'mini' && (
        <CollapseButton
          onClick={toggleSidenavCollapse}
          size="small"
          aria-label={sidenavCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!sidenavCollapsed}
        >
          <ChevronIcon direction={sidenavCollapsed ? 'right' : 'left'} />
        </CollapseButton>
      )}
    </NavRoot>
  );
}

// =============================================================================
// MOBILE SIDENAV (DRAWER)
// =============================================================================

export interface MobileSidenavProps extends Omit<SidenavProps, 'showCollapseButton' | 'layoutQuery'> {
  /** Layout breakpoint (shows only below this) */
  layoutQuery?: Breakpoint;
}

/**
 * Mobile Sidenav - Drawer-based navigation for mobile.
 * Implements WCAG 2.1 accessibility with proper ARIA attributes.
 */
export function MobileSidenav({
  logo,
  navData,
  renderNavItem,
  footer,
  layoutQuery = 'md',
  'aria-label': ariaLabel = ARIA_LABELS.mainNav,
  sx,
}: MobileSidenavProps): ReactNode {
  const { config, toggleDrawer } = useLayoutContext();
  const { drawerOpen } = config;

  return (
    <Drawer
      open={drawerOpen}
      onClose={toggleDrawer}
      aria-label={ariaLabel}
      sx={[
        (theme) => ({
          display: { xs: 'block', [layoutQuery]: 'none' },
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTHS.mobile,
            backgroundColor: `var(${LAYOUT_CSS_VARS.navBg}, ${theme.palette.background.paper})`,
          },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* Header with logo — height matches HeaderSection */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          height: { xs: HEADER_HEIGHTS.mobile, md: HEADER_HEIGHTS.desktop },
          px: 2.5,
        }}
      >
        {logo}
      </Box>

      <Divider />

      {/* Navigation */}
      <Box component="nav" role="navigation" sx={{ flex: 1, overflow: 'auto' }}>
        {navData?.map((section) => (
          <List
            key={section.id}
            subheader={
              section.subheader ? (
                <ListSubheader
                  disableSticky
                  sx={{
                    px: 2.5,
                    py: 1.5,
                    typography: 'overline',
                    color: 'text.secondary',
                    bgcolor: 'transparent',
                  }}
                >
                  {section.subheader}
                </ListSubheader>
              ) : null
            }
            sx={{ px: 1 }}
          >
            {section.items.map((item) =>
              renderNavItem ? (
                renderNavItem(item, 0)
              ) : (
                <NavItemWithActive key={item.id} item={item} showText depth={0} />
              )
            )}
          </List>
        ))}
      </Box>

      {/* Footer */}
      {footer && <Box sx={{ p: 2 }}>{footer}</Box>}
    </Drawer>
  );
}

// =============================================================================
// DEFAULT NAV ITEM — smart routing + active state
// =============================================================================

interface DefaultNavItemProps {
  item: LayoutNavData[number]['items'][number];
  showText: boolean;
  depth: number;
  active?: boolean;
}

/**
 * Default nav item with react-router Link and active state detection.
 * Supports collapsed (icon-only) mode with tooltip.
 */
function DefaultNavItem({ item, showText, depth, active }: DefaultNavItemProps): ReactNode {
  const button = (
    <ListItemButton
      component={item.path ? RouterLink : 'div'}
      {...(item.path ? { to: item.path } : {})}
      disabled={item.disabled}
      selected={active}
      sx={(theme) => ({
        minHeight: 44,
        borderRadius: 1,
        pl: showText ? depth * 2 + 2 : undefined,
        // Collapsed mode: center icon
        ...(!showText && {
          justifyContent: 'center',
          px: 1,
          mx: 0.5,
        }),
        // Active state
        ...(active && {
          color: 'primary.main',
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          '&:hover': {
            bgcolor: alpha(theme.palette.primary.main, 0.16),
          },
        }),
      })}
    >
      {item.icon && (
        <ListItemIcon
          sx={{
            minWidth: showText ? 36 : 'unset',
            color: active ? 'primary.main' : 'text.secondary',
            ...(!showText && { mr: 0, justifyContent: 'center' }),
          }}
        >
          <Box
            component="span"
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24 }}
          >
            {item.icon}
          </Box>
        </ListItemIcon>
      )}
      {showText && (
        <ListItemText
          primary={item.title}
          primaryTypographyProps={{
            variant: 'body2',
            fontWeight: active ? 600 : 500,
            noWrap: true,
          }}
        />
      )}
      {showText && item.info}
    </ListItemButton>
  );

  if (!showText) {
    return (
      <Tooltip title={item.title} placement="right" arrow key={item.id}>
        {button}
      </Tooltip>
    );
  }

  return button;
}

/**
 * Wrapper that resolves active state for DefaultNavItem.
 * Separated to avoid re-creating hooks for custom renderNavItem.
 */
function NavItemWithActive({ item, showText, depth }: Omit<DefaultNavItemProps, 'active'>): ReactNode {
  const { pathname } = useLocation();
  const { isItemActive } = useNavActive(pathname);
  const active = isItemActive(item);
  return <DefaultNavItem key={item.id} item={item} showText={showText} depth={depth} active={active} />;
}

// =============================================================================
// CHEVRON ICON (SIMPLE SVG)
// =============================================================================

interface ChevronIconProps {
  direction: 'left' | 'right';
}

function ChevronIcon({ direction }: ChevronIconProps): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{
        transform: direction === 'right' ? 'rotate(180deg)' : undefined,
      }}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
