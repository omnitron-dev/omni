'use client';

/**
 * Table Component
 *
 * Enhanced table component with sorting, selection, and pagination.
 *
 * @module @omnitron-dev/prism/components/table
 */

import type { ReactNode, ChangeEvent } from 'react';
import { forwardRef, useCallback, useState, useMemo } from 'react';
import MuiTable from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TablePagination from '@mui/material/TablePagination';
import Checkbox from '@mui/material/Checkbox';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { styled, alpha } from '@mui/material/styles';
import type { TableProps as MuiTableProps } from '@mui/material/Table';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type SortOrder = 'asc' | 'desc';

export interface TableColumn<T> {
  /** Unique column identifier */
  id: keyof T | string;
  /** Column header label */
  label: string;
  /** Column width */
  width?: number | string;
  /** Minimum width */
  minWidth?: number;
  /** Alignment */
  align?: 'left' | 'center' | 'right';
  /** Whether column is sortable */
  sortable?: boolean;
  /** Custom render function */
  render?: (row: T, index: number) => ReactNode;
  /** Format value for display */
  format?: (value: unknown) => string;
}

export interface TableProps<T> extends Omit<MuiTableProps, 'children'> {
  /** Table columns configuration */
  columns: TableColumn<T>[];
  /** Data rows */
  data: T[];
  /** Row key accessor */
  rowKey?: keyof T | ((row: T) => string | number);
  /** Enable row selection */
  selectable?: boolean;
  /** Selected row keys */
  selected?: (string | number)[];
  /** Selection change handler */
  onSelectChange?: (selected: (string | number)[]) => void;
  /** Enable sorting */
  sortable?: boolean;
  /** Current sort column */
  sortBy?: string;
  /** Current sort order */
  sortOrder?: SortOrder;
  /** Sort change handler */
  onSortChange?: (column: string, order: SortOrder) => void;
  /** Enable pagination */
  paginated?: boolean;
  /** Current page (0-indexed) */
  page?: number;
  /** Rows per page */
  rowsPerPage?: number;
  /** Total row count (for server-side pagination) */
  totalRows?: number;
  /** Page change handler */
  onPageChange?: (page: number) => void;
  /** Rows per page change handler */
  onRowsPerPageChange?: (rowsPerPage: number) => void;
  /** Rows per page options */
  rowsPerPageOptions?: number[];
  /** Empty state content */
  emptyContent?: ReactNode;
  /** Loading state */
  loading?: boolean;
  /** Dense padding */
  dense?: boolean;
  /** Sticky header */
  stickyHeader?: boolean;
  /** Container max height */
  maxHeight?: number | string;
  /** Row click handler */
  onRowClick?: (row: T, index: number) => void;
  /** Container styles */
  containerSx?: SxProps<Theme>;
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const StyledTableContainer = styled(Paper)(({ theme }) => ({
  borderRadius: theme.shape.borderRadius,
  border: `1px solid ${theme.palette.divider}`,
  overflow: 'auto',
}));

const StyledTableHead = styled(TableHead)(({ theme }) => ({
  backgroundColor: alpha(theme.palette.grey[500], 0.08),
  '& .MuiTableCell-head': {
    fontWeight: 600,
    backgroundColor: 'transparent',
  },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.04),
  },
  '&.Mui-selected': {
    backgroundColor: alpha(theme.palette.primary.main, 0.08),
    '&:hover': {
      backgroundColor: alpha(theme.palette.primary.main, 0.12),
    },
  },
}));

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Table - Enhanced data table with sorting, selection, and pagination.
 *
 * @example
 * ```tsx
 * const columns: TableColumn<User>[] = [
 *   { id: 'name', label: 'Name', sortable: true },
 *   { id: 'email', label: 'Email' },
 *   { id: 'status', label: 'Status', render: (row) => <Label>{row.status}</Label> },
 * ];
 *
 * <Table
 *   columns={columns}
 *   data={users}
 *   rowKey="id"
 *   selectable
 *   paginated
 * />
 * ```
 */
