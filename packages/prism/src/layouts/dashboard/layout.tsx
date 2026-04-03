/**
 * Dashboard Layout
 *
 * Main dashboard layout component that orchestrates navigation, header, and content.
 * Implements WCAG 2.1 accessibility guidelines with proper landmarks and keyboard navigation.
 *
 * @module @omnitron/prism/layouts/dashboard/layout
 */

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import SvgIcon from '@mui/material/SvgIcon';
import type { SxProps, Theme, Breakpoint } from '@mui/material';
import { LayoutProvider, useLayoutConfig, useLayoutContext } from '../core/context.js';
import { HeaderSection } from '../core/header-section.js';
import { Sidenav, MobileSidenav } from './sidenav.js';
import { Topnav } from './topnav.js';
import { SkipLink, ARIA_LABELS } from '../../core/accessibility/index.js';
import { type LayoutNavData, type HeaderSlots, type LayoutConfig } from '../types.js';

// Simple menu icon (3 horizontal lines)
function MenuIcon() {
  return (
    <SvgIcon>
      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
    </SvgIcon>
  );
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

interface MainWrapperProps {
  hasSidebar: boolean;
  sidebarWidth: number;
  layoutQuery: Breakpoint;
}

const MainWrapper = styled(Box, {
  shouldForwardProp: (prop) => !['hasSidebar', 'sidebarWidth', 'layoutQuery'].includes(prop as string),
})<MainWrapperProps>(({ theme, hasSidebar, sidebarWidth, layoutQuery }) => ({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  minHeight: '100vh',
  // Adjust margin for sidebar on desktop
  ...(hasSidebar && {
    [theme.breakpoints.up(layoutQuery)]: {
      marginLeft: sidebarWidth,
    },
  }),
  // Smooth transition
  transition: theme.transitions.create('margin-left', {
    duration: theme.transitions.duration.shorter,
  }),
}));

// =============================================================================
// INTERNAL LAYOUT COMPONENT
// =============================================================================

interface DashboardLayoutInternalProps {
  children?: ReactNode;
  layoutQuery: Breakpoint;
  navData?: LayoutNavData;
  headerSlots?: HeaderSlots;
  logo?: ReactNode;
  footer?: ReactNode;
  sidenavFooter?: ReactNode;
  slotProps?: {
    header?: Partial<React.ComponentProps<typeof HeaderSection>>;
    main?: {
      sx?: SxProps<Theme>;
      disablePadding?: boolean;
      maxWidth?: Breakpoint | false;
    };
  };
}

/**
 * Internal dashboard layout (used within LayoutProvider).
 */
function DashboardLayoutInternal({
  children,
  layoutQuery,
  navData,
  headerSlots,
  logo,
  footer,
  sidenavFooter,
  slotProps,
}: DashboardLayoutInternalProps): ReactNode {
  const config = useLayoutConfig();
  const { toggleDrawer } = useLayoutContext();
  const {
    navigationMenuType,
    sidenavCollapsed: _sidenavCollapsed,
    sidenavVariant: _sidenavVariant,
    drawerWidth,
  } = config;

  const hasSidebar = navigationMenuType === 'sidenav' || navigationMenuType === 'combo';
  const hasTopnav = navigationMenuType === 'topnav' || navigationMenuType === 'combo';

  // Calculate actual sidebar width
  const sidebarWidth = hasSidebar ? drawerWidth : 0;

  // Merge mobile menu button into header slots
  const mergedHeaderSlots = useMemo<HeaderSlots | undefined>(() => {
    if (!hasSidebar) return headerSlots;

    const mobileMenuButton = (
      <IconButton
        onClick={toggleDrawer}
        aria-label="Open menu"
        sx={{
          display: { xs: 'inline-flex', [layoutQuery]: 'none' },
          bgcolor: 'transparent',
          transition: 'transform 0.2s ease',
          '&:hover': { bgcolor: 'transparent', transform: 'scale(1.1)' },
        }}
      >
        <MenuIcon />
      </IconButton>
    );

    return {
      ...headerSlots,
      leftArea: (
        <>
          {mobileMenuButton}
          {headerSlots?.leftArea}
        </>
      ),
    };
  }, [hasSidebar, headerSlots, toggleDrawer, layoutQuery]);

  return (
    <MainWrapper hasSidebar={hasSidebar} sidebarWidth={sidebarWidth} layoutQuery={layoutQuery}>
      {/* Skip to main content link for keyboard users */}
      <SkipLink href="#main-content">Skip to main content</SkipLink>

      {/* Header */}
      <HeaderSection
        slots={mergedHeaderSlots}
        aria-label={ARIA_LABELS.header}
        sx={{
          ...(slotProps?.header?.sx as object),
        }}
        {...slotProps?.header}
      />

      {/* Top navigation bar (topnav or combo mode) */}
      {hasTopnav && (
        <Topnav
          navData={navData}
          layoutQuery={layoutQuery}
          aria-label={hasSidebar ? 'Secondary navigation' : ARIA_LABELS.mainNav}
        />
      )}

      {/* Sidebar (sidenav or combo mode) */}
      {hasSidebar && (
        <>
          <Sidenav
            logo={logo}
            navData={navData}
            footer={sidenavFooter}
            layoutQuery={layoutQuery}
            aria-label={ARIA_LABELS.mainNav}
          />
          <MobileSidenav
            logo={logo}
            navData={navData}
            footer={sidenavFooter}
            layoutQuery={layoutQuery}
            aria-label={ARIA_LABELS.mainNav}
          />
        </>
      )}

      {/* Main content */}
      <Box
        component="main"
        id="main-content"
        role="main"
        aria-label={ARIA_LABELS.main}
        tabIndex={-1}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          flex: '1 1 auto',
          // Remove focus outline for skip link target
          '&:focus': {
            outline: 'none',
          },
          ...(!slotProps?.main?.disablePadding && {
            py: { xs: 2, sm: 3, md: 4 },
            px: { xs: 2, sm: 3, md: 4 },
          }),
          ...(slotProps?.main?.sx as object),
        }}
      >
        {slotProps?.main?.maxWidth ? (
          <Container maxWidth={slotProps.main.maxWidth} sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {children}
          </Container>
        ) : (
          children
        )}
      </Box>

      {/* Footer */}
      {footer}
    </MainWrapper>
  );
}

