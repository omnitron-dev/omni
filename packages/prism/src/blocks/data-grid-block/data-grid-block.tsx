/**
 * DataGrid Block Component
 *
 * Advanced data table block with toolbar, pagination, sorting, filtering,
 * row actions, and server-side data support.
 *
 * @module @omnitron/prism/blocks/data-grid-block
 */

'use client';

import {
  type ReactNode,
  type MouseEvent,
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import { SearchInput } from '../../components/search-input/search-input.js';
import LinearProgress from '@mui/material/LinearProgress';
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams,
  type GridPaginationModel,
  type GridSortModel,
  type GridFilterModel,
  type GridRowSelectionModel,
  type GridCallbackDetails,
  type GridDensity,
  type GridRowId,
  GridToolbarContainer,
  GridToolbarColumnsButton,
  GridToolbarDensitySelector,
  GridToolbarExport,
} from '@mui/x-data-grid';
import type {
  DataGridBlockProps,
  DataGridBlockContextValue,
  DataGridRowAction,
  UseDataGridBlockOptions,
  UseDataGridBlockReturn,
  DataGridFetchParams,
} from './types.js';

// =============================================================================
// CONTEXT
// =============================================================================

const DataGridBlockContext = createContext<DataGridBlockContextValue | null>(null);

/**
 * Hook to access data grid block context.
 */
export function useDataGridBlockContext(): DataGridBlockContextValue {
  const context = useContext(DataGridBlockContext);
  if (!context) {
    throw new Error('useDataGridBlockContext must be used within DataGridBlock');
  }
  return context;
}

// =============================================================================
// ICONS
// =============================================================================

function MoreVertIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function EmptyIcon(): ReactNode {
  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ opacity: 0.4 }}
    >
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="13 2 13 9 20 9" />
      <line x1="10" y1="12" x2="10" y2="18" />
      <line x1="14" y1="12" x2="14" y2="18" />
      <line x1="10" y1="15" x2="14" y2="15" />
    </svg>
  );
}

// =============================================================================
// CUSTOM TOOLBAR
// =============================================================================

interface CustomToolbarProps {
  quickFilter?: {
    enabled?: boolean;
    placeholder?: string;
    debounceMs?: number;
  };
  exportConfig?: {
    csv?: boolean;
    excel?: boolean;
    print?: boolean;
  };
  showColumnSelector?: boolean;
  showDensitySelector?: boolean;
  startContent?: ReactNode;
  endContent?: ReactNode;
  actions?: ReactNode;
  onQuickFilterChange?: (value: string) => void;
}

