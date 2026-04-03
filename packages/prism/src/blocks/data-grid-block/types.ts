/**
 * DataGrid Block Types
 *
 * Type definitions for the advanced data grid block component.
 *
 * @module @omnitron/prism/blocks/data-grid-block/types
 */

import type { ReactNode, MouseEvent } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import type {
  GridColDef,
  GridRowsProp,
  GridRowParams,
  GridRowSelectionModel,
  GridPaginationModel,
  GridSortModel,
  GridFilterModel,
  GridCallbackDetails,
  GridSlots,
  GridSlotProps,
  GridDensity,
  GridRowId,
} from '@mui/x-data-grid';

// =============================================================================
// ROW ACTIONS
// =============================================================================

/**
 * Row action item configuration.
 */
export interface DataGridRowAction<R = Record<string, unknown>> {
  /** Unique action key */
  key: string;
  /** Action label */
  label: string;
  /** Action icon */
  icon?: ReactNode;
  /** Color variant */
  color?: 'inherit' | 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning';
  /** Disabled state or function */
  disabled?: boolean | ((row: R) => boolean);
  /** Hidden state or function */
  hidden?: boolean | ((row: R) => boolean);
  /** Divider after this action */
  divider?: boolean;
  /** Click handler */
  onClick: (row: R, event: MouseEvent<HTMLElement>) => void;
}

// =============================================================================
// TOOLBAR
// =============================================================================

/**
 * Quick filter configuration.
 */
export interface QuickFilterConfig {
  /** Enable quick filter */
  enabled?: boolean;
  /** Placeholder text */
  placeholder?: string;
  /** Debounce delay in ms */
  debounceMs?: number;
}

/**
 * Export configuration.
 */
export interface ExportConfig {
  /** Enable CSV export */
  csv?: boolean;
  /** Enable Excel export (requires premium) */
  excel?: boolean;
  /** Enable print */
  print?: boolean;
  /** Custom file name */
  fileName?: string;
}

/**
 * Column visibility configuration.
 */
export interface ColumnVisibilityConfig {
  /** Enable column visibility panel */
  enabled?: boolean;
  /** Default visibility model */
  defaultModel?: Record<string, boolean>;
}

/**
 * Toolbar configuration.
 */
export interface DataGridToolbarConfig {
  /** Show toolbar */
  show?: boolean;
  /** Quick filter config */
  quickFilter?: QuickFilterConfig;
  /** Export config */
  export?: ExportConfig;
  /** Column visibility config */
  columnVisibility?: ColumnVisibilityConfig;
  /** Density selector */
  densitySelector?: boolean;
  /** Custom toolbar actions */
  actions?: ReactNode;
  /** Custom toolbar content (left side) */
  startContent?: ReactNode;
  /** Custom toolbar content (right side) */
  endContent?: ReactNode;
}

// =============================================================================
// PAGINATION
// =============================================================================

/**
 * Pagination configuration.
 */
export interface DataGridPaginationConfig {
  /** Pagination mode */
  mode?: 'client' | 'server';
  /** Page size options */
  pageSizeOptions?: number[];
  /** Default page size */
  defaultPageSize?: number;
  /** Total row count (for server-side pagination) */
  rowCount?: number;
  /** Hide pagination */
  hide?: boolean;
}

// =============================================================================
// SELECTION
// =============================================================================

/**
 * Selection configuration.
 */
export interface DataGridSelectionConfig {
  /** Enable row selection */
  enabled?: boolean;
  /** Selection mode */
  mode?: 'single' | 'multiple';
  /** Checkbox selection */
  checkboxSelection?: boolean;
  /** Keep non-existent rows selected */
  keepNonExistentRowsSelected?: boolean;
  /** Disable selection on click */
  disableSelectionOnClick?: boolean;
}

// =============================================================================
// EMPTY STATE
// =============================================================================

/**
 * Empty state configuration.
 */