function TableInner<T>(
  {
    columns,
    data,
    rowKey = 'id' as keyof T,
    selectable = false,
    selected = [],
    onSelectChange,
    sortable = false,
    sortBy,
    sortOrder = 'asc',
    onSortChange,
    paginated = false,
    page = 0,
    rowsPerPage = 10,
    totalRows,
    onPageChange,
    onRowsPerPageChange,
    rowsPerPageOptions = [5, 10, 25, 50],
    emptyContent,
    loading = false,
    dense = false,
    stickyHeader = false,
    maxHeight,
    onRowClick,
    containerSx,
    sx,
    ...other
  }: TableProps<T>,
  ref: React.Ref<HTMLTableElement>
): ReactNode {
  // Get row key
  const getRowKey = useCallback(
    (row: T, index: number): string | number => {
      if (typeof rowKey === 'function') {
        return rowKey(row);
      }
      const keyValue = row[rowKey as keyof T];
      return keyValue !== undefined ? String(keyValue) : index;
    },
    [rowKey]
  );

  // Selection handlers
  const isAllSelected = useMemo(
    () => data.length > 0 && selected.length === data.length,
    [data.length, selected.length]
  );

  const isIndeterminate = useMemo(
    () => selected.length > 0 && selected.length < data.length,
    [data.length, selected.length]
  );

  const handleSelectAll = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (event.target.checked) {
        const allKeys = data.map((row, index) => getRowKey(row, index));
        onSelectChange?.(allKeys);
      } else {
        onSelectChange?.([]);
      }
    },
    [data, getRowKey, onSelectChange]
  );

  const handleSelectRow = useCallback(
    (key: string | number) => {
      const newSelected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
      onSelectChange?.(newSelected);
    },
    [selected, onSelectChange]
  );

  // Sort handler
  const handleSort = useCallback(
    (columnId: string) => {
      const isAsc = sortBy === columnId && sortOrder === 'asc';
      onSortChange?.(columnId, isAsc ? 'desc' : 'asc');
    },
    [sortBy, sortOrder, onSortChange]
  );

  // Pagination handlers
  const handlePageChange = useCallback(
    (_: unknown, newPage: number) => {
      onPageChange?.(newPage);
    },
    [onPageChange]
  );

  const handleRowsPerPageChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onRowsPerPageChange?.(parseInt(event.target.value, 10));
      onPageChange?.(0);
    },
    [onRowsPerPageChange, onPageChange]
  );

  // Calculate total rows
  const total = totalRows ?? data.length;

  // Slice data for client-side pagination
  const displayData = useMemo(() => {
    if (paginated && !totalRows) {
      return data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
    }
    return data;
  }, [data, paginated, page, rowsPerPage, totalRows]);

  // Empty state
  if (!loading && data.length === 0) {
    return (
      <StyledTableContainer sx={containerSx}>
        <Box sx={{ p: 4, textAlign: 'center' }}>
          {emptyContent || <Typography color="text.secondary">No data available</Typography>}
        </Box>
      </StyledTableContainer>
    );
  }

  return (
    <StyledTableContainer
      sx={{
        maxHeight,
        ...containerSx,
      }}
    >
      <MuiTable ref={ref} stickyHeader={stickyHeader} size={dense ? 'small' : 'medium'} sx={sx} {...other}>
        <StyledTableHead>
          <TableRow>
            {selectable && (
              <TableCell padding="checkbox">
                <Checkbox indeterminate={isIndeterminate} checked={isAllSelected} onChange={handleSelectAll} />
              </TableCell>
            )}
            {columns.map((column) => (
              <TableCell
                key={String(column.id)}
                align={column.align || 'left'}
                style={{ width: column.width, minWidth: column.minWidth }}
                sortDirection={sortBy === column.id ? sortOrder : false}
              >
                {sortable && column.sortable !== false ? (
                  <TableSortLabel
                    active={sortBy === column.id}
                    direction={sortBy === column.id ? sortOrder : 'asc'}
                    onClick={() => handleSort(String(column.id))}
                  >
                    {column.label}
                  </TableSortLabel>
                ) : (
                  column.label
                )}
              </TableCell>
            ))}
          </TableRow>
        </StyledTableHead>

        <TableBody>
          {displayData.map((row, index) => {
            const key = getRowKey(row, index);
            const isSelected = selected.includes(key);

            return (
              <StyledTableRow
                key={key}
                hover
                selected={isSelected}
                onClick={() => onRowClick?.(row, index)}
                sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
              >
                {selectable && (
                  <TableCell padding="checkbox">
                    <Checkbox
                      checked={isSelected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => handleSelectRow(key)}
                    />
                  </TableCell>
                )}
                {columns.map((column) => {
                  const value = row[column.id as keyof T];

                  return (
                    <TableCell key={String(column.id)} align={column.align || 'left'}>
                      {column.render
                        ? column.render(row, index)
                        : column.format
                          ? column.format(value)
                          : String(value ?? '')}
                    </TableCell>
                  );
                })}
              </StyledTableRow>
            );
          })}
        </TableBody>
      </MuiTable>

      {paginated && (
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={rowsPerPageOptions}
          onPageChange={handlePageChange}
          onRowsPerPageChange={handleRowsPerPageChange}
        />
      )}
    </StyledTableContainer>
  );
}

