/**
 * Auth Simple Layout
 *
 * Simple, minimal layout for authentication-related pages.
 *
 * @module @omnitron-dev/prism/layouts/auth/simple
 */

import type { ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import type { SxProps, Theme, Breakpoint } from '@mui/material';
import { HeaderSection } from '../core/header-section.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const LayoutRoot = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
});

const MainContent = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
});

const CompactContent = styled(Box)(({ theme }) => ({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  padding: theme.spacing(3, 2, 10, 2),
  [theme.breakpoints.up('sm')]: {
    padding: theme.spacing(10, 0),
    maxWidth: 448,
    margin: '0 auto',
    width: '100%',
  },
}));

// =============================================================================
// COMPONENT
// =============================================================================

export interface AuthSimpleLayoutProps {
  /** Child content */
  children?: ReactNode;
  /** Logo component */
  logo?: ReactNode;
  /** Show help link */
  showHelp?: boolean;
  /** Help link URL */
  helpUrl?: string;
  /** Help link text */
  helpText?: string;
  /** Settings button */
  settingsButton?: ReactNode;
  /** Use compact centered content */
  compact?: boolean;
  /** Container max width (for non-compact) */
  maxWidth?: Breakpoint | false;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Auth Simple Layout - Minimal layout for auth-related pages.
 *
 * Use for:
 * - Error pages (404, 500)
 * - Maintenance pages
 * - Simple message pages
 * - Compact auth forms
 *
 * @example
 * ```tsx
 * <AuthSimpleLayout logo={<Logo />} compact>
 *   <NotFoundContent />
 * </AuthSimpleLayout>
 * ```
 */
export function AuthSimpleLayout({
  children,
  logo,
  showHelp = true,
  helpUrl = '/help',
  helpText = 'Need help?',
  settingsButton,
  compact = false,
  maxWidth = 'lg',
  sx,
}: AuthSimpleLayoutProps): ReactNode {
  return (
    <LayoutRoot sx={sx}>
      {/* Header */}
      <HeaderSection
        disableOffset
        slots={{
          leftArea: logo,
          rightArea: (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {showHelp && (
                <Link href={helpUrl} underline="hover" variant="body2" sx={{ color: 'text.secondary' }}>
                  {helpText}
                </Link>
              )}
              {settingsButton}
            </Box>
          ),
        }}
      />

      {/* Main content */}
      <MainContent>
        {compact ? (
          <CompactContent>{children}</CompactContent>
        ) : (
          <Container
            maxWidth={maxWidth}
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              py: { xs: 3, sm: 5 },
            }}
          >
            {children}
          </Container>
        )}
      </MainContent>
    </LayoutRoot>
  );
}

// =============================================================================
// SIMPLE COMPACT CONTENT
// =============================================================================

export interface SimpleCompactContentProps {
  /** Child content */
  children?: ReactNode;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Simple compact content wrapper.
 * Centered, constrained-width content for simple pages.
 */
export function SimpleCompactContent({ children, sx }: SimpleCompactContentProps): ReactNode {
  return <CompactContent sx={sx}>{children}</CompactContent>;
}
