'use client';

/**
 * Label Component
 *
 * A versatile label/badge component for status indicators, categories, and tags.
 *
 * @module components/label
 */

import type { ReactNode, Ref } from 'react';
import Box from '@mui/material/Box';
import { getContrastRatio, styled } from '@mui/material/styles';
import type { CssVarsTheme, SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type LabelColor = 'default' | 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';

export type LabelVariant = 'filled' | 'outlined' | 'soft' | 'inverted';

export interface LabelProps {
  /** Content of the label */
  children?: ReactNode;
  /** Color scheme */
  color?: LabelColor;
  /** Visual variant */
  variant?: LabelVariant;
  /** Start icon */
  startIcon?: ReactNode;
  /** End icon */
  endIcon?: ReactNode;
  /** Additional styles */
  sx?: SxProps<Theme>;
  /** Disabled state */
  disabled?: boolean;
  /**
   * Forwarded ref to the underlying span. React 19 threads `ref`
   * through props directly, so consumers pass it like any other
   * prop and no `forwardRef` wrapper is required on this side.
   */
  ref?: Ref<HTMLSpanElement>;
}

// =============================================================================
// STYLED COMPONENT
// =============================================================================

interface StyledLabelProps {
  ownerState: {
    color: LabelColor;
    variant: LabelVariant;
    disabled?: boolean;
  };
}

const StyledLabel = styled('span', {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<StyledLabelProps>(({ theme, ownerState }) => {
  const palette = theme.vars?.palette ?? theme.palette;
  const { color, variant, disabled } = ownerState;

  // Get palette color for non-default colors (guaranteed defined when used below)
  const paletteColor = color !== 'default' ? palette[color] : null;

  // Fallback palette for safe access (uses grey as safe default)
  const safePalette = paletteColor ?? {
    main: palette.grey[500],
    light: palette.grey[300],
    dark: palette.grey[700],
    contrastText: palette.common.white,
  };

  // Prism's dark presets invert tonal roles; custom MUI palettes need not.
  // Choose by contrast against each scheme's surface, then keep the CSS variable
  // so changing schemes or the variable prefix does not freeze a light-mode colour.
  const contrastText = (mode: 'light' | 'dark', surface: 'paper' | 'white' = 'paper') => {
    if (color === 'default') return surface === 'white' ? palette.grey[800] : palette.text.secondary;
    const schemes = (theme as Theme & Partial<Pick<CssVarsTheme, 'colorSchemes'>>).colorSchemes;
    const source = schemes?.[mode]?.palette ?? theme.palette;
    try {
      const tones = source[color];
      const background = surface === 'white' ? source.common.white : source.background.paper;
      const tone =
        getContrastRatio(tones.dark, background) >= getContrastRatio(tones.light, background) ? 'dark' : 'light';
      return safePalette[tone];
    } catch {
      // Browser-resolved brand colours cannot be compared in JavaScript.
      return surface === 'white' ? palette.grey[800] : palette.text.primary;
    }
  };

  // Border radius as number for arithmetic
  const borderRadius = typeof theme.shape.borderRadius === 'number' ? theme.shape.borderRadius : 4;

  const baseStyles = {
    height: 24,
    minWidth: 24,
    lineHeight: 0,
    cursor: 'default',
    borderRadius: borderRadius * 0.75,
    alignItems: 'center',
    whiteSpace: 'nowrap' as const,
    display: 'inline-flex',
    justifyContent: 'center',
    textTransform: 'capitalize' as const,
    padding: theme.spacing(0, 0.75),
    fontSize: theme.typography.pxToRem(12),
    fontWeight: theme.typography.fontWeightBold,
    transition: theme.transitions.create(['all'], {
      duration: theme.transitions.duration.shorter,
    }),
    ...(disabled && {
      opacity: 0.48,
      pointerEvents: 'none' as const,
    }),
  };

  // Filled variant
  const filledStyles = {
    color: color === 'default' ? palette.common.white : safePalette.contrastText,
    backgroundColor: color === 'default' ? palette.text.primary : safePalette.main,
    ...(color === 'default' && theme.applyStyles('dark', { color: palette.grey[800] })),
  };

  // Outlined variant
  const outlinedStyles = {
    color: color === 'default' ? palette.text.primary : safePalette.main,
    backgroundColor: 'transparent',
    border: `2px solid ${color === 'default' ? theme.alpha(palette.grey[500], 0.32) : theme.alpha(safePalette.main, 0.48)}`,
  };

  // Soft variant
  const softStyles = {
    color: contrastText('light'),
    backgroundColor: color === 'default' ? theme.alpha(palette.grey[500], 0.16) : theme.alpha(safePalette.main, 0.16),
    ...theme.applyStyles('dark', { color: contrastText('dark') }),
  };

  // Inverted variant (white background with colored text)
  const invertedStyles = {
    color: contrastText('light', 'white'),
    backgroundColor: palette.common.white,
    border: `1px solid ${theme.alpha(palette.grey[500], 0.16)}`,
    ...(paletteColor && {
      boxShadow: `inset 0 0 0 1px ${theme.alpha(paletteColor.main, 0.24)}`,
    }),
    ...theme.applyStyles('dark', { color: contrastText('dark', 'white') }),
  };

  const variantStyles = {
    filled: filledStyles,
    outlined: outlinedStyles,
    soft: softStyles,
    inverted: invertedStyles,
  };

  return {
    ...baseStyles,
    ...variantStyles[variant],
  };
});

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Label - A versatile label/badge component.
 *
 * @example
 * ```tsx
 * <Label>Default</Label>
 * <Label color="success">Active</Label>
 * <Label color="error" variant="outlined">Failed</Label>
 * <Label color="warning" variant="soft">Pending</Label>
 * ```
 *
 * @example
 * ```tsx
 * // With icons
 * <Label
 *   color="success"
 *   startIcon={<CheckIcon sx={{ width: 14, height: 14 }} />}
 * >
 *   Verified
 * </Label>
 * ```
 */
export function Label({
  children,
  color = 'default',
  variant = 'soft',
  startIcon,
  endIcon,
  sx,
  disabled,
  ref,
  ...other
}: LabelProps) {
  const ownerState = {
    color,
    variant,
    disabled,
  };

  const iconStyles = {
    width: 16,
    height: 16,
    flexShrink: 0,
    '& svg, & img': { width: '100%', height: '100%' },
  };

  return (
    <StyledLabel ref={ref} ownerState={ownerState} sx={sx} {...other}>
      {startIcon && <Box sx={{ mr: 0.5, ...iconStyles }}>{startIcon}</Box>}

      {children}

      {endIcon && <Box sx={{ ml: 0.5, ...iconStyles }}>{endIcon}</Box>}
    </StyledLabel>
  );
}

// =============================================================================
// PRESET LABELS
// =============================================================================

/**
 * Status label with preset colors based on common status types.
 */
export function StatusLabel({
  status,
  ...props
}: Omit<LabelProps, 'color' | 'children'> & {
  status: 'active' | 'inactive' | 'pending' | 'banned' | 'rejected';
}): ReactNode {
  const statusConfig: Record<typeof status, { color: LabelColor; label: string }> = {
    active: { color: 'success', label: 'Active' },
    inactive: { color: 'default', label: 'Inactive' },
    pending: { color: 'warning', label: 'Pending' },
    banned: { color: 'error', label: 'Banned' },
    rejected: { color: 'error', label: 'Rejected' },
  };

  const config = statusConfig[status];

  return (
    <Label color={config.color} {...props}>
      {config.label}
    </Label>
  );
}

/**
 * Boolean label that shows Yes/No or custom text.
 */
export function BooleanLabel({
  value,
  trueText = 'Yes',
  falseText = 'No',
  ...props
}: Omit<LabelProps, 'color' | 'children'> & {
  value: boolean;
  trueText?: string;
  falseText?: string;
}): ReactNode {
  return (
    <Label color={value ? 'success' : 'error'} {...props}>
      {value ? trueText : falseText}
    </Label>
  );
}