function CustomToolbar({
  quickFilter,
  exportConfig,
  showColumnSelector = true,
  showDensitySelector = true,
  startContent,
  endContent,
  actions,
  onQuickFilterChange,
}: CustomToolbarProps): ReactNode {
  const [searchValue, setSearchValue] = useState('');
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup debounce timer on unmount
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onQuickFilterChange?.(value);
      }, quickFilter?.debounceMs ?? 300);
    },
    [onQuickFilterChange, quickFilter?.debounceMs]
  );

  return (
    <GridToolbarContainer
      sx={{
        gap: 1.5,
        p: 2,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      {startContent}

      {quickFilter?.enabled !== false && (
        <SearchInput
          value={searchValue}
          onChange={handleSearchChange}
          placeholder={quickFilter?.placeholder ?? 'Search...'}
          fullWidth={false}
          minWidth={200}
        />
      )}

      <Box sx={{ flex: 1 }} />

      {showColumnSelector && <GridToolbarColumnsButton />}
      {showDensitySelector && <GridToolbarDensitySelector />}

      {(exportConfig?.csv !== false || exportConfig?.print !== false) && (
        <GridToolbarExport
          printOptions={exportConfig?.print === false ? { disableToolbarButton: true } : undefined}
          csvOptions={exportConfig?.csv === false ? { disableToolbarButton: true } : undefined}
        />
      )}

      {actions}
      {endContent}
    </GridToolbarContainer>
  );
}

// =============================================================================
// ROW ACTIONS CELL
// =============================================================================

interface RowActionsCellProps<R> {
  row: R;
  actions: DataGridRowAction<R>[];
}

function RowActionsCell<R extends Record<string, unknown>>({ row, actions }: RowActionsCellProps<R>): ReactNode {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  }, []);

  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  const handleAction = useCallback(
    (action: DataGridRowAction<R>, event: MouseEvent<HTMLElement>) => {
      setAnchorEl(null);
      action.onClick(row, event);
    },
    [row]
  );

  const visibleActions = actions.filter((action) => {
    if (typeof action.hidden === 'function') {
      return !action.hidden(row);
    }
    return !action.hidden;
  });

  if (visibleActions.length === 0) {
    return null;
  }

  // If only 1-2 actions, show inline buttons
  if (visibleActions.length <= 2) {
    return (
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {visibleActions.map((action) => {
          const isDisabled = typeof action.disabled === 'function' ? action.disabled(row) : action.disabled;

          return (
            <Tooltip key={action.key} title={action.label}>
              <span>
                <IconButton
                  size="small"
                  color={action.color ?? 'default'}
                  disabled={isDisabled}
                  onClick={(e) => handleAction(action, e)}
                  aria-label={action.label}
                >
                  {action.icon ?? action.label.charAt(0)}
                </IconButton>
              </span>
            </Tooltip>
          );
        })}
      </Box>
    );
  }

  // More than 2 actions, show menu
  return (
    <>
      <IconButton
        size="small"
        onClick={handleClick}
        aria-label="Row actions"
        aria-controls={open ? 'row-actions-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        <MoreVertIcon />
      </IconButton>
      <Menu
        id="row-actions-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={(e) => e.stopPropagation()}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {visibleActions.map((action, index) => {
          const isDisabled = typeof action.disabled === 'function' ? action.disabled(row) : action.disabled;

          return [
            <MenuItem key={action.key} disabled={isDisabled} onClick={(e) => handleAction(action, e)}>
              {action.icon && <ListItemIcon>{action.icon}</ListItemIcon>}
              <ListItemText primary={action.label} sx={{ color: action.color ? `${action.color}.main` : undefined }} />
            </MenuItem>,
            action.divider && index < visibleActions.length - 1 && <Divider key={`${action.key}-divider`} />,
          ];
        })}
      </Menu>
    </>
  );
}

// =============================================================================
// EMPTY STATE
// =============================================================================

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  component?: ReactNode;
}

function EmptyState({
  icon,
  title = 'No data',
  description = 'No records to display.',
  action,
  component,
}: EmptyStateProps): ReactNode {
  if (component) {
    return <>{component}</>;
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        px: 3,
        textAlign: 'center',
      }}
    >
      <Box sx={{ mb: 2, color: 'text.disabled' }}>{icon ?? <EmptyIcon />}</Box>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: action ? 2 : 0 }}>
        {description}
      </Typography>
      {action && (
        <Button variant="contained" size="small" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </Box>
  );
}

// =============================================================================
// ERROR STATE
// =============================================================================

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

function ErrorState({ message = 'Failed to load data', onRetry }: ErrorStateProps): ReactNode {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 8,
        px: 3,
        textAlign: 'center',
      }}
    >
      <Typography color="error" variant="body1" gutterBottom>
        {message}
      </Typography>
      {onRetry && (
        <Button variant="outlined" size="small" onClick={onRetry} sx={{ mt: 1 }}>
          Retry
        </Button>
      )}
    </Box>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * DataGridBlock - Advanced data table with common patterns.
 *
 * Features:
 * - Custom toolbar with search, filters, export, and column visibility
 * - Row actions column (inline or dropdown menu)
 * - Server-side pagination, sorting, and filtering support
 * - Custom empty state
 * - Loading and error states
 * - Selection handling
 * - Density customization
 *
 * @example
 * ```tsx
 * <DataGridBlock
 *   columns={[
 *     { field: 'name', headerName: 'Name', flex: 1 },
 *     { field: 'email', headerName: 'Email', flex: 1 },
 *     { field: 'status', headerName: 'Status', width: 120 },
 *   ]}
 *   rows={users}
 *   loading={isLoading}
 *   rowActions={[
 *     { key: 'edit', label: 'Edit', icon: <EditIcon />, onClick: handleEdit },
 *     { key: 'delete', label: 'Delete', icon: <DeleteIcon />, color: 'error', onClick: handleDelete },
 *   ]}
 *   toolbar={{
 *     quickFilter: { placeholder: 'Search users...' },
 *     export: { csv: true },
 *   }}
 *   pagination={{
 *     mode: 'server',
 *     rowCount: totalCount,
 *   }}
 *   onPaginationChange={handlePaginationChange}
 * />
 * ```
 */
