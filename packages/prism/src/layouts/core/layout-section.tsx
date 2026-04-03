/**
 * Layout Section
 *
 * Root container for all layout variants.
 * Provides the structural foundation for header, sidebar, main, and footer.
 *
 * @module @omnitron-dev/prism/layouts/core/layout-section
 */

import type { ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material';
import { LayoutGlobalStyles } from './css-vars.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

/**
 * Root layout container.
 */
const LayoutRoot = styled(Box)({
  minHeight: '100%',
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
});

/**
 * Container for sidebar + main content area.
 */
const LayoutSidebarContainer = styled(Box)({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'row',
  minHeight: 0, // Allow shrinking in flex context
});

// =============================================================================
// COMPONENT
// =============================================================================

export interface LayoutSectionProps {
  /** Header section (rendered at top) */
  headerSection?: ReactNode;
  /** Sidebar section (sidenav) */
  sidebarSection?: ReactNode;
  /** Footer section (rendered at bottom of main area) */
  footerSection?: ReactNode;
  /** Main content */
  children?: ReactNode;
  /** Custom CSS variables */
  cssVars?: Record<string, string | number>;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Layout Section - Root container for page layouts.
 *
 * Structure:
 * ```
 * LayoutRoot
 * ├── GlobalStyles (CSS variables)
 * ├── HeaderSection
 * └── LayoutSidebarContainer (when sidebar exists)
 *     ├── SidebarSection
 *     └── MainContent
 *         ├── children
 *         └── FooterSection
 * └── or MainContent directly (when no sidebar)
 * ```
 *
 * @example
 * ```tsx
 * <LayoutSection
 *   headerSection={<HeaderSection slots={{ leftArea: <Logo /> }} />}
 *   sidebarSection={<Sidenav />}
 *   footerSection={<Footer />}
 * >
 *   <Outlet />
 * </LayoutSection>
 * ```
 */
export function LayoutSection({
  headerSection,
  sidebarSection,
  footerSection,
  children,
  cssVars,
  sx,
}: LayoutSectionProps): ReactNode {
  const mainContent = (
    <Box
      component="main"
      sx={{
        display: 'flex',
        flex: '1 1 auto',
        flexDirection: 'column',
        minWidth: 0, // Allow text truncation
      }}
    >
      {children}
      {footerSection}
    </Box>
  );

  return (
    <LayoutRoot sx={sx}>
      <LayoutGlobalStyles cssVars={cssVars} />

      {headerSection}

      {sidebarSection ? (
        <LayoutSidebarContainer>
          {sidebarSection}
          {mainContent}
        </LayoutSidebarContainer>
      ) : (
        mainContent
      )}
    </LayoutRoot>
  );
}

// =============================================================================
// MAIN SECTION COMPONENT
// =============================================================================

export interface MainSectionProps {
  /** Content */
  children?: ReactNode;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Main content section.
 * Simple flex container for page content.
 */
export function MainSection({ children, sx }: MainSectionProps): ReactNode {
  return (
    <Box
      component="main"
      sx={[
        {
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          minWidth: 0,
          py: {
            xs: 2,
            sm: 3,
            md: 4,
          },
          px: {
            xs: 2,
            sm: 3,
            md: 4,
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}
