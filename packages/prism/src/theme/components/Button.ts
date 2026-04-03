/**
 * Button Component Overrides
 *
 * MUI Button customization with custom variants: soft, dashed, shapes.
 *
 * @module @omnitron-dev/prism/theme/components/Button
 */

import type { Components, Theme, ButtonProps, ComponentsVariants } from '@mui/material';
import type { ComponentsConfig } from '../../types/theme.js';

import { buttonClasses } from '@mui/material/Button';

import { getDensityMultiplier } from './theme-utils.js';

// =============================================================================
// MODULE AUGMENTATION
// =============================================================================

declare module '@mui/material/Button' {
  interface ButtonPropsVariantOverrides {
    /** Soft variant - subtle background with colored text */
    soft: true;
    /** Dashed variant - dashed border */
    dashed: true;
  }

  interface ButtonPropsColorOverrides {
    /** Neutral color option */
    neutral: true;
  }

  interface ButtonPropsSizeOverrides {
    /** Extra-large size */
    xLarge: true;
  }

  interface ButtonOwnProps {
    /** Shape variant for icon buttons */
    shape?: 'square' | 'circle';
  }
}

// =============================================================================
// HELPERS
// =============================================================================

type PaletteColorKey = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';
type ButtonVariants = ComponentsVariants<Theme>['MuiButton'];

const btnColors: PaletteColorKey[] = ['primary', 'secondary', 'info', 'success', 'warning', 'error'];

// =============================================================================
// SOFT VARIANT
// =============================================================================

const softVariants = [
  ...btnColors.map((color) => ({
    props: { variant: 'soft' as const, color: color as ButtonProps['color'] },
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: `rgba(var(--prism-${color}-main-channel, 51 133 240) / 0.16)`,
      color: theme.vars?.palette[color]?.dark || theme.palette[color].dark,
      boxShadow: 'none',
      '&:hover': {
        backgroundColor: `rgba(var(--prism-${color}-main-channel, 51 133 240) / 0.32)`,
        boxShadow: 'none',
      },
      '&:active': {
        backgroundColor: `rgba(var(--prism-${color}-main-channel, 51 133 240) / 0.4)`,
      },
    }),
  })),
  // Neutral soft variant
  {
    props: { variant: 'soft' as const, color: 'neutral' as ButtonProps['color'] },
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: theme.vars?.palette.background.elevation2 || theme.palette.grey[100],
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
      boxShadow: 'none',
      '&:hover': {
        backgroundColor: theme.vars?.palette.background.elevation3 || theme.palette.grey[200],
        boxShadow: 'none',
      },
    }),
  },
  // Inherit soft variant
  {
    props: { variant: 'soft' as const, color: 'inherit' as ButtonProps['color'] },
    style: ({ theme }: { theme: Theme }) => ({
      backgroundColor: theme.vars?.palette.action.selected || theme.palette.action.selected,
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
      boxShadow: 'none',
      '&:hover': {
        backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
        boxShadow: 'none',
      },
    }),
  },
] satisfies ButtonVariants;

// =============================================================================
// DASHED VARIANT
// =============================================================================

const dashedVariants = [
  ...btnColors.map((color) => ({
    props: { variant: 'dashed' as const, color: color as ButtonProps['color'] },
    style: ({ theme }: { theme: Theme }) => ({
      border: `1px dashed ${theme.vars?.palette[color]?.main || theme.palette[color].main}`,
      backgroundColor: 'transparent',
      color: theme.vars?.palette[color]?.main || theme.palette[color].main,
      '&:hover': {
        backgroundColor: `rgba(var(--prism-${color}-main-channel, 51 133 240) / 0.08)`,
        borderColor: theme.vars?.palette[color]?.dark || theme.palette[color].dark,
      },
    }),
  })),
  // Inherit dashed variant
  {
    props: { variant: 'dashed' as const, color: 'inherit' as ButtonProps['color'] },
    style: ({ theme }: { theme: Theme }) => ({
      border: `1px dashed ${theme.vars?.palette.grey?.[500] || theme.palette.grey[500]}`,
      backgroundColor: 'transparent',
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
      '&:hover': {
        backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
        borderColor: theme.vars?.palette.text.primary || theme.palette.text.primary,
      },
    }),
  },
] satisfies ButtonVariants;