export interface DataGridEmptyConfig {
  /** Empty state icon */
  icon?: ReactNode;
  /** Empty state title */
  title?: string;
  /** Empty state description */
  description?: string;
  /** Custom empty component */
  component?: ReactNode;
  /** Action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

// =============================================================================
// MAIN PROPS
// =============================================================================

/**
 * DataGridBlock props.
 */
export interface DataGridBlockProps<R extends Record<string, unknown> = Record<string, unknown>> {
  /** Column definitions */
  columns: GridColDef<R>[];
  /** Row data */
  rows: GridRowsProp<R>;
  /** Loading state */
  loading?: boolean;
  /** Error state */
  error?: boolean;
  /** Error message */
  errorMessage?: string;
  /** Retry handler */
  onRetry?: () => void;
  /** Row actions */
  rowActions?: DataGridRowAction<R>[];
  /** Row actions column width */
  rowActionsWidth?: number;
  /** Toolbar configuration */
  toolbar?: DataGridToolbarConfig;
  /** Pagination configuration */
  pagination?: DataGridPaginationConfig;
  /** Selection configuration */
  selection?: DataGridSelectionConfig;
  /** Empty state configuration */
  empty?: DataGridEmptyConfig;
  /** Density */
  density?: GridDensity;
  /** Auto height */
  autoHeight?: boolean;
  /** Fixed height */
  height?: number | string;
  /** Hide footer */
  hideFooter?: boolean;
  /** Row height */
  rowHeight?: number;
  /** Get row id */
  getRowId?: (row: R) => GridRowId;
  /** Row click handler */
  onRowClick?: (params: GridRowParams<R>) => void;
  /** Row double click handler */
  onRowDoubleClick?: (params: GridRowParams<R>) => void;
  /** Selection change handler */
  onSelectionChange?: (selection: GridRowSelectionModel) => void;
  /** Pagination change handler */
  onPaginationChange?: (model: GridPaginationModel) => void;
  /** Sort change handler */
  onSortChange?: (model: GridSortModel) => void;
  /** Filter change handler */
  onFilterChange?: (model: GridFilterModel) => void;
  /** Controlled pagination model */
  paginationModel?: GridPaginationModel;
  /** Controlled sort model */
  sortModel?: GridSortModel;
  /** Controlled filter model */
  filterModel?: GridFilterModel;
  /** Controlled selection model */
  selectionModel?: GridRowSelectionModel;
  /** Column visibility model */
  columnVisibilityModel?: Record<string, boolean>;
  /** Column visibility change handler */
  onColumnVisibilityChange?: (model: Record<string, boolean>) => void;
  /** Custom slots */
  slots?: Partial<GridSlots>;
  /** Custom slot props */
  slotProps?: GridSlotProps;
  /** Disable column menu */
  disableColumnMenu?: boolean;
  /** Disable column filter */
  disableColumnFilter?: boolean;
  /** Disable column selector */
  disableColumnSelector?: boolean;
  /** Disable row selection on click */
  disableRowSelectionOnClick?: boolean;
  /** Disable virtualization */
  disableVirtualization?: boolean;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

// =============================================================================
// CONTEXT
// =============================================================================

/**
 * DataGridBlock context value.
 */
export interface DataGridBlockContextValue {
  /** Current loading state */
  loading: boolean;
  /** Current error state */
  error: boolean;
  /** Current density */
  density: GridDensity;
  /** Set density */
  setDensity: (density: GridDensity) => void;
  /** Current row count */
  rowCount: number;
  /** Selected row count */
  selectedCount: number;
  /** Refresh data */
  refresh?: () => void;
}

// =============================================================================
// HOOK TYPES
// =============================================================================

/**
 * useDataGridBlock options.
 */
export interface UseDataGridBlockOptions<R = Record<string, unknown>> {
  /** Data fetcher function */
  fetcher: (params: DataGridFetchParams) => Promise<DataGridFetchResult<R>>;
  /** Initial page size */
  initialPageSize?: number;
  /** Initial sort model */
  initialSortModel?: GridSortModel;
  /** Initial filter model */
  initialFilterModel?: GridFilterModel;
  /** Auto fetch on mount */
  autoFetch?: boolean;
  /** Keep previous data while loading */
  keepPreviousData?: boolean;
}

/**
 * Fetch parameters passed to the fetcher function.
 */
export interface DataGridFetchParams {
  /** Current page (0-indexed) */
  page: number;
  /** Page size */
  pageSize: number;
  /** Sort model */
  sortModel: GridSortModel;
  /** Filter model */
  filterModel: GridFilterModel;
  /** Quick filter value */
  quickFilterValue?: string;
}

/**
 * Fetch result from the fetcher function.
 */
export interface DataGridFetchResult<R = Record<string, unknown>> {
  /** Row data */
  rows: R[];
  /** Total row count */
  total: number;
}

/**
 * useDataGridBlock return value.
 */
export interface UseDataGridBlockReturn<R = Record<string, unknown>> {
  /** Row data */
  rows: R[];
  /** Loading state */
  loading: boolean;
  /** Error state */
  error: Error | null;
  /** Total row count */
  total: number;
  /** Pagination model */
  paginationModel: GridPaginationModel;
  /** Sort model */
  sortModel: GridSortModel;
  /** Filter model */
  filterModel: GridFilterModel;
  /** Pagination change handler */
  onPaginationChange: (model: GridPaginationModel, details: GridCallbackDetails) => void;
  /** Sort change handler */
  onSortChange: (model: GridSortModel, details: GridCallbackDetails) => void;
  /** Filter change handler */
  onFilterChange: (model: GridFilterModel, details: GridCallbackDetails) => void;
  /** Refresh data */
  refresh: () => void;
  /** Reset to initial state */
  reset: () => void;
}
