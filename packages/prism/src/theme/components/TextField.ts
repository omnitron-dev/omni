/**
 * TextField Component Overrides
 *
 * Refined styling for text inputs based on Minimals patterns.
 * Uses MUI v7 class constants for type-safe selectors.
 *
 * @module @omnitron/prism/theme/components/TextField
 */

import type { Theme, Components, CSSObject } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';
import { varAlpha } from '../mixins.js';
import { getGreyChannel } from './theme-utils.js';

import { inputBaseClasses } from '@mui/material/InputBase';
import { outlinedInputClasses } from '@mui/material/OutlinedInput';
import { filledInputClasses } from '@mui/material/FilledInput';
import { inputAdornmentClasses } from '@mui/material/InputAdornment';
import { inputLabelClasses } from '@mui/material/InputLabel';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Input typography configuration.
 */
export const INPUT_TYPOGRAPHY = {
  fontSize: { base: 15, responsive: 16 },
  lineHeight: 24,
} as const;

/**
 * Input padding configuration for different variants and sizes.
 */
export const INPUT_PADDING: Record<string, Record<string, CSSObject>> = {
  base: {
    small: { paddingTop: 0, paddingBottom: 4 },
    medium: { paddingTop: 4, paddingBottom: 4 },
  },
  outlined: {
    small: { paddingTop: 8, paddingBottom: 8 },
    medium: { paddingTop: 16, paddingBottom: 16 },
  },
  filled: {
    small: { paddingTop: 20 },
    medium: { paddingTop: 24 },
    smallHidden: { paddingTop: 8, paddingBottom: 8 },
    mediumHidden: { paddingTop: 16, paddingBottom: 16 },
  },
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get input typography styles.
 */
export function getInputTypography(theme: Theme, keys: Array<'fontSize' | 'height' | 'lineHeight'>): CSSObject {
  const { fontSize, lineHeight } = INPUT_TYPOGRAPHY;

  const baseStyles = {
    fontSize: theme.typography.pxToRem(fontSize.base),
    height: `${lineHeight}px`,
    lineHeight: `${lineHeight}px`,
  };

  const responsiveStyles = {
    fontSize: theme.typography.pxToRem(fontSize.responsive),
    height: `${lineHeight}px`,
    lineHeight: `${lineHeight}px`,
  };

  return {
    ...Object.fromEntries(keys.map((k) => [k, baseStyles[k]])),
    [theme.breakpoints.down('sm')]: Object.fromEntries(keys.map((k) => [k, responsiveStyles[k]])),
  };
}

// =============================================================================
// COLOR CHANNEL HELPERS
// =============================================================================

/**
 * Safely access error channel from theme with fallback.
 */
function getErrorChannel(theme: Theme): string {
  const vars = theme.vars?.palette.error as Record<string, string> | undefined;
  return vars?.mainChannel ?? '208 34 65';
}

// =============================================================================
// COMPONENT OVERRIDES
// =============================================================================

/**
 * Create InputBase overrides.
 */
export function createInputBaseOverrides(_config: ComponentsConfig): Components<Theme>['MuiInputBase'] {
  return {
    styleOverrides: {
      root: ({ theme }) => ({
        '--disabled-color': theme.vars?.palette.action.disabled || theme.palette.action.disabled,
        ...getInputTypography(theme, ['lineHeight']),
        [`&.${inputBaseClasses.disabled}`]: {
          [`& .${inputAdornmentClasses.root} *`]: { color: 'var(--disabled-color)' },
        },
      }),
      input: ({ theme }) => ({
        ...getInputTypography(theme, ['fontSize', 'height', 'lineHeight']),
        '&:focus': { borderRadius: 'inherit' },
        '&::placeholder': {
          color: theme.vars?.palette.text.disabled || theme.palette.text.disabled,
          opacity: 1,
        },
      }),
    },
  };
}

/**
 * Create Input (standard variant underline) overrides.
 */
export function createInputOverrides(_config: ComponentsConfig): Components<Theme>['MuiInput'] {
  return {
    styleOverrides: {
      root: ({ theme }) => ({
        '&::before': {
          borderBottomColor: varAlpha(getGreyChannel(theme), 0.2),
        },
        '&::after': {
          borderBottomColor: theme.vars?.palette.text.primary || theme.palette.text.primary,
        },
      }),
    },
  };
}

/**
 * Create OutlinedInput overrides.
 */
export function createOutlinedInputOverrides(config: ComponentsConfig): Components<Theme>['MuiOutlinedInput'] {
  const { borderRadius } = config;

  return {
    styleOverrides: {
      root: ({ theme }) => ({
        borderRadius,
        [`&.${outlinedInputClasses.focused}:not(.${outlinedInputClasses.error})`]: {
          [`& .${outlinedInputClasses.notchedOutline}`]: {
            borderColor: theme.vars?.palette.text.primary || theme.palette.text.primary,
          },
        },
        [`&.${outlinedInputClasses.disabled}`]: {
          [`& .${outlinedInputClasses.notchedOutline}`]: {
            borderColor: theme.vars?.palette.action.disabledBackground || theme.palette.action.disabledBackground,
          },
        },
      }),
      input: {
        ...INPUT_PADDING.outlined.medium,
        '&.MuiInputBase-inputSizeSmall': {
          ...INPUT_PADDING.outlined.small,
        },
        '&.MuiInputBase-inputMultiline': {
          paddingTop: 0,
          paddingBottom: 0,
        },
      },
      notchedOutline: ({ theme }) => ({
        borderColor: varAlpha(getGreyChannel(theme), 0.2),
        transition: theme.transitions.create(['border-color'], {
          duration: theme.transitions.duration.shortest,
        }),
        // Align fieldset font-size with InputLabel (14px) so the legend
        // notch width (0.75em) matches the visually-scaled label exactly.
        fontSize: theme.typography.pxToRem(14),
        '& legend > span': { paddingInline: 3 },
      }),
    },
  };
}

/**
 * Create FilledInput overrides.
 */
export function createFilledInputOverrides(config: ComponentsConfig): Components<Theme>['MuiFilledInput'] {
  const { borderRadius } = config;

  return {
    defaultProps: {
      disableUnderline: true,
    },
    styleOverrides: {
      root: ({ theme }) => {
        const greyChannel = getGreyChannel(theme);
        const errChannel = getErrorChannel(theme);
        const baseBg = varAlpha(greyChannel, 0.08);
        const hoverBg = varAlpha(greyChannel, 0.16);
        const errorBg = varAlpha(errChannel, 0.08);
        const errorHoverBg = varAlpha(errChannel, 0.16);
        const disabledBg = theme.vars?.palette.action.disabledBackground || theme.palette.action.disabledBackground;

        return {
          backgroundColor: baseBg,
          borderRadius,
          [`&:hover, &.${filledInputClasses.focused}`]: { backgroundColor: hoverBg },
          [`&.${filledInputClasses.error}`]: {
            backgroundColor: errorBg,
            [`&:hover, &.${filledInputClasses.focused}`]: { backgroundColor: errorHoverBg },
          },
          [`&.${filledInputClasses.disabled}`]: { backgroundColor: disabledBg },
        };
      },
      input: {
        ...INPUT_PADDING.filled.medium,
        '&.MuiInputBase-inputSizeSmall': {
          ...INPUT_PADDING.filled.small,
        },
        '&.MuiInputBase-inputMultiline': {
          paddingTop: 0,
          paddingBottom: 0,
        },
      },
    },
  };
}

/**
 * Create TextField overrides.
 */
export function createTextFieldOverrides(config: ComponentsConfig): Components<Theme>['MuiTextField'] {
  return {
    defaultProps: {
      variant: 'outlined',
      size: config.density === 'compact' ? 'small' : 'medium',
    },
  };
}

/**
 * Create InputLabel overrides with shrink variants.
 */
export function createInputLabelOverrides(_config: ComponentsConfig): Components<Theme>['MuiInputLabel'] {
  return {
    styleOverrides: {
      root: ({ theme }) => ({
        fontSize: theme.typography.pxToRem(14),
        lineHeight: 1.5,
        variants: [
          {
            props: (props: Record<string, unknown>) => !props.shrink,
            style: {
              ...getInputTypography(theme, ['fontSize', 'lineHeight']),
              color: theme.vars?.palette.text.disabled || theme.palette.text.disabled,
            },
          },
          {
            props: (props: Record<string, unknown>) => !!props.shrink,
            style: {
              fontWeight: 600,
              [`&.${inputLabelClasses.focused}:not(.${inputLabelClasses.error})`]: {
                color: 'inherit',
              },
            },
          },
        ],
      }),
    },
  };
}

/**
 * Create FormHelperText overrides with flex layout for icon support.
 */
export function createFormHelperTextOverrides(_config: ComponentsConfig): Components<Theme>['MuiFormHelperText'] {
  return {
    defaultProps: {
      component: 'div',
    },
    styleOverrides: {
      root: ({ theme }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing(0.5),
        marginTop: theme.spacing(0.75),
        fontSize: theme.typography.pxToRem(12),
        lineHeight: 1.5,
        '& > svg': { width: 16, height: 16 },
      }),
    },
  };
}
