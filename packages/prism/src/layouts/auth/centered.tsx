/**
 * Auth Centered Layout
 *
 * Centered authentication layout with card-style content.
 *
 * @module @omnitron/prism/layouts/auth/centered
 */

import type { ReactNode } from 'react';
import { styled, alpha } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import type { SxProps, Theme } from '@mui/material';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const LayoutRoot = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  // Subtle background gradient
  background:
    theme.palette.mode === 'dark'
      ? `linear-gradient(135deg, ${alpha(theme.palette.primary.dark, 0.1)} 0%, ${theme.palette.background.default} 100%)`
      : `linear-gradient(135deg, ${alpha(theme.palette.primary.light, 0.1)} 0%, ${theme.palette.background.default} 100%)`,
}));

const MainContent = styled(Box)({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
});

const ContentCard = styled(Card)(({ theme }) => ({
  width: '100%',
  maxWidth: 420,
  padding: theme.spacing(5, 3),
  position: 'relative',
  zIndex: 2,
}));

// =============================================================================
// COMPONENT
// =============================================================================

export interface AuthCenteredLayoutProps {
  /** Child content (form) */
  children?: ReactNode;
  /** Logo component */
  logo?: ReactNode;
  /** Custom max width for content card */
  maxWidth?: number | string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Auth Centered Layout - Card-based centered authentication form.
 *
 * Perfect for login, registration, password reset, and verification pages.
 *
 * @example
 * ```tsx
 * <AuthCenteredLayout
 *   logo={<Logo />}
 *   showHelp
 * >
 *   <LoginForm />
 * </AuthCenteredLayout>
 * ```
 */
export function AuthCenteredLayout({ children, logo, maxWidth = 420, sx }: AuthCenteredLayoutProps): ReactNode {
  return (
    <LayoutRoot sx={sx}>
      {/* Logo */}
      {logo && (
        <Box
          sx={{
            position: { xs: 'static', md: 'fixed' },
            top: 0,
            left: 0,
            p: 3,
            zIndex: 3,
          }}
        >
          {logo}
        </Box>
      )}

      {/* Main content */}
      <MainContent>
        <ContentCard sx={{ maxWidth }}>{children}</ContentCard>
      </MainContent>
    </LayoutRoot>
  );
}

// =============================================================================
// CONTENT WRAPPER
// =============================================================================

export interface AuthCenteredContentProps {
  /** Child content */
  children?: ReactNode;
  /** Custom max width */
  maxWidth?: number | string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Auth centered content wrapper.
 * Use for the content inside the auth card.
 */
export function AuthCenteredContent({ children, maxWidth = 420, sx }: AuthCenteredContentProps): ReactNode {
  return <ContentCard sx={[{ maxWidth }, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</ContentCard>;
}
