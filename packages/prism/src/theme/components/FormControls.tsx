/**
 * Form Control Component Overrides
 *
 * Refined styling for Checkbox, Radio, Switch, and FormLabel with custom icons.
 * Based on Minimals template patterns with MUI v7 best practices.
 *
 * @module @omnitron-dev/prism/theme/components/FormControls
 */

import * as React from 'react';
import type { Theme, Components, ComponentsVariants } from '@mui/material/styles';
import SvgIcon from '@mui/material/SvgIcon';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import { checkboxClasses } from '@mui/material/Checkbox';
import { radioClasses } from '@mui/material/Radio';
import { switchClasses } from '@mui/material/Switch';
import { formLabelClasses } from '@mui/material/FormLabel';
import type { ComponentsConfig } from '../../types/theme.js';
import { getGreyChannel } from './theme-utils.js';
import { varAlpha } from '../mixins.js';

// =============================================================================
// CUSTOM ICONS
// =============================================================================

/**
 * Checkbox unchecked icon.
 */
export function CheckboxIcon(props: SvgIconProps): React.ReactNode {
  return (
    <SvgIcon {...props}>
      <path d="M17.9 2.318A5 5 0 0 1 22.895 7.1l.005.217v10a5 5 0 0 1-4.783 4.995l-.217.005h-10a5 5 0 0 1-4.995-4.783l-.005-.217v-10a5 5 0 0 1 4.783-4.996l.217-.004h10Zm-.5 1.5h-9a4 4 0 0 0-4 4v9a4 4 0 0 0 4 4h9a4 4 0 0 0 4-4v-9a4 4 0 0 0-4-4Z" />
    </SvgIcon>
  );
}

/**
 * Checkbox checked icon.
 */
export function CheckboxCheckedIcon(props: SvgIconProps): React.ReactNode {
  return (
    <SvgIcon {...props}>
      <path d="M17 2a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm-1.625 7.255-4.13 4.13-1.75-1.75a.881.881 0 0 0-1.24 0c-.34.34-.34.89 0 1.24l2.38 2.37c.17.17.39.25.61.25.23 0 .45-.08.62-.25l4.75-4.75c.34-.34.34-.89 0-1.24a.881.881 0 0 0-1.24 0Z" />
    </SvgIcon>
  );
}

/**
 * Checkbox indeterminate icon.
 */
export function CheckboxIndeterminateIcon(props: SvgIconProps): React.ReactNode {
  return (
    <SvgIcon {...props}>
      <path d="M17,2 C19.7614,2 22,4.23858 22,7 L22,7 L22,17 C22,19.7614 19.7614,22 17,22 L17,22 L7,22 C4.23858,22 2,19.7614 2,17 L2,17 L2,7 C2,4.23858 4.23858,2 7,2 L7,2 Z M15,11 L9,11 C8.44772,11 8,11.4477 8,12 C8,12.5523 8.44772,13 9,13 L15,13 C15.5523,13 16,12.5523 16,12 C16,11.4477 15.5523,11 15,11 Z" />
    </SvgIcon>
  );
}

// =============================================================================
// SWITCH DIMENSIONS
// =============================================================================

const SWITCH_DIMENSIONS: Record<
  'small' | 'medium',
  { thumb: number; track: number; trackRadius: number; translateX: string }
> = {
  small: { thumb: 10, track: 16, trackRadius: 8, translateX: '10px' },
  medium: { thumb: 14, track: 20, trackRadius: 10, translateX: '14px' },
};

// =============================================================================
// SWITCH VARIANT DEFINITIONS
// =============================================================================

type SwitchVariants = ComponentsVariants<Theme>['MuiSwitch'];

const switchColorVariants = [
  {
    props: (props) => props.color === 'default',
    style: ({ theme }) => ({
      [`&.${switchClasses.checked}`]: {
        [`& + .${switchClasses.track}`]: {
          backgroundColor: theme.vars?.palette.text.primary,
        },
        [`& .${switchClasses.thumb}`]: {
          ...theme.applyStyles('dark', {
            color: theme.vars?.palette.grey[800],
          }),
        },
      },
    }),
  },
] satisfies SwitchVariants;

const switchCheckedVariants = [
  {
    props: {},
    style: {
      [`&.${switchClasses.checked}`]: {
        transform: `translateX(${SWITCH_DIMENSIONS.medium.translateX})`,
        [`& + .${switchClasses.track}`]: {
          opacity: 1,
        },
      },
    },
  },
] satisfies SwitchVariants;

const switchDisabledVariants = [
  {
    props: {},
    style: ({ theme }) => ({
      [`&.${switchClasses.disabled}`]: {
        [`& + .${switchClasses.track}`]: {
          opacity: 0.48,
        },
        [`& .${switchClasses.thumb}`]: {
          ...theme.applyStyles('dark', {
            opacity: 0.48,
          }),
        },
      },
    }),
  },
] satisfies SwitchVariants;

