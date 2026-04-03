'use client';

/**
 * Admin Data Table Component
 *
 * Optimized table for admin data displays with built-in sorting,
 * skeleton loading, empty states, and pagination.
 *
 * @module @omnitron-dev/prism/components/admin-filters
 */

import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';
import MuiTable from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TablePagination from '@mui/material/TablePagination';
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { styled, alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export interface ColumnDef<T> {
  /** Unique column identifier */
  key: string;
  /** Column header label */
  header: string;
  /** Column width */
  width?: number | string;
  /** Whether column is sortable */
  sortable?: boolean;
  /** Cell alignment */
  align?: 'left' | 'center' | 'right';
  /** Custom cell renderer */
  render: (row: T, index: number) => ReactNode;
}

export interface AdminDataTableProps<T> {
  /** Column definitions */
  columns: ColumnDef<T>[];
  /** Data rows */
  data: T[];
  /** Total number of rows (for pagination) */
  total: number;
  /** Loading state */
  loading?: boolean;
  /** Current page (0-indexed) */
  page: number;
  /** Rows per page */
  pageSize: number;
  /** Page change handler */
  onPageChange: (page: number) => void;
  /** Page size change handler */
  onPageSizeChange?: (size: number) => void;
  /** Current sort column key */
  sortBy?: string;
  /** Current sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Sort change handler */
  onSort?: (column: string) => void;
  /** Message shown when no data */
  emptyMessage?: string;
  /** Extract unique key from row */
  rowKey?: (row: T) => string;
  /** Row click handler */
  onRowClick?: (row: T) => void;
  /** Page size options for the selector */
  pageSizeOptions?: number[];
  /** Sticky header */
  stickyHeader?: boolean;
  /** Dense mode (less padding) */
  dense?: boolean;
  /** Container max height */
  maxHeight?: number | string;
  /** Additional styles */
  sx?: SxProps<Theme>;
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
    fontSize: theme.typography.pxToRem(13),
    color: theme.palette.text.secondary,
    backgroundColor: 'transparent',
    whiteSpace: 'nowrap',
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
}));

const StyledTableRow = styled(TableRow)(({ theme }) => ({
  transition: theme.transitions.create('background-color', {
    duration: theme.transitions.duration.shortest,
  }),
  '&:nth-of-type(even)': {
    backgroundColor: alpha(theme.palette.grey[500], 0.02),
  },
  '&:hover': {
    backgroundColor: alpha(theme.palette.primary.main, 0.04),
  },
  '& .MuiTableCell-body': {
    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
  },
}));

// =============================================================================
// EMPTY STATE ICON
// =============================================================================

function EmptyIcon(): ReactNode {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.3"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </svg>
  );
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * AdminDataTable - Data table optimized for admin sections.
 *
 * Features skeleton loading rows, sortable column headers, empty states,
 * alternating row colors, sticky header support, and compact pagination.
 *
 * @example
 * ```tsx
 * const columns: ColumnDef<Transaction>[] = [
 *   { key: 'id', header: 'ID', width: 80, render: (row) => row.id },
 *   { key: 'amount', header: 'Amount', align: 'right', sortable: true,
 *     render: (row) => <AmountCell amount={row.amount} currency="BTC" /> },
 *   { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
 * ];
 *
 * <AdminDataTable
 *   columns={columns}
 *   data={transactions}
 *   total={1200}
 *   page={0}
 *   pageSize={25}
 *   onPageChange={setPage}
 *   loading={isLoading}
 *   sortBy="amount"
 *   sortOrder="desc"
 *   onSort={handleSort}
 * />
 * ```
 */
export function AdminDataTable<T>({
  columns,
  data,
  total,
  loading = false,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  sortBy,
  sortOrder = 'asc',
  onSort,
  emptyMessage = 'No data found',
  rowKey,
  onRowClick,
  pageSizeOptions = [10, 25, 50, 100],
  stickyHeader = false,
  dense = false,
  maxHeight,
  sx,
}: AdminDataTableProps<T>): ReactNode {
  const getRowKey = useCallback(
    (row: T, index: number): string => {
      if (rowKey) return rowKey(row);
      const record = row as Record<string, unknown>;
      if (record['id'] !== undefined) return String(record['id']);
      return String(index);
    },
    [rowKey]
  );

  const handleSort = useCallback(
    (columnKey: string) => {
      onSort?.(columnKey);
    },
    [onSort]
  );

  const handlePageChange = useCallback(
    (_: unknown, newPage: number) => {
      onPageChange(newPage);
    },
    [onPageChange]
  );

  const handlePageSizeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onPageSizeChange?.(parseInt(event.target.value, 10));
      onPageChange(0);
    },
    [onPageSizeChange, onPageChange]
  );

  // Skeleton rows for loading state
  const skeletonRows = useMemo(
    () =>
      Array.from({ length: pageSize }, (_, i) => (
        <TableRow key={`skeleton-${i}`}>
          {columns.map((col) => (
            <TableCell key={col.key} align={col.align ?? 'left'}>
              <Skeleton
                variant="text"
                width={col.align === 'right' ? '60%' : '80%'}
                sx={{
                  ml: col.align === 'right' ? 'auto' : 0,
                  borderRadius: 0.5,
                }}
              />
            </TableCell>
          ))}
        </TableRow>
      )),
    [pageSize, columns]
  );

  // Empty state
  if (!loading && data.length === 0) {
    return (
      <StyledTableContainer sx={sx}>
        <MuiTable size={dense ? 'small' : 'medium'} stickyHeader={stickyHeader}>
          <StyledTableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell key={col.key} align={col.align ?? 'left'} style={{ width: col.width }}>
                  {col.header}
                </TableCell>
              ))}
            </TableRow>
          </StyledTableHead>
        </MuiTable>
        <Box
          sx={{
            py: 6,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <EmptyIcon />
          <Typography variant="body2" color="text.disabled">
            {emptyMessage}
          </Typography>
        </Box>
      </StyledTableContainer>
    );
  }

  return (
    <StyledTableContainer sx={{ maxHeight, ...sx }}>
      <TableContainer>
        <MuiTable size={dense ? 'small' : 'medium'} stickyHeader={stickyHeader}>
          <StyledTableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  align={col.align ?? 'left'}
                  style={{ width: col.width }}
                  sortDirection={sortBy === col.key ? sortOrder : false}
                >
                  {col.sortable && onSort ? (
                    <TableSortLabel
                      active={sortBy === col.key}
                      direction={sortBy === col.key ? sortOrder : 'asc'}
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                    </TableSortLabel>
                  ) : (
                    col.header
                  )}
                </TableCell>
              ))}
            </TableRow>
          </StyledTableHead>

          <TableBody>
            {loading
              ? skeletonRows
              : data.map((row, index) => (
                  <StyledTableRow
                    key={getRowKey(row, index)}
                    hover
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
                  >
                    {columns.map((col) => (
                      <TableCell key={col.key} align={col.align ?? 'left'}>
                        {col.render(row, index)}
                      </TableCell>
                    ))}
                  </StyledTableRow>
                ))}
          </TableBody>
        </MuiTable>
      </TableContainer>

      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={pageSize}
        rowsPerPageOptions={pageSizeOptions}
        onPageChange={handlePageChange}
        onRowsPerPageChange={handlePageSizeChange}
        sx={{
          borderTop: (theme) => `1px solid ${theme.palette.divider}`,
          '& .MuiTablePagination-displayedRows': {
            fontSize: '0.8rem',
          },
          '& .MuiTablePagination-selectLabel': {
            fontSize: '0.8rem',
          },
        }}
      />
    </StyledTableContainer>
  );
}
