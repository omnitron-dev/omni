'use client';

/**
 * Empty Content Component
 *
 * Universal placeholder for empty states across the application.
 * Supports icon-based illustrations, multiple action buttons,
 * filled backgrounds, and compact mode.
 *
 * @module @omnitron/prism/components/empty-content
 */

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface EmptyContentProps {
  /** Custom illustration (SVG, image, or any ReactNode) */
  illustration?: ReactNode;
  /** Icon element — rendered inside a circular colored wrapper */
  icon?: ReactNode;
  /** Color for the icon wrapper background (palette path like 'primary.main') */
  iconColor?: string;
  /** Size of the icon wrapper (default 64) */
  iconSize?: number;
  /** Main title text */
  title?: string;
  /** Description text or ReactNode */
  description?: ReactNode;
  /** Single action button (backward compatible) */
  action?: ReactNode;
  /** Multiple action buttons rendered in a row */
  actions?: ReactNode[];
  /** Max width of the container */
  maxWidth?: number | string;
  /** Fill the entire available space (height: 100%) */
  filled?: boolean;
  /** Additional styles for root container */
  sx?: SxProps<Theme>;
  /** Illustration wrapper styles */
  illustrationSx?: SxProps<Theme>;
  /** Slot overrides */
  slotProps?: {
    title?: SxProps<Theme>;
    description?: SxProps<Theme>;
    actions?: SxProps<Theme>;
  };
  /** Compact mode — reduces spacing and font sizes */
  compact?: boolean;
}

// =============================================================================
// DEFAULT ILLUSTRATION
// =============================================================================

function DefaultIllustration({ sx }: { sx?: SxProps<Theme> }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 480 360"
      sx={{
        width: 240,
        height: 'auto',
        color: 'text.disabled',
        ...sx,
      }}
    >
      <defs>
        <linearGradient id="emptyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'currentColor', stopOpacity: 0.2 }} />
          <stop offset="100%" style={{ stopColor: 'currentColor', stopOpacity: 0.05 }} />
        </linearGradient>
      </defs>
      <ellipse cx="240" cy="300" rx="160" ry="30" fill="url(#emptyGradient)" />
      <rect x="140" y="120" width="200" height="140" rx="8" fill="currentColor" opacity="0.08" />
      <rect x="160" y="140" width="160" height="8" rx="4" fill="currentColor" opacity="0.12" />
      <rect x="160" y="160" width="120" height="8" rx="4" fill="currentColor" opacity="0.12" />
      <rect x="160" y="180" width="140" height="8" rx="4" fill="currentColor" opacity="0.12" />
      <circle cx="240" cy="80" r="40" fill="currentColor" opacity="0.1" />
      <path
        d="M225 75 L230 80 L255 55"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.2"
      />
    </Box>
  );
}

// =============================================================================
// ICON WRAPPER
// =============================================================================

function IconWrapper({ icon, color = 'primary.main', size = 64 }: { icon: ReactNode; color?: string; size?: number }) {
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: (theme) => {
          // Resolve palette path (e.g. 'primary.main' → theme.palette.primary.main)
          const parts = color.split('.');
          let resolved: any = theme.palette;
          for (const part of parts) {
            resolved = resolved?.[part];
          }
          return typeof resolved === 'string' ? alpha(resolved, 0.08) : alpha(theme.palette.primary.main, 0.08);
        },
      }}
    >
      {icon}
    </Box>
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * EmptyContent - Universal empty state placeholder.
 *
 * @example Basic
 * ```tsx
 * <EmptyContent title="No data found" description="Try adjusting your filters" />
 * ```
 *
 * @example With icon
 * ```tsx
 * <EmptyContent
 *   icon={<ChatIcon sx={{ width: 28, height: 28, color: 'primary.main', opacity: 0.6 }} />}
 *   title="Select a conversation"
 *   description="Choose a room from the sidebar"
 * />
 * ```
 *
 * @example With multiple actions
 * ```tsx
 * <EmptyContent
 *   icon={<FolderIcon sx={{ fontSize: 28, color: 'text.disabled' }} />}
 *   title="No files yet"
 *   description="Upload files or create a folder to get started"
 *   actions={[
 *     <Button variant="contained" startIcon={<UploadIcon />}>Upload</Button>,
 *     <Button variant="outlined" startIcon={<FolderIcon />}>New folder</Button>,
 *   ]}
 * />
 * ```
 *
 * @example Filled (full height)
 * ```tsx
 * <EmptyContent filled title="No messages" compact />
 * ```
 */
export function EmptyContent({
  illustration,
  icon,
  iconColor = 'primary.main',
  iconSize = 64,
  title = 'No data',
  description,
  action,
  actions,
  maxWidth = 400,
  filled = false,
  sx,
  illustrationSx,
  slotProps,
  compact = false,
}: EmptyContentProps): ReactNode {
  // Determine visual: icon > illustration > nothing (no default for clean minimal states)
  const visual = icon ? (
    <IconWrapper icon={icon} color={iconColor} size={iconSize} />
  ) : illustration ? (
    <Box sx={illustrationSx}>{illustration}</Box>
  ) : null;

  // Merge actions: single action + array
  const allActions = [...(actions ?? []), ...(action ? [action] : [])];

  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      sx={{
        textAlign: 'center',
        py: compact ? 4 : 8,
        px: 2,
        ...(filled && { height: '100%', minHeight: 200 }),
        ...sx,
      }}
    >
      <Box
        sx={{
          maxWidth,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: compact ? 1.5 : 2.5,
        }}
      >
        {/* Visual (icon or illustration) */}
        {visual}

        {/* Text */}
        <Stack alignItems="center" spacing={0.5}>
          {title && (
            <Typography
              variant={compact ? 'subtitle1' : 'h6'}
              color="text.secondary"
              sx={{ fontWeight: 600, ...slotProps?.title }}
            >
              {title}
            </Typography>
          )}

          {description && (
            <Typography variant="body2" color="text.disabled" sx={{ lineHeight: 1.6, ...slotProps?.description }}>
              {description}
            </Typography>
          )}
        </Stack>

        {/* Actions */}
        {allActions.length > 0 && (
          <Stack
            direction="row"
            spacing={1}
            sx={{ mt: compact ? 0.5 : 1, flexWrap: 'wrap', justifyContent: 'center', ...slotProps?.actions }}
          >
            {allActions.map((a, i) => (
              <Box key={i}>{a}</Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

/**
 * Search Empty Content - Specialized empty state for search results.
 */
export function SearchEmptyContent({
  query,
  ...props
}: Omit<EmptyContentProps, 'title' | 'description'> & { query?: string }): ReactNode {
  return (
    <EmptyContent
      title="No results found"
      description={
        query ? `Your search for "${query}" did not match any results.` : 'Try adjusting your search criteria.'
      }
      {...props}
    />
  );
}

/**
 * Loading Empty Content - Placeholder while loading.
 */
export function LoadingEmptyContent({ ...props }: Omit<EmptyContentProps, 'title'>): ReactNode {
  return (
    <EmptyContent
      title="Loading..."
      illustration={
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            border: '3px solid',
            borderColor: 'divider',
            borderTopColor: 'primary.main',
            animation: 'spin 1s linear infinite',
            '@keyframes spin': {
              from: { transform: 'rotate(0deg)' },
              to: { transform: 'rotate(360deg)' },
            },
          }}
        />
      }
      compact
      {...props}
    />
  );
}