const switchSizeVariants = [
  {
    props: (props) => props.size === 'small',
    style: {
      [`& .${switchClasses.switchBase}`]: {
        [`&.${switchClasses.checked}`]: {
          transform: `translateX(${SWITCH_DIMENSIONS.small.translateX})`,
        },
      },
      [`& .${switchClasses.thumb}`]: {
        width: SWITCH_DIMENSIONS.small.thumb,
        height: SWITCH_DIMENSIONS.small.thumb,
      },
      [`& .${switchClasses.track}`]: {
        height: SWITCH_DIMENSIONS.small.track,
        borderRadius: SWITCH_DIMENSIONS.small.trackRadius,
      },
    },
  },
] satisfies SwitchVariants;

// =============================================================================
// COMPONENT OVERRIDES
// =============================================================================

/**
 * Create Checkbox overrides with custom icons.
 * Uses MUI v7 variants inside styleOverrides.root and class constants.
 */
export function createCheckboxOverrides(config: ComponentsConfig): Components<Theme>['MuiCheckbox'] {
  return {
    defaultProps: {
      size: config.density === 'compact' ? 'small' : 'medium',
      icon: <CheckboxIcon />,
      checkedIcon: <CheckboxCheckedIcon />,
      indeterminateIcon: <CheckboxIndeterminateIcon />,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        padding: theme.spacing(1),
        variants: [
          {
            props: (props) => props.color === 'default',
            style: {
              [`&.${checkboxClasses.checked}`]: {
                color: theme.vars?.palette.text.primary,
              },
            },
          },
          ...(['primary', 'secondary', 'info', 'success', 'warning', 'error'] as const).map((color) => ({
            props: { color },
            style: {
              '&:hover': {
                backgroundColor: varAlpha(
                  (theme.vars?.palette[color] as { mainChannel?: string })?.mainChannel ?? '51 133 240',
                  0.12
                ),
              },
            },
          })),
        ],
      }),
      sizeSmall: {
        '& svg': { fontSize: 16 },
      },
      sizeMedium: {
        '& svg': { fontSize: 20 },
      },
    },
  };
}

/**
 * Create Radio overrides.
 * Uses radioClasses constants and color === 'default' variant per reference.
 */
export function createRadioOverrides(config: ComponentsConfig): Components<Theme>['MuiRadio'] {
  return {
    defaultProps: {
      size: config.density === 'compact' ? 'small' : 'medium',
    },
    styleOverrides: {
      root: ({ theme }) => ({
        padding: theme.spacing(1),
        variants: [
          {
            props: (props) => props.color === 'default',
            style: {
              [`&.${radioClasses.checked}`]: {
                color: theme.vars?.palette.text.primary,
              },
            },
          },
        ],
      }),
    },
  };
}

/**
 * Create Switch overrides with refined styling.
 * Uses switchClasses constants, variants on switchBase slot, and size variants on root.
 */
export function createSwitchOverrides(config: ComponentsConfig): Components<Theme>['MuiSwitch'] {
  return {
    defaultProps: {
      size: config.density === 'compact' ? 'small' : 'medium',
    },
    styleOverrides: {
      root: {
        alignItems: 'center',
        variants: [...switchSizeVariants],
      },
      switchBase: {
        top: 'auto',
        left: '6px',
        variants: [...switchColorVariants, ...switchCheckedVariants, ...switchDisabledVariants],
      },
      thumb: ({ theme }) => ({
        width: SWITCH_DIMENSIONS.medium.thumb,
        height: SWITCH_DIMENSIONS.medium.thumb,
        color: theme.vars?.palette.common.white,
      }),
      track: ({ theme }) => ({
        height: SWITCH_DIMENSIONS.medium.track,
        borderRadius: SWITCH_DIMENSIONS.medium.trackRadius,
        backgroundColor: varAlpha(getGreyChannel(theme), 0.48),
        opacity: 1,
      }),
    },
  };
}

/**
 * Create FormLabel overrides.
 * Applies label styles to Checkbox, RadioGroup, Switch.
 */
export function createFormLabelOverrides(_config: ComponentsConfig): Components<Theme>['MuiFormLabel'] {
  return {
    styleOverrides: {
      root: ({ theme }) => ({
        [`&.${formLabelClasses.disabled}`]: {
          color: theme.vars?.palette.action.disabled,
        },
        variants: [
          {
            props: (props) => !props.error,
            style: {
              [`&.${formLabelClasses.focused}`]: {
                color: theme.vars?.palette.text.secondary,
              },
            },
          },
        ],
      }),
    },
  };
}

/**
 * Create FormControlLabel overrides.
 */
export function createFormControlLabelOverrides(_config: ComponentsConfig): Components<Theme>['MuiFormControlLabel'] {
  return {
    styleOverrides: {
      label: ({ theme }) => ({
        ...theme.typography.body2,
      }),
    },
  };
}

/**
 * Create FormControl overrides.
 */
export function createFormControlOverrides(_config: ComponentsConfig): Components<Theme>['MuiFormControl'] {
  return {
    defaultProps: {
      variant: 'outlined',
    },
    styleOverrides: {
      root: {
        '& .MuiFormLabel-root': {
          marginBottom: 8,
        },
      },
    },
  };
}
