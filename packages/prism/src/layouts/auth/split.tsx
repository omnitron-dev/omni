/**
 * Auth Split Layout
 *
 * Split-screen authentication layout with illustration and form.
 *
 * @module @omnitron-dev/prism/layouts/auth/split
 */

import type { ReactNode } from 'react';
import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import type { SxProps, Theme } from '@mui/material';
import { HeaderSection } from '../core/header-section.js';

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const LayoutRoot = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
});

const MainContent = styled(Box)(({ theme }) => ({
  display: 'flex',
  flex: '1 1 auto',
  [theme.breakpoints.up('md')]: {
    flexDirection: 'row',
  },
}));

const IllustrationSection = styled(Box)(({ theme }) => ({
  display: 'none',
  [theme.breakpoints.up('md')]: {
    display: 'flex',
    flexDirection: 'column',
    width: '50%',
    position: 'relative',
    background: `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.dark} 100%)`,
    color: theme.palette.primary.contrastText,
    padding: theme.spacing(8),
    justifyContent: 'center',
    alignItems: 'center',
  },
}));

const IllustrationContent = styled(Box)({
  maxWidth: 480,
  textAlign: 'center',
  position: 'relative',
  zIndex: 1,
});

const FormSection = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  [theme.breakpoints.up('md')]: {
    width: '50%',
  },
}));

const FormContent = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  flex: 1,
  padding: theme.spacing(3),
  [theme.breakpoints.up('sm')]: {
    padding: theme.spacing(5),
  },
  [theme.breakpoints.up('md')]: {
    padding: theme.spacing(8),
    maxWidth: 480,
    marginLeft: 'auto',
    marginRight: 'auto',
  },
}));

// =============================================================================
// COMPONENT
// =============================================================================

export interface AuthSplitLayoutProps {
  /** Child content (form) */
  children?: ReactNode;
  /** Logo component */
  logo?: ReactNode;
  /** Illustration title */
  title?: string;
  /** Illustration subtitle */
  subtitle?: string;
  /** Illustration image or component */
  illustration?: ReactNode;
  /** Show help link */
  showHelp?: boolean;
  /** Help link URL */
  helpUrl?: string;
  /** Help link text */
  helpText?: string;
  /** Settings button */
  settingsButton?: ReactNode;
  /** Custom max width for form */
  maxWidth?: number | string;
  /** Illustration section sx */
  illustrationSx?: SxProps<Theme>;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Auth Split Layout - Split-screen with illustration and form.
 *
 * Left side: Illustration with title and subtitle
 * Right side: Authentication form
 *
 * @example
 * ```tsx
 * <AuthSplitLayout
 *   logo={<Logo />}
 *   title="Welcome to Prism"
 *   subtitle="Sign in to continue to your dashboard"
 *   illustration={<WelcomeIllustration />}
 * >
 *   <LoginForm />
 * </AuthSplitLayout>
 * ```
 */
export function AuthSplitLayout({
  children,
  logo,
  title = 'Welcome',
  subtitle,
  illustration,
  showHelp = true,
  helpUrl = '/help',
  helpText = 'Need help?',
  settingsButton,
  maxWidth = 480,
  illustrationSx,
  sx,
}: AuthSplitLayoutProps): ReactNode {
  return (
    <LayoutRoot sx={sx}>
      {/* Header (visible on mobile, fixed on desktop) */}
      <HeaderSection
        disableSticky
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
        sx={{
          position: { xs: 'static', md: 'fixed' },
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
        }}
      />

      {/* Main content */}
      <MainContent>
        {/* Illustration side */}
        <IllustrationSection sx={illustrationSx}>
          <IllustrationContent>
            {illustration && <Box sx={{ mb: 4 }}>{illustration}</Box>}

            <Typography variant="h3" sx={{ mb: 2, fontWeight: 700 }}>
              {title}
            </Typography>

            {subtitle && (
              <Typography variant="body1" sx={{ opacity: 0.8, maxWidth: 360, mx: 'auto' }}>
                {subtitle}
              </Typography>
            )}
          </IllustrationContent>

          {/* Background decoration */}
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '30%',
              background: 'linear-gradient(to top, rgba(0,0,0,0.1) 0%, transparent 100%)',
            }}
          />
        </IllustrationSection>

        {/* Form side */}
        <FormSection>
          <FormContent sx={{ maxWidth }}>{children}</FormContent>
        </FormSection>
      </MainContent>
    </LayoutRoot>
  );
}

// =============================================================================
// ILLUSTRATION SECTION (STANDALONE)
// =============================================================================

export interface AuthSplitIllustrationProps {
  /** Title */
  title?: string;
  /** Subtitle */
  subtitle?: string;
  /** Illustration image/component */
  illustration?: ReactNode;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Standalone illustration section for custom split layouts.
 */
export function AuthSplitIllustration({ title, subtitle, illustration, sx }: AuthSplitIllustrationProps): ReactNode {
  return (
    <IllustrationSection sx={sx}>
      <IllustrationContent>
        {illustration && <Box sx={{ mb: 4 }}>{illustration}</Box>}

        {title && (
          <Typography variant="h3" sx={{ mb: 2, fontWeight: 700 }}>
            {title}
          </Typography>
        )}

        {subtitle && (
          <Typography variant="body1" sx={{ opacity: 0.8 }}>
            {subtitle}
          </Typography>
        )}
      </IllustrationContent>
    </IllustrationSection>
  );
}

// =============================================================================
// FORM CONTENT (STANDALONE)
// =============================================================================

export interface AuthSplitContentProps {
  /** Child content */
  children?: ReactNode;
  /** Custom max width */
  maxWidth?: number | string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/**
 * Standalone form content section for custom split layouts.
 */
export function AuthSplitContent({ children, maxWidth = 480, sx }: AuthSplitContentProps): ReactNode {
  return (
    <FormSection>
      <FormContent sx={[{ maxWidth }, ...(Array.isArray(sx) ? sx : [sx])]}>{children}</FormContent>
    </FormSection>
  );
}