// Type assertion to preserve generics with forwardRef
export const Table = forwardRef(TableInner) as <T>(
  props: TableProps<T> & { ref?: React.Ref<HTMLTableElement> }
) => ReactNode;

// =============================================================================
// USE TABLE HOOK
// =============================================================================

export interface UseTableOptions<T> {
  /** Initial data */
  data: T[];
  /** Row key accessor */
  rowKey?: keyof T | ((row: T) => string | number);
  /** Default page */
  defaultPage?: number;
  /** Default rows per page */
  defaultRowsPerPage?: number;
  /** Default sort column */
  defaultSortBy?: string;
  /** Default sort order */
  defaultSortOrder?: SortOrder;
}

export interface UseTableReturn<T> {
  /** Current page */
  page: number;
  /** Set page */
  setPage: (page: number) => void;
  /** Rows per page */
  rowsPerPage: number;
  /** Set rows per page */
  setRowsPerPage: (rowsPerPage: number) => void;
  /** Sort column */
  sortBy: string | undefined;
  /** Sort order */
  sortOrder: SortOrder;
  /** Sort handler */
  handleSort: (column: string, order: SortOrder) => void;
  /** Selected keys */
  selected: (string | number)[];
  /** Set selected */
  setSelected: (selected: (string | number)[]) => void;
  /** Sorted and paginated data */
  displayData: T[];
  /** Total row count */
  totalRows: number;
  /** Reset all state */
  reset: () => void;
}

/**
 * useTable - Hook for managing table state.
 *
 * @example
 * ```tsx
 * function UserTable() {
 *   const table = useTable({
 *     data: users,
 *     rowKey: 'id',
 *     defaultSortBy: 'name',
 *   });
 *
 *   return (
 *     <Table
 *       columns={columns}
 *       data={table.displayData}
 *       rowKey="id"
 *       selectable
 *       selected={table.selected}
 *       onSelectChange={table.setSelected}
 *       sortable
 *       sortBy={table.sortBy}
 *       sortOrder={table.sortOrder}
 *       onSortChange={table.handleSort}
 *       paginated
 *       page={table.page}
 *       rowsPerPage={table.rowsPerPage}
 *       totalRows={table.totalRows}
 *       onPageChange={table.setPage}
 *       onRowsPerPageChange={table.setRowsPerPage}
 *     />
 *   );
 * }
 * ```
 */
export function useTable<T>({
  data,
  defaultPage = 0,
  defaultRowsPerPage = 10,
  defaultSortBy,
  defaultSortOrder = 'asc',
}: UseTableOptions<T>): UseTableReturn<T> {
  const [page, setPage] = useState(defaultPage);
  const [rowsPerPage, setRowsPerPage] = useState(defaultRowsPerPage);
  const [sortBy, setSortBy] = useState<string | undefined>(defaultSortBy);
  const [sortOrder, setSortOrder] = useState<SortOrder>(defaultSortOrder);
  const [selected, setSelected] = useState<(string | number)[]>([]);

  const handleSort = useCallback((column: string, order: SortOrder) => {
    setSortBy(column);
    setSortOrder(order);
  }, []);

  // Sort data
  const sortedData = useMemo(() => {
    if (!sortBy) return data;

    return [...data].sort((a, b) => {
      const aValue = a[sortBy as keyof T];
      const bValue = b[sortBy as keyof T];

      if (aValue === bValue) return 0;
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      const comparison = aValue < bValue ? -1 : 1;
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [data, sortBy, sortOrder]);

  // Paginate data
  const displayData = useMemo(() => {
    const start = page * rowsPerPage;
    return sortedData.slice(start, start + rowsPerPage);
  }, [sortedData, page, rowsPerPage]);

  const reset = useCallback(() => {
    setPage(defaultPage);
    setRowsPerPage(defaultRowsPerPage);
    setSortBy(defaultSortBy);
    setSortOrder(defaultSortOrder);
    setSelected([]);
  }, [defaultPage, defaultRowsPerPage, defaultSortBy, defaultSortOrder]);

  return {
    page,
    setPage,
    rowsPerPage,
    setRowsPerPage,
    sortBy,
    sortOrder,
    handleSort,
    selected,
    setSelected,
    displayData,
    totalRows: data.length,
    reset,
  };
}