// =============================================================================
// SHAPE VARIANTS
// =============================================================================

const shapes = ['circle', 'square'] as const;
const shapeSizes: Record<string, number> = { small: 30, medium: 36, large: 42, xLarge: 52 };

const shapeVariants = shapes.flatMap((shape) =>
  Object.keys(shapeSizes).map((size) => ({
    props: { shape, size: size as ButtonProps['size'] },
    style: {
      height: shapeSizes[size],
      minWidth: shapeSizes[size],
      padding: 0,
      borderRadius: shape === 'circle' ? '50%' : undefined,
    },
  }))
) satisfies ButtonVariants;

// =============================================================================
// OUTLINED NEUTRAL VARIANT
// =============================================================================

const outlinedNeutralVariants = [
  {
    props: { variant: 'outlined' as const, color: 'neutral' as ButtonProps['color'] },
    style: ({ theme }: { theme: Theme }) => ({
      borderColor: theme.vars?.palette.divider || theme.palette.divider,
      color: theme.vars?.palette.text.primary || theme.palette.text.primary,
      '&:hover': {
        backgroundColor: theme.vars?.palette.background.elevation2 || theme.palette.grey[100],
        borderColor: theme.vars?.palette.text.secondary || theme.palette.text.secondary,
      },
    }),
  },
] satisfies ButtonVariants;

// =============================================================================
// DISABLED VARIANTS
// =============================================================================

const disabledVariants = [
  {
    props: { variant: 'soft' as const },
    style: ({ theme }: { theme: Theme }) => ({
      [`&.${buttonClasses.disabled}`]: {
        backgroundColor: theme.vars?.palette.action.disabledBackground || theme.palette.action.disabledBackground,
      },
    }),
  },
  {
    props: { variant: 'dashed' as const },
    style: ({ theme }: { theme: Theme }) => ({
      [`&.${buttonClasses.disabled}`]: {
        borderStyle: 'dashed',
      },
    }),
  },
] satisfies ButtonVariants;

// =============================================================================
// MAIN EXPORT
// =============================================================================

export function createButtonOverrides(config: ComponentsConfig): Components<Theme>['MuiButton'] {
  const { borderRadius, density } = config;
  const dm = getDensityMultiplier(density);

  const sizeVariants = [
    {
      props: { size: 'xLarge' as const },
      style: {
        minHeight: 56,
        fontSize: '15px',
        padding: `${10 * dm}px ${22 * dm}px`,
        lineHeight: 1.467,
      },
    },
  ] satisfies ButtonVariants;

  return {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        textTransform: 'none',
        fontSize: '14px',
        fontWeight: 600,
        borderRadius,
        padding: `${8 * dm}px ${16 * dm}px`,
        lineHeight: 1.429,
        variants: [
          ...softVariants,
          ...dashedVariants,
          ...shapeVariants,
          ...outlinedNeutralVariants,
          ...sizeVariants,
          ...disabledVariants,
        ],
      },
      sizeLarge: {
        fontSize: '16px',
        padding: `${10 * dm}px ${22 * dm}px`,
        lineHeight: 1.375,
      },
      sizeSmall: {
        padding: `${6 * dm}px ${10 * dm}px`,
        fontSize: '13px',
        lineHeight: 1.286,
      },
      outlinedSizeLarge: {
        paddingTop: 9 * dm,
        paddingBottom: 9 * dm,
      },
      outlinedSizeMedium: {
        paddingTop: 7 * dm,
        paddingBottom: 7 * dm,
      },
      outlinedSizeSmall: {
        paddingTop: 5 * dm,
        paddingBottom: 5 * dm,
      },
      startIcon: {
        marginRight: 4,
        [`& > *:first-of-type`]: {
          fontSize: 16,
        },
      },
      endIcon: {
        marginLeft: 4,
        [`& > *:first-of-type`]: {
          fontSize: 16,
        },
      },
    },
  };
}

export function createButtonBaseOverrides(): Components<Theme>['MuiButtonBase'] {
  return {
    defaultProps: {
      disableRipple: false,
    },
  };
}

export function createButtonGroupOverrides(config: ComponentsConfig): Components<Theme>['MuiButtonGroup'] {
  return {
    defaultProps: {
      disableElevation: true,
    },
    styleOverrides: {
      root: {
        borderRadius: config.borderRadius,
      },
    },
  };
}
