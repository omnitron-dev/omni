import type { Components, Theme } from '@mui/material/styles';
import { forwardRef } from 'react';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type { PrismIconComponent } from './context.js';
import { TableIcon } from '../components/editor/icons/index.js';
import * as I from './controls.js';

function gridIcon(Icon: PrismIconComponent) {
  return forwardRef<SVGSVGElement, Omit<SvgIconProps, 'color'> & { color?: string }>(function GridIcon(
    { color, ...props },
    ref
  ) {
    const palette =
      color === 'action' ||
      color === 'disabled' ||
      color === 'error' ||
      color === 'info' ||
      color === 'inherit' ||
      color === 'primary' ||
      color === 'secondary' ||
      color === 'success' ||
      color === 'warning';
    return <Icon {...props} ref={ref} color={palette ? color : 'inherit'} htmlColor={palette ? undefined : color} />;
  });
}
const grid = {
  MoreIcon: gridIcon(I.MoreIcon),
  ArrowUpIcon: gridIcon(I.ArrowUpIcon),
  ArrowDownIcon: gridIcon(I.ArrowDownIcon),
  FilterIcon: gridIcon(I.FilterIcon),
  TableIcon: gridIcon(TableIcon),
  DownloadIcon: gridIcon(I.DownloadIcon),
  CloseIcon: gridIcon(I.CloseIcon),
  SearchIcon: gridIcon(I.SearchIcon),
  AddIcon: gridIcon(I.AddIcon),
  RemoveIcon: gridIcon(I.RemoveIcon),
};

/** Public MUI slots keep native focus, keyboard and disabled-state behaviour. */
export function prismIconDefaults(): Components<Theme> {
  const icons = {
    MuiSelect: { defaultProps: { IconComponent: I.ChevronDownIcon } },
    MuiNativeSelect: { defaultProps: { IconComponent: I.ChevronDownIcon } },
    MuiAutocomplete: {
      defaultProps: { popupIcon: <I.ChevronDownIcon />, clearIcon: <I.CloseIcon fontSize="small" /> },
    },
    MuiRadio: { defaultProps: { icon: <I.RadioIcon />, checkedIcon: <I.RadioCheckedIcon /> } },
    MuiChip: { defaultProps: { deleteIcon: <I.CloseIcon /> } },
    MuiAlert: {
      defaultProps: {
        iconMapping: {
          success: <I.SuccessIcon />,
          info: <I.InfoIcon />,
          warning: <I.WarningIcon />,
          error: <I.ErrorIcon />,
        },
        slots: { closeIcon: I.CloseIcon },
      },
    },
    MuiPaginationItem: {
      defaultProps: {
        slots: { previous: I.ChevronLeftIcon, next: I.ChevronRightIcon, first: I.FirstPageIcon, last: I.LastPageIcon },
      },
    },
    MuiTablePagination: {
      defaultProps: {
        slots: {
          actions: {
            firstButtonIcon: I.FirstPageIcon,
            previousButtonIcon: I.ChevronLeftIcon,
            nextButtonIcon: I.ChevronRightIcon,
            lastButtonIcon: I.LastPageIcon,
          },
        },
      },
    },
    MuiTableSortLabel: { defaultProps: { IconComponent: I.ArrowDownIcon } },
    MuiBreadcrumbs: { defaultProps: { separator: <I.ChevronRightIcon fontSize="inherit" /> } },
    MuiRating: {
      defaultProps: { icon: <I.StarIcon fontSize="inherit" />, emptyIcon: <I.StarEmptyIcon fontSize="inherit" /> },
    },
    MuiTabs: {
      defaultProps: { slots: { startScrollButtonIcon: I.ChevronLeftIcon, endScrollButtonIcon: I.ChevronRightIcon } },
    },
    MuiDataGrid: {
      defaultProps: {
        slots: {
          columnMenuIcon: grid.MoreIcon,
          columnSortedAscendingIcon: grid.ArrowUpIcon,
          columnSortedDescendingIcon: grid.ArrowDownIcon,
          columnFilteredIcon: grid.FilterIcon,
          columnSelectorIcon: grid.TableIcon,
          exportIcon: grid.DownloadIcon,
          openFilterButtonIcon: grid.FilterIcon,
          quickFilterIcon: grid.SearchIcon,
          quickFilterClearIcon: grid.CloseIcon,
          detailPanelExpandIcon: grid.AddIcon,
          detailPanelCollapseIcon: grid.RemoveIcon,
        },
      },
    },
  } satisfies Components<Theme>;
  return icons;
}
