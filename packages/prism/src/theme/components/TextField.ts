/**
 * TextField Component Overrides
 *
 * Refined styling for text inputs based on Minimals patterns.
 * Uses MUI v7 class constants for type-safe selectors.
 *
 * @module @omnitron-dev/prism/theme/components/TextField
 */

import type { Theme, Components, ComponentsVariants, CSSObject } from '@mui/material/styles';
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
// VARIANT TYPE ALIASES
//
// Pulling the MUI ComponentsVariants shapes into local names keeps
// the exported variant arrays declaration-emit-portable — without
// them, TS infers a structural type that pulls every csstype property
// into the .d.ts and the build fails on "cannot be named without a
// reference to <CSS prop>".
// =============================================================================

type InputBaseVariantsT = NonNullable<ComponentsVariants<Theme>['MuiInputBase']>;
type OutlinedInputVariantsT = NonNullable<ComponentsVariants<Theme>['MuiOutlinedInput']>;
type FilledInputVariantsT = NonNullable<ComponentsVariants<Theme>['MuiFilledInput']>;

// =============================================================================
// REUSABLE STYLE + VARIANTS
//
// Mirrors the Minimals starter's split: each input flavour exposes a
// static `*Styles` object (color, focus, disabled, notch) and a
// `*Variants` array (conditional padding by `multiline`, `size`,
// `hiddenLabel`). The factory functions below stitch them into the
// final `Components<Theme>` objects. The split has three concrete
// benefits over an inline callback per styleOverride slot:
//
//   1. Variant rules ship through MUI's native `variants` API, so
//      MUI's styled engine generates the compound class (e.g.
//      `.MuiInputBase-input.{hash}.{ms.MuiOutlinedInput-input}` for
//      "input + multiline + outlined"). That's how MUI authors
//      conditional styles internally — same specificity tier, same
//      style-injection order — so we never lose the runtime race
//      that nested `&.X` selectors were prone to.
//   2. Padding constants for multiline collapse to a single
//      `{ padding: 0 }` instead of a `{ paddingTop, paddingBottom }`
//      pair: MUI's variant compositor zeroes the inner element
//      cleanly while the matching root-side variant supplies the
//      inset. No `!important` needed anywhere.
//   3. Other components (date-picker text inputs, autocomplete's
//      renderInput, custom search bars) can reuse `inputBaseStyles`
//      + `*Variants` instead of duplicating the matrix.
// =============================================================================

/**
 * Variant that zeroes ALL padding on the inner element of a
 * multiline input. The matching root-side variant (per flavour
 * below) restores the visible inset, so the textarea sits cleanly
 * inside the border without doubled vertical gaps.
 */
const multilineInputVariants: InputBaseVariantsT = [
  {
    props: (props: Record<string, unknown>) => !!props.multiline,
    style: { padding: 0 },
  },
];

// -----------------------------------------------------------------------------
// InputBase
// -----------------------------------------------------------------------------

export const inputBaseStyles = {
  root: (theme: Theme): CSSObject => ({
    '--disabled-color': theme.vars?.palette.action.disabled || theme.palette.action.disabled,
    ...getInputTypography(theme, ['lineHeight']),
    [`&.${inputBaseClasses.disabled}`]: {
      [`& .${inputAdornmentClasses.root} *`]: { color: 'var(--disabled-color)' },
    },
  }),
  input: (theme: Theme): CSSObject => ({
    ...getInputTypography(theme, ['fontSize', 'height', 'lineHeight']),
    '&:focus': { borderRadius: 'inherit' },
    '&::placeholder': {
      color: theme.vars?.palette.text.disabled || theme.palette.text.disabled,
      opacity: 1,
    },
  }),
};

export const inputBaseVariants: { root: InputBaseVariantsT; input: InputBaseVariantsT } = {
  // Root-side multiline padding (single-line keeps the inner one).
  // Mirrors the outlined/filled root variants so a bare InputBase
  // (no decorator variant) still renders consistent multiline
  // padding even when consumers swap variants.
  root: [
    {
      props: (props: Record<string, unknown>) => !!props.multiline,
      style: { ...INPUT_PADDING.base.medium },
    },
    {
      props: (props: Record<string, unknown>) => !!props.multiline && props.size === 'small',
      style: { ...INPUT_PADDING.base.small },
    },
  ],
  input: [
    {
      props: {},
      style: { ...INPUT_PADDING.base.medium },
    },
    {
      props: (props: Record<string, unknown>) => props.size === 'small',
      style: { ...INPUT_PADDING.base.small },
    },
  ],
};

/**
 * Create InputBase overrides.
 */
export function createInputBaseOverrides(_config: ComponentsConfig): Components<Theme>['MuiInputBase'] {
  return {
    styleOverrides: {
      root: ({ theme }) => ({
        ...inputBaseStyles.root(theme),
        variants: inputBaseVariants.root,
      }),
      input: ({ theme }) => ({
        ...inputBaseStyles.input(theme),
        variants: [...inputBaseVariants.input, ...multilineInputVariants],
      }),
    },
  };
}