export function DataGridBlock<R extends Record<string, unknown> = Record<string, unknown>>({
  columns,
  rows,
  loading = false,
  error = false,
  errorMessage,
  onRetry,
  rowActions,
  rowActionsWidth = 80,
  toolbar,
  pagination,
  selection,
  empty,
  density: defaultDensity = 'standard',
  autoHeight = false,
  height = 500,
  hideFooter = false,
  rowHeight,
  getRowId,
  onRowClick,
  onRowDoubleClick,
  onSelectionChange,
  onPaginationChange,
  onSortChange,
  onFilterChange,
  paginationModel: controlledPaginationModel,
  sortModel: controlledSortModel,
  filterModel: controlledFilterModel,
  selectionModel: controlledSelectionModel,
  columnVisibilityModel,
  onColumnVisibilityChange,
  slots,
  slotProps,
  disableColumnMenu = false,
  disableColumnFilter = false,
  disableColumnSelector = false,
  disableRowSelectionOnClick = true,
  disableVirtualization = false,
  sx,
}: DataGridBlockProps<R>): ReactNode {
  const [density, setDensity] = useState<GridDensity>(defaultDensity);
  const [internalPaginationModel, setInternalPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: pagination?.defaultPageSize ?? 25,
  });
  const [internalSortModel, setInternalSortModel] = useState<GridSortModel>([]);
  const [internalFilterModel, setInternalFilterModel] = useState<GridFilterModel>({ items: [] });
  const [internalSelectionModel, setInternalSelectionModel] = useState<GridRowSelectionModel>({
    type: 'include',
    ids: new Set<GridRowId>(),
  });
  const [quickFilterValue, setQuickFilterValue] = useState('');

  // Use controlled or internal state
  const paginationModel = controlledPaginationModel ?? internalPaginationModel;
  const sortModel = controlledSortModel ?? internalSortModel;
  const filterModel = controlledFilterModel ?? internalFilterModel;
  const selectionModelValue = controlledSelectionModel ?? internalSelectionModel;

  // Build columns with row actions
  const finalColumns = useMemo<GridColDef<R>[]>(() => {
    if (!rowActions || rowActions.length === 0) {
      return columns;
    }

    const actionsColumn: GridColDef<R> = {
      field: '__actions__',
      headerName: '',
      width: rowActionsWidth,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      disableReorder: true,
      renderCell: (params: GridRenderCellParams<R>) => <RowActionsCell row={params.row} actions={rowActions} />,
    };

    return [...columns, actionsColumn];
  }, [columns, rowActions, rowActionsWidth]);

  // Handlers
  const handlePaginationChange = useCallback(
    (model: GridPaginationModel, details: GridCallbackDetails) => {
      if (!controlledPaginationModel) {
        setInternalPaginationModel(model);
      }
      onPaginationChange?.(model);
    },
    [controlledPaginationModel, onPaginationChange]
  );

  const handleSortChange = useCallback(
    (model: GridSortModel, details: GridCallbackDetails) => {
      if (!controlledSortModel) {
        setInternalSortModel(model);
      }
      onSortChange?.(model);
    },
    [controlledSortModel, onSortChange]
  );

  const handleFilterChange = useCallback(
    (model: GridFilterModel, details: GridCallbackDetails) => {
      if (!controlledFilterModel) {
        setInternalFilterModel(model);
      }
      onFilterChange?.(model);
    },
    [controlledFilterModel, onFilterChange]
  );

  const handleSelectionChange = useCallback(
    (model: GridRowSelectionModel, details: GridCallbackDetails) => {
      if (!controlledSelectionModel) {
        setInternalSelectionModel(model);
      }
      onSelectionChange?.(model);
    },
    [controlledSelectionModel, onSelectionChange]
  );

  // Context value
  const contextValue = useMemo<DataGridBlockContextValue>(
    () => ({
      loading,
      error,
      density,
      setDensity,
      rowCount: rows.length,
      selectedCount: selectionModelValue.ids.size,
      refresh: onRetry,
    }),
    [loading, error, density, rows.length, selectionModelValue, onRetry]
  );

  // Determine row count for pagination
  const rowCount = pagination?.mode === 'server' ? (pagination.rowCount ?? 0) : rows.length;

  // Custom toolbar slot
  const toolbarSlot = useMemo(() => {
    if (toolbar?.show === false) {
      return undefined;
    }

    return () => (
      <CustomToolbar
        quickFilter={toolbar?.quickFilter}
        exportConfig={toolbar?.export}
        showColumnSelector={toolbar?.columnVisibility?.enabled !== false}
        showDensitySelector={toolbar?.densitySelector !== false}
        startContent={toolbar?.startContent}
        endContent={toolbar?.endContent}
        actions={toolbar?.actions}
        onQuickFilterChange={setQuickFilterValue}
      />
    );
  }, [toolbar]);

  // No data overlay
  const noRowsOverlay = useMemo(() => {
    if (error) {
      return () => <ErrorState message={errorMessage} onRetry={onRetry} />;
    }
    return () => (
      <EmptyState
        icon={empty?.icon}
        title={empty?.title}
        description={empty?.description}
        action={empty?.action}
        component={empty?.component}
      />
    );
  }, [error, errorMessage, onRetry, empty]);

  return (
    <DataGridBlockContext.Provider value={contextValue}>
      <Paper
        data-testid="prism-data-grid-block"
        variant="outlined"
        sx={[
          {
            width: '100%',
            overflow: 'hidden',
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        <Box sx={{ width: '100%', height: autoHeight ? 'auto' : height }}>
          <DataGrid
            rows={rows}
            columns={finalColumns}
            loading={loading}
            density={density}
            autoHeight={autoHeight}
            rowHeight={rowHeight}
            getRowId={getRowId}
            onRowClick={onRowClick}
            onRowDoubleClick={onRowDoubleClick}
            // Pagination
            paginationMode={pagination?.mode ?? 'client'}
            paginationModel={paginationModel}
            onPaginationModelChange={handlePaginationChange}
            pageSizeOptions={pagination?.pageSizeOptions ?? [10, 25, 50, 100]}
            rowCount={rowCount}
            // Sorting
            sortingMode={pagination?.mode === 'server' ? 'server' : 'client'}
            sortModel={sortModel}
            onSortModelChange={handleSortChange}
            // Filtering
            filterMode={pagination?.mode === 'server' ? 'server' : 'client'}
            filterModel={filterModel}
            onFilterModelChange={handleFilterChange}
            // Selection
            checkboxSelection={selection?.checkboxSelection ?? false}
            rowSelectionModel={selectionModelValue}
            onRowSelectionModelChange={handleSelectionChange}
            disableRowSelectionOnClick={selection?.disableSelectionOnClick ?? disableRowSelectionOnClick}
            disableMultipleRowSelection={selection?.mode === 'single'}
            keepNonExistentRowsSelected={selection?.keepNonExistentRowsSelected}
            // Column visibility
            columnVisibilityModel={columnVisibilityModel}
            onColumnVisibilityModelChange={onColumnVisibilityChange}
            // Features
            disableColumnMenu={disableColumnMenu}
            disableColumnFilter={disableColumnFilter}
            disableColumnSelector={disableColumnSelector}
            disableVirtualization={disableVirtualization}
            hideFooter={hideFooter || pagination?.hide}
            // Slots
            slots={{
              toolbar: toolbarSlot,
              noRowsOverlay,
              loadingOverlay: () => <LinearProgress sx={{ position: 'absolute', top: 0, left: 0, right: 0 }} />,
              ...slots,
            }}
            slotProps={slotProps}
            sx={{
              border: 0,
              '& .MuiDataGrid-columnHeaders': {
                bgcolor: 'action.hover',
              },
              '& .MuiDataGrid-cell:focus': {
                outline: 'none',
              },
              '& .MuiDataGrid-row:hover': {
                bgcolor: 'action.hover',
              },
            }}
          />
        </Box>
      </Paper>
    </DataGridBlockContext.Provider>
  );
}

// =============================================================================
// USE DATA GRID BLOCK HOOK
// =============================================================================

/**
 * Hook for managing DataGridBlock with server-side data fetching.
 *
 * @example
 * ```tsx
 * const { rows, loading, error, total, paginationModel, onPaginationChange, refresh } =
 *   useDataGridBlock({
 *     fetcher: async ({ page, pageSize, sortModel, filterModel }) => {
 *       const response = await api.getUsers({ page, pageSize, sort: sortModel[0] });
 *       return { rows: response.data, total: response.total };
 *     },
 *   });
 *
 * return (
 *   <DataGridBlock
 *     columns={columns}
 *     rows={rows}
 *     loading={loading}
 *     error={!!error}
 *     pagination={{ mode: 'server', rowCount: total }}
 *     paginationModel={paginationModel}
 *     onPaginationChange={onPaginationChange}
 *   />
 * );
 * ```
 */
export function useDataGridBlock<R extends Record<string, unknown> = Record<string, unknown>>(
  options: UseDataGridBlockOptions<R>
): UseDataGridBlockReturn<R> {
  const {
    fetcher,
    initialPageSize = 25,
    initialSortModel = [],
    initialFilterModel = { items: [] },
    autoFetch = true,
    keepPreviousData = true,
  } = options;

  const [rows, setRows] = useState<R[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);

  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: initialPageSize,
  });
  const [sortModel, setSortModel] = useState<GridSortModel>(initialSortModel);
  const [filterModel, setFilterModel] = useState<GridFilterModel>(initialFilterModel);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(
    async (params: DataGridFetchParams) => {
      // Cancel previous request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const result = await fetcher(params);
        if (isMountedRef.current) {
          setRows(result.rows);
          setTotal(result.total);
        }
      } catch (err) {
        if (isMountedRef.current && err instanceof Error && err.name !== 'AbortError') {
          setError(err);
          if (!keepPreviousData) {
            setRows([]);
          }
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    },
    [fetcher, keepPreviousData]
  );

  const refresh = useCallback(() => {
    fetchData({
      page: paginationModel.page,
      pageSize: paginationModel.pageSize,
      sortModel,
      filterModel,
    });
  }, [fetchData, paginationModel, sortModel, filterModel]);

  const reset = useCallback(() => {
    setPaginationModel({ page: 0, pageSize: initialPageSize });
    setSortModel(initialSortModel);
    setFilterModel(initialFilterModel);
  }, [initialPageSize, initialSortModel, initialFilterModel]);

  // Fetch on params change
  useEffect(() => {
    if (autoFetch) {
      fetchData({
        page: paginationModel.page,
        pageSize: paginationModel.pageSize,
        sortModel,
        filterModel,
      });
    }
  }, [fetchData, paginationModel, sortModel, filterModel, autoFetch]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    },
    []
  );

  const handlePaginationChange = useCallback((model: GridPaginationModel, _details: GridCallbackDetails) => {
    setPaginationModel(model);
  }, []);

  const handleSortChange = useCallback((model: GridSortModel, _details: GridCallbackDetails) => {
    setSortModel(model);
    // Reset to first page on sort change
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, []);

  const handleFilterChange = useCallback((model: GridFilterModel, _details: GridCallbackDetails) => {
    setFilterModel(model);
    // Reset to first page on filter change
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  }, []);

  return {
    rows,
    loading,
    error,
    total,
    paginationModel,
    sortModel,
    filterModel,
    onPaginationChange: handlePaginationChange,
    onSortChange: handleSortChange,
    onFilterChange: handleFilterChange,
    refresh,
    reset,
  };
}