// =============================================================================
// PUBLIC COMPONENT
// =============================================================================

export interface DashboardLayoutProps {
  /** Child content */
  children?: ReactNode;
  /** Layout breakpoint for responsive behavior */
  layoutQuery?: Breakpoint;
  /** Navigation data */
  navData?: LayoutNavData;
  /** Header slot content */
  headerSlots?: HeaderSlots;
  /** Logo component */
  logo?: ReactNode;
  /** Footer component */
  footer?: ReactNode;
  /** Sidenav footer content */
  sidenavFooter?: ReactNode;
  /** Initial layout configuration */
  initialConfig?: Partial<LayoutConfig>;
  /**
   * Persistence key for sidebar collapsed state.
   * When provided, sidebar collapsed state persists to localStorage.
   * Use unique keys per layout (e.g., 'main', 'admin').
   */
  persistKey?: string;
  /** Props for layout sections */
  slotProps?: {
    header?: Partial<React.ComponentProps<typeof HeaderSection>>;
    main?: {
      sx?: SxProps<Theme>;
      disablePadding?: boolean;
      maxWidth?: Breakpoint | false;
    };
  };
}

/**
 * Dashboard Layout - Complete dashboard layout with navigation.
 *
 * Features:
 * - Configurable navigation type (sidenav, topnav, combo)
 * - Multiple sidenav variants (default, mini, stacked)
 * - Responsive mobile drawer
 * - Slot-based header customization
 * - CSS variables for theming
 *
 * @example
 * ```tsx
 * <DashboardLayout
 *   logo={<Logo />}
 *   navData={navigationConfig}
 *   headerSlots={{
 *     leftArea: <MenuButton />,
 *     rightArea: <UserMenu />,
 *   }}
 *   initialConfig={{
 *     navigationMenuType: 'sidenav',
 *     sidenavVariant: 'default',
 *   }}
 * >
 *   <Outlet />
 * </DashboardLayout>
 * ```
 */
export function DashboardLayout({
  children,
  layoutQuery = 'lg',
  navData,
  headerSlots,
  logo,
  footer,
  sidenavFooter,
  initialConfig,
  persistKey,
  slotProps,
}: DashboardLayoutProps): ReactNode {
  return (
    <LayoutProvider initialConfig={initialConfig} persistKey={persistKey}>
      <DashboardLayoutInternal
        layoutQuery={layoutQuery}
        navData={navData}
        headerSlots={headerSlots}
        logo={logo}
        footer={footer}
        sidenavFooter={sidenavFooter}
        slotProps={slotProps}
      >
        {children}
      </DashboardLayoutInternal>
    </LayoutProvider>
  );
}

// =============================================================================
// DASHBOARD CONTENT WRAPPER
// =============================================================================

export interface DashboardContentProps {
  /** Child content */
  children?: ReactNode;
  /** Disable padding */
  disablePadding?: boolean;
  /** Container max width */
  maxWidth?: Breakpoint | false;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Dashboard content wrapper with optional container.
 * Use for consistent content padding within dashboard.
 */
export function DashboardContent({ children, disablePadding = false, maxWidth, sx }: DashboardContentProps): ReactNode {
  return (
    <Box
      sx={[
        {
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          ...(!disablePadding && {
            py: { xs: 2, sm: 3, md: 4 },
            px: { xs: 2, sm: 3, md: 4 },
          }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {maxWidth ? (
        <Container maxWidth={maxWidth} sx={{ flex: 1 }}>
          {children}
        </Container>
      ) : (
        children
      )}
    </Box>
  );
}
