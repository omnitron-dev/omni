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
import { autocompleteClasses } from '@mui/material/Autocomplete';
import { svgIconClasses } from '@mui/material/SvgIcon';
import { tableRowClasses } from '@mui/material/TableRow';
import { tableCellClasses } from '@mui/material/TableCell';
import { stepIconClasses } from '@mui/material/StepIcon';
import { stepLabelClasses } from '@mui/material/StepLabel';
import { toggleButtonClasses } from '@mui/material/ToggleButton';
import { paginationItemClasses } from '@mui/material/PaginationItem';

import { getGreyChannel, getColorChannel, getDensityMultiplier } from './theme-utils.js';
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
            backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
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
    MuiAutocomplete: {
      styleOverrides: {
        paper: ({ theme }) => ({
          borderRadius,
          boxShadow: `0 0 2px 0 rgba(${getGreyChannel(theme)} / 0.24), -20px 20px 40px -4px rgba(${getGreyChannel(theme)} / 0.24)`,
        }),
        listbox: {
          padding: 4,
        },
        option: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          margin: 2,
          [`&.${autocompleteClasses.focused}`]: {
            backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
          },
          '&[aria-selected="true"]': {
            backgroundColor: theme.vars?.palette.action.selected || theme.palette.action.selected,
            fontWeight: 500,
            [`&.${autocompleteClasses.focused}`]: {
              backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
            },
          },
        }),
        popupIndicator: {
          [`& .${svgIconClasses.root}`]: {
            fontSize: 20,
          },
        },
        clearIndicator: {
          [`& .${svgIconClasses.root}`]: {
            fontSize: 18,
          },
        },
      },
    },

    // =========================================================================
    // CARDS
    // =========================================================================
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          position: 'relative',
          zIndex: 0, // Safari stacking context fix
          borderRadius: borderRadius * 1.5,
          border: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
          backgroundImage: 'none',
          boxShadow: `0 0 2px 0 rgba(${getGreyChannel(theme)} / 0.2), 0 12px 24px -4px rgba(${getGreyChannel(theme)} / 0.12)`,
        }),
      },
    },
    MuiCardHeader: {
      defaultProps: {
        titleTypographyProps: { variant: 'h6' },
        subheaderTypographyProps: { variant: 'body2' },
      },
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${20 * dm}px`,
        },
        title: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(16),
          fontWeight: 600,
          lineHeight: 1.5,
        }),
        subheader: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(14),
          lineHeight: 22 / 14,
          color: theme.vars?.palette.text.secondary || theme.palette.text.secondary,
        }),
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${20 * dm}px`,
          '&:last-child': {
            paddingBottom: 16 * dm,
          },
        },
      },
    },
    MuiCardActions: {
      styleOverrides: {
        root: {
          padding: `${12 * dm}px ${20 * dm}px`,
          gap: 8,
        },
      },
    },

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
    // DIALOGS
    // =========================================================================
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          boxShadow: `0 24px 48px -12px rgba(${getGreyChannel(theme, '900')} / 0.24)`,
          // Mobile-first: fullscreen on < sm (600px)
          [theme.breakpoints.down('sm')]: {
            margin: 0,
            width: '100% !important',
            maxWidth: 'none !important',
            maxHeight: 'none !important',
            height: '100%',
            borderRadius: '0 !important',
          },
          variants: [
            {
              props: (props: Record<string, unknown>) => !props.fullScreen,
              style: {
                borderRadius: borderRadius * 2,
                [theme.breakpoints.up('sm')]: {
                  margin: theme.spacing(2),
                },
              },
            },
          ],
        }),
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: `${20 * dm}px ${24 * dm}px`,
          fontSize: theme.typography.pxToRem(18),
          fontWeight: 600,
          lineHeight: 28 / 18,
        }),
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${24 * dm}px`,
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${24 * dm}px`,
          gap: 8,
        },
      },
    },

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
          borderBottom: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
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
          border: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
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
          color: theme.vars?.palette.text.secondary || theme.palette.text.secondary,
        }),
      },
    },
    MuiAccordionDetails: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: `${8 * dm}px ${16 * dm}px ${16 * dm}px`,
          borderTop: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
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
            color: theme.vars?.palette.text.primary || theme.palette.text.primary,
          },
          [`&.${stepLabelClasses.completed}`]: {
            fontWeight: 500,
            color: theme.vars?.palette.text.primary || theme.palette.text.primary,
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
          borderColor: theme.vars?.palette.divider || theme.palette.divider,
          borderTopWidth: 2,
        }),
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: ({ theme }) => ({
          color: theme.vars?.palette.grey?.[300] || theme.palette.grey[300],
          [`&.${stepIconClasses.active}`]: {
            color: theme.vars?.palette.primary.main || theme.palette.primary.main,
          },
          [`&.${stepIconClasses.completed}`]: {
            color: theme.vars?.palette.primary.main || theme.palette.primary.main,
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
          borderLeft: `2px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
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
          borderColor: theme.vars?.palette.divider || theme.palette.divider,
          [`&.${paginationItemClasses.selected}`]: {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            borderColor: theme.vars?.palette.primary.main || theme.palette.primary.main,
          },
        }),
        text: ({ theme }) => ({
          [`&.${paginationItemClasses.selected}`]: {
            backgroundColor: theme.vars?.palette.primary.main || theme.palette.primary.main,
            color: theme.vars?.palette.primary.contrastText || theme.palette.primary.contrastText,
            '&:hover': {
              backgroundColor: theme.vars?.palette.primary.dark || theme.palette.primary.dark,
            },
          },
        }),
        previousNext: ({ theme }) => ({
          borderRadius: borderRadius - 2,
          '&:hover': {
            backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
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
          backgroundColor: theme.vars?.palette.grey?.[800] || theme.palette.grey[800],
        }),
        arrow: ({ theme }) => ({
          color: theme.vars?.palette.grey?.[800] || theme.palette.grey[800],
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
            color: theme.vars?.palette.text.secondary || theme.palette.text.secondary,
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
        backIconButtonProps: { size: 'small' },
        nextIconButtonProps: { size: 'small' },
        slotProps: { select: { name: 'table-pagination-select' } },
      },
      styleOverrides: {
        root: ({ theme }) => ({
          borderTop: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
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
      styleOverrides: {
        root: {
          borderRadius,
        },
        standardSuccess: ({ theme }) => ({
          backgroundColor: `rgba(${getColorChannel(theme, 'success')} / 0.08)`,
          color: theme.vars?.palette.success.dark || theme.palette.success.dark,
        }),
        standardError: ({ theme }) => ({
          backgroundColor: `rgba(${getColorChannel(theme, 'error')} / 0.08)`,
          color: theme.vars?.palette.error.dark || theme.palette.error.dark,
        }),
        standardWarning: ({ theme }) => ({
          backgroundColor: `rgba(${getColorChannel(theme, 'warning')} / 0.08)`,
          color: theme.vars?.palette.warning.dark || theme.palette.warning.dark,
        }),
        standardInfo: ({ theme }) => ({
          backgroundColor: `rgba(${getColorChannel(theme, 'info')} / 0.08)`,
          color: theme.vars?.palette.info.dark || theme.palette.info.dark,
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
            color: theme.vars?.palette.action.disabled || theme.palette.action.disabled,
          },
        }),
        rail: ({ theme }) => ({
          opacity: 0.32,
          backgroundColor: theme.vars?.palette.grey?.[500] || theme.palette.grey[500],
        }),
        track: {
          border: 'none',
        },
        thumb: ({ theme }) => ({
          width: density === 'compact' ? 16 : 20,
          height: density === 'compact' ? 16 : 20,
          backgroundColor: theme.vars?.palette.common.white || theme.palette.common.white,
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
          backgroundColor: theme.vars?.palette.grey?.[800] || theme.palette.grey[800],
          '&::before': {
            display: 'none',
          },
        }),
        mark: ({ theme }) => ({
          width: 4,
          height: 4,
          borderRadius: '50%',
          backgroundColor: theme.vars?.palette.grey?.[400] || theme.palette.grey[400],
        }),
        markActive: ({ theme }) => ({
          backgroundColor: theme.vars?.palette.common.white || theme.palette.common.white,
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
          color: theme.vars?.palette.grey?.[300] || theme.palette.grey[300],
        }),
        iconFilled: ({ theme }) => ({
          color: theme.vars?.palette.warning.main || theme.palette.warning.main,
        }),
        iconHover: ({ theme }) => ({
          color: theme.vars?.palette.warning.dark || theme.palette.warning.dark,
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
            backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
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
            backgroundColor: theme.vars?.palette.action.selected || theme.palette.action.selected,
            '&:hover': {
              backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
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
          color: theme.vars?.palette.primary.main || theme.palette.primary.main,
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
          border: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
          [`&.${toggleButtonClasses.selected}`]: {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            borderColor: theme.vars?.palette.primary.main || theme.palette.primary.main,
            color: theme.vars?.palette.primary.main || theme.palette.primary.main,
            '&:hover': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.16)`,
            },
          },
          [`&.${toggleButtonClasses.disabled}`]: {
            borderColor: theme.vars?.palette.action.disabledBackground || theme.palette.action.disabledBackground,
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
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          gap: 4,
          '& .MuiToggleButton-root': {
            border: '1px solid',
            borderRadius: `${borderRadius}px !important`,
          },
        },
        grouped: {
          '&:not(:first-of-type)': {
            marginLeft: 0,
            borderLeft: '1px solid',
          },
        },
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
          borderColor: theme.vars?.palette.divider || theme.palette.divider,
          backgroundColor: 'transparent',
        }),
      },
    },
    MuiTimelineConnector: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          backgroundColor: theme.vars?.palette.divider || theme.palette.divider,
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
    // DATA GRID (MUI X)
    // =========================================================================
    MuiDataGrid: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          border: 'none',
          borderRadius,
          '--DataGrid-containerBackground': theme.vars?.palette.background.neutral || theme.palette.grey[50],
          '--DataGrid-pinnedBackground': theme.vars?.palette.background.paper || theme.palette.background.paper,
          '& .MuiDataGrid-columnHeaders': {
            borderBottom: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
          },
          '& .MuiDataGrid-columnHeader': {
            fontWeight: 600,
            fontSize: theme.typography.pxToRem(14),
            color: theme.vars?.palette.text.secondary || theme.palette.text.secondary,
            '&:focus, &:focus-within': {
              outline: 'none',
            },
          },
          '& .MuiDataGrid-cell': {
            borderBottom: `1px solid rgba(${getGreyChannel(theme)} / 0.12)`,
            '&:focus, &:focus-within': {
              outline: 'none',
            },
          },
          '& .MuiDataGrid-row': {
            '&:hover': {
              backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
            },
            '&.Mui-selected': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
              '&:hover': {
                backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.12)`,
              },
            },
          },
          '& .MuiDataGrid-footerContainer': {
            borderTop: `1px solid ${theme.vars?.palette.divider || theme.palette.divider}`,
          },
          '& .MuiDataGrid-selectedRowCount': {
            whiteSpace: 'nowrap',
          },
          '& .MuiDataGrid-toolbarContainer': {
            padding: theme.spacing(1.5, 1.5, 0.5),
            gap: theme.spacing(1),
          },
          '& .MuiDataGrid-columnSeparator': {
            color: theme.vars?.palette.divider || theme.palette.divider,
          },
        }),
      },
    },

    // =========================================================================
    // DATE/TIME PICKERS (MUI X)
    // =========================================================================
    MuiDatePicker: {
      defaultProps: {
        slotProps: {
          openPickerButton: {
            size: density === 'compact' ? 'small' : 'medium',
          },
        },
      },
    },
    MuiPickersLayout: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          '& .MuiPickersLayout-actionBar': {
            padding: theme.spacing(1, 2),
          },
        }),
      },
    },
    MuiPickersDay: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          borderRadius: borderRadius - 2,
          fontWeight: 400,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        }),
        today: ({ theme }: { theme: Theme }) => ({
          borderColor: theme.vars?.palette.primary.main || theme.palette.primary.main,
          '&:not(.Mui-selected)': {
            backgroundColor: 'transparent',
          },
        }),
      },
    },
    MuiPickersYear: {
      styleOverrides: {
        yearButton: ({ theme }: { theme: Theme }) => ({
          borderRadius,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        }),
      },
    },
    MuiPickersMonth: {
      styleOverrides: {
        monthButton: ({ theme }: { theme: Theme }) => ({
          borderRadius,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        }),
      },
    },

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
            backgroundColor: theme.vars?.palette.action.hover || theme.palette.action.hover,
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
