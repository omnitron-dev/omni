/**
 * Component Overrides
 *
 * MUI component customizations for Prism themes.
 * Combines best practices from Minimals and Aurora templates.
 *
 * Key Features:
 * - Density-based spacing (compact/standard/comfortable)
 * - Custom variants (soft, dashed, shapes)
 * - Refined input styling with proper typography
 * - Custom checkbox/radio/switch icons
 * - Full CSS variable integration
 *
 * @module @omnitron-dev/prism/theme/components
 */

import type { Components, Theme } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';

import { iconButtonClasses } from '@mui/material/IconButton';
import { accordionClasses } from '@mui/material/Accordion';
import { accordionSummaryClasses } from '@mui/material/AccordionSummary';
import { tableRowClasses } from '@mui/material/TableRow';
import { tableCellClasses } from '@mui/material/TableCell';
import { stepIconClasses } from '@mui/material/StepIcon';
import { stepLabelClasses } from '@mui/material/StepLabel';
import { toggleButtonClasses } from '@mui/material/ToggleButton';
import { paginationItemClasses } from '@mui/material/PaginationItem';

import { getGreyChannel, getColorChannel, getDensityMultiplier, paletteVar } from './theme-utils.js';
import { createButtonOverrides, createButtonBaseOverrides, createButtonGroupOverrides } from './Button.js';
import { createChipOverrides } from './Chip.js';
import {
  createInputBaseOverrides,
  createInputOverrides,
  createOutlinedInputOverrides,
  createFilledInputOverrides,
  createTextFieldOverrides,
  createInputLabelOverrides,
  createFormHelperTextOverrides,
} from './TextField.js';
import {
  createCheckboxOverrides,
  createRadioOverrides,
  createSwitchOverrides,
  createFormControlLabelOverrides,
  createFormControlOverrides,
  createFormLabelOverrides,
} from './FormControls.js';
import { createTabsOverrides, createTabOverrides } from './Tabs.js';
import { createDialogOverrides } from './Dialog.js';
import { createCardOverrides } from './Card.js';
import { createAutocompleteOverrides } from './Autocomplete.js';
import { createDataGridOverrides } from './DataGrid.js';
import { createDatePickerOverrides } from './DatePicker.js';

// =============================================================================
// MAIN EXPORT
// =============================================================================

/**
 * Generate MUI component overrides based on configuration.
 * Combines best practices from Minimals (refined inputs, custom shadows)
 * and Aurora (compact dimensions, shape variants).
 *
 * @param config - Components configuration
 * @returns MUI components overrides
 */
