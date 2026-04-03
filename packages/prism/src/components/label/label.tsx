'use client';

/**
 * Label Component
 *
 * A versatile label/badge component for status indicators, categories, and tags.
 *
 * @module @omnitron/prism/components/label
 */

import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import Box from '@mui/material/Box';
import { alpha, styled } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

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
  const isLight = theme.palette.mode === 'light';
  const { color, variant, disabled } = ownerState;

  // Get palette color for non-default colors (guaranteed defined when used below)
  const paletteColor = color !== 'default' ? theme.palette[color] : null;

  // Fallback palette for safe access (uses grey as safe default)
  const safePalette = paletteColor ?? {
    main: theme.palette.grey[500],
    light: theme.palette.grey[300],
    dark: theme.palette.grey[700],
    contrastText: theme.palette.common.white,
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
    color:
      color === 'default' ? (isLight ? theme.palette.common.white : theme.palette.grey[800]) : safePalette.contrastText,
    backgroundColor: color === 'default' ? theme.palette.text.primary : safePalette.main,
  };

  // Outlined variant
  const outlinedStyles = {
    color: color === 'default' ? theme.palette.text.primary : safePalette.main,
    backgroundColor: 'transparent',
    border: `2px solid ${color === 'default' ? alpha(theme.palette.grey[500], 0.32) : alpha(safePalette.main, 0.48)}`,
  };

  // Soft variant
  const softStyles = {
    color: color === 'default' ? theme.palette.text.secondary : isLight ? safePalette.dark : safePalette.light,
    backgroundColor: color === 'default' ? alpha(theme.palette.grey[500], 0.16) : alpha(safePalette.main, 0.16),
  };

  // Inverted variant (white background with colored text)
  const invertedStyles = {
    color: color === 'default' ? theme.palette.text.primary : safePalette.dark,
    backgroundColor: theme.palette.common.white,
    border: `1px solid ${alpha(theme.palette.grey[500], 0.16)}`,
    ...(paletteColor && {
      boxShadow: `inset 0 0 0 1px ${alpha(paletteColor.main, 0.24)}`,
    }),
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
export const Label = forwardRef<HTMLSpanElement, LabelProps>(function Label(
  { children, color = 'default', variant = 'soft', startIcon, endIcon, sx, disabled, ...other },
  ref
) {
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
});

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
