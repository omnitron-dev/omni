/**
 * Tabs Component Overrides
 *
 * MUI v7 best practices: typed class selectors, ComponentsVariants,
 * density-aware sizing via shared getDensityMultiplier.
 *
 * @module @omnitron/prism/theme/components/Tabs
 */

import type { Theme, Components, ComponentsVariants } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';

import { tabClasses } from '@mui/material/Tab';
import { svgIconClasses } from '@mui/material/SvgIcon';
import { getDensityMultiplier } from './theme-utils.js';

// =============================================================================
// VARIANT TYPES
// =============================================================================

type TabsVariants = ComponentsVariants<Theme>['MuiTabs'];
type TabVariants = ComponentsVariants<Theme>['MuiTab'];

// =============================================================================
// VARIANTS
// =============================================================================

const tabsVariants = {
  root: [
    {
      props: (props: { indicatorColor?: string }) => props.indicatorColor === 'inherit',
      style: {
        '& .MuiTabs-indicator': {
          backgroundColor: 'currentColor',
        },
      },
    },
  ] satisfies TabsVariants,
  list: [
    {
      props: {},
      style: ({ theme }) => ({
        gap: theme.spacing(1),
      }),
    },
  ] satisfies TabsVariants,
};

const tabVariants = [
  {
    props: {},
    style: ({ theme }) => ({
      [`&.${tabClasses.selected}`]: {
        fontWeight: 600,
        color: theme.vars?.palette.text.primary || theme.palette.text.primary,
      },
    }),
  },
  {
    props: (props) => !!props.icon && !!props.label,
    style: {
      minHeight: 'auto',
    },
  },
] satisfies TabVariants;

// =============================================================================
// COMPONENT OVERRIDES
// =============================================================================

/**
 * Create Tabs overrides.
 * Density-aware compact dimensions with indicator styling.
 */
export function createTabsOverrides(config: ComponentsConfig): Components<Theme>['MuiTabs'] {
  const dm = getDensityMultiplier(config.density);

  return {
    defaultProps: {
      variant: 'scrollable',
      textColor: 'inherit',
      indicatorColor: 'primary',
      allowScrollButtonsMobile: true,
    },
    styleOverrides: {
      root: ({ theme }) => ({
        minHeight: 36 * dm,
        variants: [...tabsVariants.root],
      }),
      list: {
        variants: [...tabsVariants.list],
      },
      indicator: {
        borderRadius: 2,
      },
    },
  };
}

/**
 * Create Tab overrides.
 * Compact styling with typed class selectors for selected state and icon sizing.
 */
export function createTabOverrides(config: ComponentsConfig): Components<Theme>['MuiTab'] {
  const dm = getDensityMultiplier(config.density);

  return {
    defaultProps: {
      disableRipple: true,
      iconPosition: 'start',
    },
    styleOverrides: {
      root: ({ theme }) => ({
        padding: 8 * dm,
        minHeight: 36 * dm,
        minWidth: 36 * dm,
        opacity: 1,
        textTransform: 'none',
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.vars?.palette.text.secondary || theme.palette.text.secondary,
        lineHeight: theme.typography.body2.lineHeight,
        [`& .${svgIconClasses.root}`]: {
          fontSize: 20,
        },
        variants: [...tabVariants],
      }),
    },
  };
}