export function componentOverrides(config: ComponentsConfig): Components<Theme> & Record<string, unknown> {
  const { density, borderRadius } = config;
  const dm = getDensityMultiplier(density);

  return {
    // =========================================================================
    // BUTTONS (Modular)
    // =========================================================================
    MuiButton: createButtonOverrides(config),
    MuiButtonBase: createButtonBaseOverrides(),
    MuiButtonGroup: createButtonGroupOverrides(config),

    // =========================================================================
    // ICON BUTTON
    // =========================================================================
    MuiIconButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius,
          '&:hover': {
            backgroundColor: paletteVar(theme, "action.hover"),
          },
        }),
      },
    },
    MuiInputAdornment: {
      styleOverrides: {
        root: {
          [`& .${iconButtonClasses.root}:hover`]: {
            backgroundColor: 'transparent',
          },
        },
      },
    },

    // =========================================================================
    // FAB
    // =========================================================================
    MuiFab: {
      defaultProps: {
        color: 'primary',
      },
      styleOverrides: {
        root: ({ theme }) => ({
          boxShadow: `0 8px 16px 0 rgba(${getColorChannel(theme, 'primary')} / 0.24)`,
          '&:hover': {
            boxShadow: `0 8px 16px 0 rgba(${getColorChannel(theme, 'primary')} / 0.32)`,
          },
        }),
      },
    },

    // =========================================================================
    // INPUTS (Refined - from Minimals patterns)
    // =========================================================================
    MuiInputBase: createInputBaseOverrides(config),
    MuiInput: createInputOverrides(config),
    MuiTextField: createTextFieldOverrides(config),
    MuiOutlinedInput: createOutlinedInputOverrides(config),
    MuiFilledInput: createFilledInputOverrides(config),
    MuiInputLabel: createInputLabelOverrides(config),
    MuiFormHelperText: createFormHelperTextOverrides(config),
    MuiSelect: {
      styleOverrides: {
        select: {
          // Reset minHeight so Select matches TextField height exactly.
          minHeight: 'auto',
          display: 'flex',
          alignItems: 'center',
        },
        icon: {
          right: 10,
          width: 18,
          height: 18,
          top: 'calc(50% - 9px)',
        },
      },
    },
    MuiNativeSelect: {
      styleOverrides: {
        icon: {
          right: 10,
          width: 18,
          height: 18,
          top: 'calc(50% - 9px)',
        },
      },
    },
    MuiAutocomplete: createAutocompleteOverrides(config),

    // =========================================================================
    // CARDS — modularized in ./Card.ts
    // =========================================================================
    ...createCardOverrides(config),

    // =========================================================================
    // PAPER & SURFACES
    // =========================================================================
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        rounded: {
          borderRadius: borderRadius * 1.5,
        },
        outlined: ({ theme }) => ({
          borderColor: `rgba(${getGreyChannel(theme)} / 0.16)`,
        }),
        elevation1: ({ theme }) => ({
          boxShadow: `0 1px 2px 0 rgba(${getGreyChannel(theme, '900')} / 0.08)`,
        }),
        elevation2: ({ theme }) => ({
          boxShadow: `0 2px 4px 0 rgba(${getGreyChannel(theme, '900')} / 0.08), 0 1px 2px 0 rgba(${getGreyChannel(theme, '900')} / 0.04)`,
        }),
        elevation3: ({ theme }) => ({
          boxShadow: `0 4px 8px 0 rgba(${getGreyChannel(theme, '900')} / 0.08), 0 2px 4px 0 rgba(${getGreyChannel(theme, '900')} / 0.04)`,
        }),
        elevation4: ({ theme }) => ({
          boxShadow: `0 8px 16px 0 rgba(${getGreyChannel(theme, '900')} / 0.08), 0 4px 8px 0 rgba(${getGreyChannel(theme, '900')} / 0.04)`,
        }),
        elevation5: ({ theme }) => ({
          boxShadow: `0 12px 24px -4px rgba(${getGreyChannel(theme, '900')} / 0.08), 0 8px 16px 0 rgba(${getGreyChannel(theme, '900')} / 0.04)`,
        }),
      },
    },

    // =========================================================================
    // DIALOGS — modularized in ./Dialog.ts
    // =========================================================================
    ...createDialogOverrides(config),

    // =========================================================================
    // NAVIGATION
    // =========================================================================
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
        },
      },
    },
    MuiAppBar: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundImage: 'none',
          borderBottom: `1px solid ${paletteVar(theme, "divider")}`,
        }),
      },
    },
    // Tabs (Refined - combining Aurora compact + Minimals indicators)
    MuiTabs: createTabsOverrides(config),
    MuiTab: createTabOverrides(config),
    MuiBreadcrumbs: {
      styleOverrides: {
        separator: {
          marginLeft: 8,
          marginRight: 8,
        },
      },
    },

    // =========================================================================
    // ACCORDION
    // =========================================================================
    MuiAccordion: {
      defaultProps: {
        disableGutters: true,
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          border: `1px solid ${paletteVar(theme, "divider")}`,
          borderRadius,
          '&::before': {
            display: 'none',
          },
          '&:first-of-type': {
            borderTopLeftRadius: borderRadius,
            borderTopRightRadius: borderRadius,
          },
          '&:last-of-type': {
            borderBottomLeftRadius: borderRadius,
            borderBottomRightRadius: borderRadius,
          },
          '&:not(:last-of-type)': {
            borderBottom: 0,
          },
          [`&.${accordionClasses.expanded}`]: {
            margin: 0,
            '&:first-of-type': { marginTop: 0 },
            '&:last-of-type': { marginBottom: 0 },
          },
          [`&.${accordionClasses.disabled}`]: {
            backgroundColor: 'transparent',
          },
        }),
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: ({ theme }) => ({
          minHeight: 48 * dm,
          padding: `0 ${16 * dm}px`,
          fontWeight: 500,
          [`&.${accordionSummaryClasses.expanded}`]: {
            minHeight: 48 * dm,
          },
          [`&.${accordionSummaryClasses.disabled}`]: {
            opacity: 0.5,
          },
        }),
        content: {
          margin: `${12 * dm}px 0`,
          [`&.${accordionSummaryClasses.expanded}`]: {
            margin: `${12 * dm}px 0`,
          },
        },
        expandIconWrapper: ({ theme }) => ({
          color: paletteVar(theme, "text.secondary"),
        }),
      },
    },
    MuiAccordionDetails: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: `${8 * dm}px ${16 * dm}px ${16 * dm}px`,
          borderTop: `1px solid ${paletteVar(theme, "divider")}`,
        }),
      },
    },

    // =========================================================================
    // STEPPER
    // =========================================================================
    MuiStep: {
      styleOverrides: {
        root: {
          padding: 0,
        },
      },
    },
    MuiStepLabel: {
      styleOverrides: {
        label: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(14),
          fontWeight: 500,
          [`&.${stepLabelClasses.active}`]: {
            fontWeight: 600,
            color: paletteVar(theme, "text.primary"),
          },
          [`&.${stepLabelClasses.completed}`]: {
            fontWeight: 500,
            color: paletteVar(theme, "text.primary"),
          },
        }),
        iconContainer: {
          paddingRight: 12 * dm,
        },
      },
    },
    MuiStepConnector: {
      styleOverrides: {
        line: ({ theme }) => ({
          borderColor: paletteVar(theme, "divider"),
          borderTopWidth: 2,
        }),
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: ({ theme }) => ({
          color: paletteVar(theme, "grey.300"),
          [`&.${stepIconClasses.active}`]: {
            color: paletteVar(theme, "primary.main"),
          },
          [`&.${stepIconClasses.completed}`]: {
            color: paletteVar(theme, "primary.main"),
          },
        }),
        text: {
          fontWeight: 600,
          fontSize: '0.75rem',
        },
      },
    },
    MuiStepContent: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderLeft: `2px solid ${paletteVar(theme, "divider")}`,
          marginLeft: 11,
          paddingLeft: 20,
          paddingRight: 8,
        }),
      },
    },

    // =========================================================================
    // PAGINATION
    // =========================================================================
    MuiPagination: {
      defaultProps: {
        shape: 'rounded',
        size: density === 'compact' ? 'small' : 'medium',
      },
    },
    MuiPaginationItem: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          fontWeight: 500,
          [`&.${paginationItemClasses.selected}`]: {
            fontWeight: 600,
          },
        }),
        outlined: ({ theme }) => ({
          borderColor: paletteVar(theme, "divider"),
          [`&.${paginationItemClasses.selected}`]: {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            borderColor: paletteVar(theme, "primary.main"),
          },
        }),
        text: ({ theme }) => ({
          [`&.${paginationItemClasses.selected}`]: {
            backgroundColor: paletteVar(theme, "primary.main"),
            color: paletteVar(theme, "primary.contrastText"),
            '&:hover': {
              backgroundColor: paletteVar(theme, "primary.dark"),
            },
          },
        }),
        previousNext: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          '&:hover': {
            backgroundColor: paletteVar(theme, "action.hover"),
          },
        }),
        firstLast: ({ theme }) => ({
          borderRadius: borderRadius - 2,
        }),
      },
    },

    // =========================================================================
    // DATA DISPLAY
    // =========================================================================
    MuiChip: createChipOverrides(config),
    MuiAvatar: {
      styleOverrides: {
        root: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(14),
          fontWeight: 600,
        }),
      },
    },
    MuiBadge: {
      styleOverrides: {
        badge: {
          fontWeight: 600,
        },
      },
    },
    MuiTooltip: {
      defaultProps: {
        arrow: true,
      },
      styleOverrides: {
        tooltip: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          fontSize: theme.typography.pxToRem(12),
          padding: '6px 12px',
          backgroundColor: paletteVar(theme, "grey.800"),
        }),
        arrow: ({ theme }) => ({
          color: paletteVar(theme, "grey.800"),
        }),
      },
    },

    // =========================================================================
    // TABLES
    // =========================================================================
    MuiTableContainer: {
      styleOverrides: {
        root: {
          position: 'relative',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: ({ theme }) => ({
          [`& .${tableCellClasses.head}`]: {
            fontWeight: 600,
            backgroundColor: theme.vars?.palette.background.neutral || theme.palette.grey[50],
            color: paletteVar(theme, "text.secondary"),
          },
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: `${12 * dm}px ${16 * dm}px`,
          borderBottomColor: `rgba(${getGreyChannel(theme)} / 0.2)`,
        }),
        sizeSmall: {
          padding: `${8 * dm}px ${12 * dm}px`,
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: ({ theme }) => ({
          [`&:last-child .${tableCellClasses.root}`]: {
            borderBottom: 'none',
          },
          [`&.${tableRowClasses.selected}`]: {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            '&:hover': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.12)`,
            },
          },
        }),
      },
    },
    MuiTablePagination: {
      defaultProps: {
        // MUI v9 removed `backIconButtonProps`/`nextIconButtonProps` —
        // both replaced by slotProps.
        slotProps: {
          select: { name: 'table-pagination-select' },
          actions: {
            previousButton: { size: 'small' },
            nextButton: { size: 'small' },
          },
        },
      },
      styleOverrides: {
        root: ({ theme }) => ({
          borderTop: `1px solid ${paletteVar(theme, "divider")}`,
        }),
        toolbar: {
          minHeight: 44 * dm,
          paddingLeft: 8 * dm,
          paddingRight: 8 * dm,
        },
        actions: {
          marginRight: 8,
        },
        select: {
          display: 'flex',
          alignItems: 'center',
        },
        selectIcon: {
          right: 4,
          width: 16,
          height: 16,
          top: 'calc(50% - 8px)',
        },
        selectLabel: ({ theme }) => ({
          ...theme.typography.body2,
        }),
        displayedRows: ({ theme }) => ({
          ...theme.typography.body2,
        }),
      },
    },

    // =========================================================================
    // FEEDBACK
    // =========================================================================
    MuiAlert: {
      // MUI v9: `standardSuccess`/`standardError`/`standardWarning`/
      // `standardInfo` slots were removed in favour of the variants
      // array (props-matched style rules).
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius,
          variants: (['success', 'error', 'warning', 'info'] as const).map(
            (severity) => ({
              props: { severity, variant: 'standard' },
              style: {
                backgroundColor: `rgba(${getColorChannel(theme, severity)} / 0.08)`,
                color:
                  theme.vars?.palette[severity].dark || theme.palette[severity].dark,
              },
            }),
          ),
        }),
      },
    },
    MuiAlertTitle: {
      // The title slot in Alert was unstyled — defaulted to MUI's
      // generic Typography preset and stuck out vs the Alert body
      // text, especially at compact density where 14/16 became
      // 13/14 around it. Pin to a slightly larger weight with the
      // alert's own colour inheritance.
      styleOverrides: {
        root: ({ theme }) => ({
          fontWeight: 600,
          fontSize: theme.typography.pxToRem(14),
          marginBottom: theme.spacing(0.5),
          lineHeight: 1.5,
        }),
      },
    },
    MuiSnackbar: {
      styleOverrides: {
        root: {
          '& .MuiPaper-root': {
            borderRadius,
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          height: 6,
        },
      },
    },
    MuiCircularProgress: {
      // Density-aware default size — the bare MUI default is 40px,
      // which dwarfs adornments / inline loaders at compact density.
      // Consumers can still override per-instance.
      defaultProps: {
        size: density === 'compact' ? 20 : density === 'comfortable' ? 32 : 24,
      },
    },

    // =========================================================================
    // SLIDER
    // =========================================================================
    MuiSlider: {
      defaultProps: {
        size: density === 'compact' ? 'small' : 'medium',
      },
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-disabled': {
            color: paletteVar(theme, "action.disabled"),
          },
        }),
        rail: ({ theme }) => ({
          opacity: 0.32,
          backgroundColor: paletteVar(theme, "grey.500"),
        }),
        track: {
          border: 'none',
        },
        thumb: ({ theme }) => ({
          width: density === 'compact' ? 16 : 20,
          height: density === 'compact' ? 16 : 20,
          backgroundColor: paletteVar(theme, "common.white"),
          border: '2px solid currentColor',
          boxShadow: `0 1px 3px 0 rgba(${getGreyChannel(theme, '900')} / 0.2)`,
          '&::before': {
            display: 'none',
          },
          '&:hover, &.Mui-focusVisible': {
            boxShadow: `0 0 0 8px rgba(${getColorChannel(theme, 'primary')} / 0.16)`,
          },
          '&.Mui-active': {
            boxShadow: `0 0 0 12px rgba(${getColorChannel(theme, 'primary')} / 0.24)`,
          },
        }),
        valueLabel: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          backgroundColor: paletteVar(theme, "grey.800"),
          '&::before': {
            display: 'none',
          },
        }),
        mark: ({ theme }) => ({
          width: 4,
          height: 4,
          borderRadius: '50%',
          backgroundColor: paletteVar(theme, "grey.400"),
        }),
        markActive: ({ theme }) => ({
          backgroundColor: paletteVar(theme, "common.white"),
        }),
      },
    },

    // =========================================================================
    // RATING
    // =========================================================================
    MuiRating: {
      defaultProps: {
        size: density === 'compact' ? 'small' : 'medium',
        emptyIcon: undefined, // Use default empty icon
      },
      styleOverrides: {
        root: ({ theme }) => ({
          '&.Mui-disabled': {
            opacity: 0.48,
          },
        }),
        icon: {
          fontSize: 'inherit',
        },
        iconEmpty: ({ theme }) => ({
          color: paletteVar(theme, "grey.300"),
        }),
        iconFilled: ({ theme }) => ({
          color: paletteVar(theme, "warning.main"),
        }),
        iconHover: ({ theme }) => ({
          color: paletteVar(theme, "warning.dark"),
        }),
        sizeSmall: {
          fontSize: '1.125rem',
        },
        sizeMedium: {
          fontSize: '1.5rem',
        },
        sizeLarge: {
          fontSize: '2rem',
        },
      },
    },

    // =========================================================================
    // FORMS (Refined - with custom icons)
    // =========================================================================
    MuiCheckbox: createCheckboxOverrides(config),
    MuiRadio: createRadioOverrides(config),
    MuiSwitch: createSwitchOverrides(config),
    MuiFormControl: createFormControlOverrides(config),
    MuiFormControlLabel: createFormControlLabelOverrides(config),
    MuiFormLabel: createFormLabelOverrides(config),

    // =========================================================================
    // LISTS
    // =========================================================================
    MuiList: {
      // Default MUI list padding is 8/0/8/0 — fine for spacious lists
      // but it stacks awkwardly with our ListItemButton's `margin: 2`
      // (the first/last buttons end up indented away from the
      // container edge). Density-aware top/bottom keeps the seam tight
      // while leaving the side at 0 so the row hover bleed reaches
      // the container border.
      styleOverrides: {
        root: {
          paddingTop: density === 'compact' ? 4 : 8,
          paddingBottom: density === 'compact' ? 4 : 8,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          margin: 2,
          '&.Mui-selected': {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            fontWeight: 500,
          },
          '&:hover': {
            backgroundColor: paletteVar(theme, "action.hover"),
          },
        }),
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          minWidth: 40,
        },
      },
    },
    MuiListItemText: {
      // Multiline rows (primary + secondary) inherited MUI defaults
      // that left an awkward 6px gap between the two lines at any
      // density. Tighten the inter-line gap and reduce horizontal
      // padding so dense rows actually FEEL dense.
      styleOverrides: {
        root: {
          marginTop: 0,
          marginBottom: 0,
        },
        primary: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(density === 'compact' ? 13 : 14),
          fontWeight: 500,
          lineHeight: 1.5,
        }),
        secondary: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(density === 'compact' ? 12 : 13),
          lineHeight: 1.5,
          color: paletteVar(theme, "text.secondary"),
        }),
      },
    },

    // =========================================================================
    // MENUS (Refined - with proper menu item styles)
    // =========================================================================
    MuiMenu: {
      styleOverrides: {
        paper: ({ theme }) => ({
          borderRadius,
          marginTop: 4,
          boxShadow: `0 0 2px 0 rgba(${getGreyChannel(theme)} / 0.24), -20px 20px 40px -4px rgba(${getGreyChannel(theme)} / 0.24)`,
        }),
        list: {
          padding: 4,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: ({ theme }) => ({
          ...theme.typography.body2,
          borderRadius: borderRadius - 2,
          margin: 2,
          padding: `${8 * dm}px ${12 * dm}px`,
          '&:not(:last-of-type)': {
            marginBottom: 4,
          },
          '&.Mui-selected': {
            fontWeight: 500,
            backgroundColor: paletteVar(theme, "action.selected"),
            '&:hover': {
              backgroundColor: paletteVar(theme, "action.hover"),
            },
          },
        }),
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: ({ theme }) => ({
          borderRadius,
          boxShadow: `0 0 2px 0 rgba(${getGreyChannel(theme)} / 0.24), -20px 20px 40px -4px rgba(${getGreyChannel(theme)} / 0.24)`,
        }),
      },
    },

    // =========================================================================
    // MISC
    // =========================================================================
    MuiDivider: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: `rgba(${getGreyChannel(theme)} / 0.2)`,
        }),
      },
    },
    MuiSkeleton: {
      styleOverrides: {
        rounded: {
          borderRadius,
        },
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: `rgba(${getGreyChannel(theme, '900')} / 0.5)`,
        }),
      },
    },

    // =========================================================================
    // LINK
    // =========================================================================
    MuiLink: {
      defaultProps: {
        underline: 'hover',
      },
      styleOverrides: {
        root: ({ theme }) => ({
          color: paletteVar(theme, "primary.main"),
          textDecorationColor: 'transparent',
          transition: 'color 150ms, text-decoration-color 150ms',
          '&:hover': {
            textDecorationColor: 'currentColor',
          },
        }),
      },
    },

    // =========================================================================
    // TOGGLE BUTTON
    // =========================================================================
    MuiToggleButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius,
          fontWeight: 500,
          textTransform: 'none' as const,
          border: `1px solid ${paletteVar(theme, "divider")}`,
          [`&.${toggleButtonClasses.selected}`]: {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            borderColor: paletteVar(theme, "primary.main"),
            color: paletteVar(theme, "primary.main"),
            '&:hover': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.16)`,
            },
          },
          [`&.${toggleButtonClasses.disabled}`]: {
            borderColor: paletteVar(theme, "action.disabledBackground"),
          },
        }),
        sizeSmall: {
          padding: `${4 * dm}px ${8 * dm}px`,
          fontSize: '0.8125rem',
        },
        sizeMedium: {
          padding: `${6 * dm}px ${12 * dm}px`,
        },
        sizeLarge: {
          padding: `${8 * dm}px ${16 * dm}px`,
          fontSize: '0.9375rem',
        },
      },
    },
    // The group only owns layout (gap, sibling border). Per-button
    // styling (border, radius, padding) is already covered by the
    // MuiToggleButton override above — the previous descendant
    // selector with `!important` here was redundant.
    //
    // The sibling-border explicitly carries the same `divider`
    // colour used by each button's own border, otherwise the
    // shorthand `1px solid` would fall back to `currentColor`
    // (text colour) and the first-of-type's left edge looked
    // brighter than the seams between subsequent buttons.
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          gap: 4,
        },
        grouped: ({ theme }) => ({
          '&:not(:first-of-type)': {
            marginLeft: 0,
            borderLeft: `1px solid ${paletteVar(theme, "divider")}`,
            // The MuiToggleButton override sets `borderColor: primary`
            // when selected via a longhand on the .selected class, but
            // that rule's specificity equals ours and MUI's
            // toggle-button-group styleOverrides land later in source
            // order — so the left edge stayed `divider` even after
            // selection. Re-state the primary colour inside our
            // selected branch so it wins on cascade (specificity here
            // is one class higher than the MuiToggleButton.selected
            // rule).
            [`&.${toggleButtonClasses.selected}`]: {
              borderLeftColor: paletteVar(theme, "primary.main"),
            },
          },
        }),
      },
    },

    // =========================================================================
    // TIMELINE
    // =========================================================================
    MuiTimeline: {
      styleOverrides: {
        root: {
          padding: 0,
        },
      },
    },
    MuiTimelineItem: {
      styleOverrides: {
        root: {
          '&::before': {
            display: 'none',
          },
        },
      },
    },
    MuiTimelineDot: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          boxShadow: 'none',
          borderColor: 'transparent',
          padding: 3,
        }),
        outlined: ({ theme }: { theme: Theme }) => ({
          borderColor: paletteVar(theme, "divider"),
          backgroundColor: 'transparent',
        }),
      },
    },
    MuiTimelineConnector: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          backgroundColor: paletteVar(theme, "divider"),
          width: 2,
        }),
      },
    },
    MuiTimelineContent: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          ...theme.typography.body2,
          padding: `${6 * dm}px ${16 * dm}px`,
        }),
      },
    },

    // =========================================================================
    // DATA GRID (MUI X) — modularized in ./DataGrid.ts
    // =========================================================================
    MuiDataGrid: createDataGridOverrides(config),

    // =========================================================================
    // DATE/TIME PICKERS (MUI X) — modularized in ./DatePicker.ts
    // =========================================================================
    ...createDatePickerOverrides(config),

    // =========================================================================
    // TREE VIEW (MUI X)
    // =========================================================================
    MuiTreeItem: {
      styleOverrides: {
        root: {
          // Default styling
        },
        content: ({ theme }: { theme: Theme }) => ({
          borderRadius: borderRadius - 2,
          padding: `${4 * dm}px ${8 * dm}px`,
          '&.Mui-selected': {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            '&:hover': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.16)`,
            },
            '&.Mui-focused': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.12)`,
            },
          },
          '&:hover': {
            backgroundColor: paletteVar(theme, "action.hover"),
          },
        }),
        label: ({ theme }: { theme: Theme }) => ({
          ...theme.typography.body2,
          fontWeight: 500,
        }),
        iconContainer: {
          width: 'auto',
        },
      },
    },

    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        html: {
          scrollBehavior: 'smooth',
        },
        body: {
          scrollbarWidth: 'thin',
          scrollbarColor: `rgba(${getGreyChannel(theme)} / 0.4) rgba(${getGreyChannel(theme)} / 0.08)`,
        },
        '*, *::before, *::after': {
          boxSizing: 'border-box',
        },
        '#root, #__next': {
          height: '100%',
        },
        // Webkit scrollbar styling
        '::-webkit-scrollbar': {
          width: 6,
          height: 6,
        },
        '::-webkit-scrollbar-track': {
          backgroundColor: 'transparent',
        },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: `rgba(${getGreyChannel(theme)} / 0.4)`,
          borderRadius: 3,
        },
        '::-webkit-scrollbar-thumb:hover': {
          backgroundColor: `rgba(${getGreyChannel(theme)} / 0.6)`,
        },
        // Vision Mode Accessibility Filters
        // These apply SVG color matrix filters to simulate color blindness
        'html[data-vision="protanopia"]:not([data-showcase])': {
          filter: 'url("#protanopia-filter")',
        },
        'html[data-vision="deuteranopia"]:not([data-showcase])': {
          filter: 'url("#deuteranopia-filter")',
        },
        'html[data-vision="tritanopia"]:not([data-showcase])': {
          filter: 'url("#tritanopia-filter")',
        },
        'html[data-vision="achromatopsia"]:not([data-showcase])': {
          filter: 'url("#achromatopsia-filter")',
        },
      }),
    },
  };
}