// -----------------------------------------------------------------------------
// Input (standard variant — underline)
// -----------------------------------------------------------------------------

export const inputStyles = {
  root: (theme: Theme): CSSObject => ({
    '&::before': {
      borderBottomColor: varAlpha(getGreyChannel(theme), 0.2),
    },
    '&::after': {
      borderBottomColor: theme.vars?.palette.text.primary || theme.palette.text.primary,
    },
  }),
};

/**
 * Create Input (standard variant underline) overrides.
 */
export function createInputOverrides(_config: ComponentsConfig): Components<Theme>['MuiInput'] {
  return {
    styleOverrides: {
      root: ({ theme }) => inputStyles.root(theme),
    },
  };
}

// -----------------------------------------------------------------------------
// OutlinedInput
// -----------------------------------------------------------------------------

export const outlinedInputStyles = {
  root: (theme: Theme, borderRadius: number | string): CSSObject => ({
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
  notchedOutline: (theme: Theme): CSSObject => ({
    borderColor: varAlpha(getGreyChannel(theme), 0.2),
    transition: theme.transitions.create(['border-color'], {
      duration: theme.transitions.duration.shortest,
    }),
    // Align fieldset font-size with InputLabel (14px) so the legend
    // notch width (0.75em) matches the visually-scaled label exactly.
    fontSize: theme.typography.pxToRem(14),
    '& legend > span': { paddingInline: 3 },
  }),
};

export const outlinedInputVariants: { root: OutlinedInputVariantsT; input: OutlinedInputVariantsT } = {
  root: [
    {
      props: (props: Record<string, unknown>) => !!props.multiline,
      style: { ...INPUT_PADDING.outlined.medium },
    },
    {
      props: (props: Record<string, unknown>) => !!props.multiline && props.size === 'small',
      style: { ...INPUT_PADDING.outlined.small },
    },
  ],
  input: [
    {
      props: {},
      style: { ...INPUT_PADDING.outlined.medium },
    },
    {
      props: (props: Record<string, unknown>) => props.size === 'small',
      style: { ...INPUT_PADDING.outlined.small },
    },
  ],
};

/**
 * Create OutlinedInput overrides.
 */
export function createOutlinedInputOverrides(config: ComponentsConfig): Components<Theme>['MuiOutlinedInput'] {
  const { borderRadius } = config;

  return {
    styleOverrides: {
      root: ({ theme }) => ({
        ...outlinedInputStyles.root(theme, borderRadius),
        variants: outlinedInputVariants.root,
      }),
      input: {
        variants: [...outlinedInputVariants.input, ...multilineInputVariants],
      },
      notchedOutline: ({ theme }) => outlinedInputStyles.notchedOutline(theme),
    },
  };
}

// -----------------------------------------------------------------------------
// FilledInput
// -----------------------------------------------------------------------------

export const filledInputStyles = {
  root: (theme: Theme, borderRadius: number | string): CSSObject => {
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
};

export const filledInputVariants: { root: FilledInputVariantsT; input: FilledInputVariantsT } = {
  // FilledInput has an extra dimension: `hiddenLabel`. When the
  // label is hidden, the visible inset shrinks because there's no
  // label to clear, so a separate padding set applies.
  root: [
    {
      props: (props: Record<string, unknown>) => !!props.multiline,
      style: { ...INPUT_PADDING.filled.medium },
    },
    {
      props: (props: Record<string, unknown>) => !!props.multiline && props.size === 'small',
      style: { ...INPUT_PADDING.filled.small },
    },
    {
      props: (props: Record<string, unknown>) => !!props.multiline && !!props.hiddenLabel,
      style: { ...INPUT_PADDING.filled.mediumHidden },
    },
    {
      props: (props: Record<string, unknown>) =>
        !!props.multiline && !!props.hiddenLabel && props.size === 'small',
      style: { ...INPUT_PADDING.filled.smallHidden },
    },
  ],
  input: [
    {
      props: {},
      style: { ...INPUT_PADDING.filled.medium },
    },
    {
      props: (props: Record<string, unknown>) => props.size === 'small',
      style: { ...INPUT_PADDING.filled.small },
    },
    {
      props: (props: Record<string, unknown>) => !!props.hiddenLabel,
      style: { ...INPUT_PADDING.filled.mediumHidden },
    },
    {
      props: (props: Record<string, unknown>) =>
        !!props.hiddenLabel && props.size === 'small',
      style: { ...INPUT_PADDING.filled.smallHidden },
    },
  ],
};

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
      root: ({ theme }) => ({
        ...filledInputStyles.root(theme, borderRadius),
        variants: filledInputVariants.root,
      }),
      input: {
        variants: [...filledInputVariants.input, ...multilineInputVariants],
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
