/**
 * Chip Component Overrides
 *
 * MUI Chip customization with custom variants: soft, dashed.
 * Follows MUI v7 best practices: chipClasses selectors, slot-based styleOverrides,
 * variants inside styleOverrides.root.
 *
 * @module @omnitron/prism/theme/components/Chip
 */

import type { Components, Theme, ChipProps, ComponentsVariants } from '@mui/material';
import type { ComponentsConfig } from '../../types/theme.js';

import { chipClasses } from '@mui/material/Chip';

import { getDensityMultiplier } from './theme-utils.js';

// =============================================================================
// MODULE AUGMENTATION
// =============================================================================

declare module '@mui/material/Chip' {
  interface ChipPropsVariantOverrides {
    /** Soft variant - subtle background with colored text */
    soft: true;
    /** Dashed variant - dashed border */
    dashed: true;
  }

  interface ChipPropsColorOverrides {
    /** Neutral color option */
    neutral: true;
  }

  interface ChipPropsSizeOverrides {
    /** Extra-small size */
    xSmall: true;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

type PaletteColorKey = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
const chipColors: PaletteColorKey[] = ['primary', 'secondary', 'info', 'success', 'warning', 'error'];

type ChipVariants = ComponentsVariants<Theme>['MuiChip'];

// =============================================================================
// SOFT VARIANT
// =============================================================================

const softVariants = [
  ...chipColors.map((color) => ({
    props: (props: ChipProps) => props.variant === 'soft' && props.color === color,
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: `rgba(var(--prism-${color}-main-channel, 51 133 240) / 0.16)`,
      color: theme.vars?.palette[color]?.dark || theme.palette[color].dark,
    }),
  })),
  // Neutral soft variant
  {
    props: (props: ChipProps) => props.variant === 'soft' && props.color === 'neutral',
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: theme.vars?.palette.background.elevation2 || theme.palette.grey[100],
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
    }),
  },
  // Default soft variant (no color specified)
  {
    props: (props: ChipProps) => props.variant === 'soft' && !props.color,
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: theme.vars?.palette.background.elevation2 || theme.palette.grey[100],
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
    }),
  },
] satisfies ChipVariants;

// =============================================================================
// DASHED VARIANT
// =============================================================================

const dashedVariants = [
  ...chipColors.map((color) => ({
    props: (props: ChipProps) => props.variant === 'dashed' && props.color === color,
    style: ({ theme }: { theme: Theme }) => ({
      border: `1px dashed ${theme.vars?.palette[color]?.main || theme.palette[color].main}`,
      backgroundColor: 'transparent',
      color: theme.vars?.palette[color]?.main || theme.palette[color].main,
    }),
  })),
  // Neutral dashed variant
  {
    props: (props: ChipProps) => props.variant === 'dashed' && props.color === 'neutral',
    style: ({ theme }: { theme: Theme }) => ({
      border: `1px dashed ${theme.vars?.palette.divider || theme.palette.divider}`,
      backgroundColor: 'transparent',
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
    }),
  },
] satisfies ChipVariants;

// =============================================================================
// OUTLINED NEUTRAL VARIANT
// =============================================================================

const outlinedNeutralVariant = [
  {
    props: (props: ChipProps) => props.variant === 'outlined' && props.color === 'neutral',
    style: ({ theme }: { theme: Theme }) => ({
      borderColor: theme.vars?.palette.divider || theme.palette.divider,
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
    }),
  },
] satisfies ChipVariants;

// =============================================================================
// FILLED NEUTRAL VARIANT
// =============================================================================

const filledNeutralVariant = [
  {
    props: (props: ChipProps) => props.variant === 'filled' && props.color === 'neutral',
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: theme.vars?.palette.grey[300] || theme.palette.grey[300],
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
    }),
  },
] satisfies ChipVariants;

// =============================================================================
// DISABLED VARIANTS
// =============================================================================

const disabledVariants = [
  {
    props: {},
    style: ({ theme }: { theme: Theme }) => ({
      [`&.${chipClasses.disabled}`]: {
        opacity: 1,
        color: theme.vars?.palette.action.disabled || theme.palette.action.disabled,
        [`&:not(.${chipClasses.outlined})`]: {
          backgroundColor: theme.vars?.palette.action.disabledBackground || theme.palette.action.disabledBackground,
        },
        [`&.${chipClasses.outlined}`]: {
          borderColor: theme.vars?.palette.action.disabledBackground || theme.palette.action.disabledBackground,
        },
      },
    }),
  },
] satisfies ChipVariants;

// =============================================================================
// XSMALL SIZE VARIANT
// =============================================================================

const xSmallVariant = [
  {
    props: { size: 'xSmall' as const },
    style: {
      height: 20,
      fontSize: '0.6875rem',
      padding: '0 6px',
    },
  },
] satisfies ChipVariants;

// =============================================================================
// MAIN EXPORT
// =============================================================================

export function createChipOverrides(config: ComponentsConfig): Components<Theme>['MuiChip'] {
  const { borderRadius, density } = config;
  const densityMultiplier = getDensityMultiplier(density);

  return {
    styleOverrides: {
      root: {
        borderRadius,
        fontWeight: 500,
        variants: [
          ...softVariants,
          ...dashedVariants,
          ...outlinedNeutralVariant,
          ...filledNeutralVariant,
          ...disabledVariants,
          ...xSmallVariant,
        ],
      },
      sizeSmall: {
        height: 24 * densityMultiplier,
      },
      sizeMedium: {
        height: 32 * densityMultiplier,
      },
      label: {
        fontWeight: 500,
      },
      labelSmall: {
        fontSize: '0.75rem',
        paddingLeft: 8,
        paddingRight: 8,
      },
      labelMedium: {
        fontSize: '0.8125rem',
        paddingLeft: 12,
        paddingRight: 12,
      },
      icon: {
        fontSize: 18,
        color: 'currentColor',
      },
      deleteIcon: {
        fontSize: 18,
        opacity: 0.48,
        color: 'currentColor',
        '&:hover': {
          opacity: 0.8,
          color: 'currentColor',
        },
      },
    },
  };
}
