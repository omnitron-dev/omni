'use client';

/**
 * Filter Toolbar Component
 *
 * Declarative filter toolbar for admin sections. Renders filters based on
 * a configuration array, supporting search, select, multi-select, date ranges,
 * boolean toggles, and number ranges.
 *
 * @module @omnitron/prism/components/admin-filters
 */

import type { ReactNode, ChangeEvent } from 'react';
import { useState, useCallback, useMemo, useRef, useEffect, useTransition } from 'react';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Badge from '@mui/material/Badge';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import { DateRangeInput } from '../date-range-picker/date-range-input.js';
import { SearchInput } from '../search-input/search-input.js';

// =============================================================================
// TYPES
// =============================================================================

export type FilterType = 'search' | 'select' | 'multi-select' | 'date-range' | 'boolean' | 'number-range';

export interface FilterOption {
  value: string;
  label: string;
  color?: string;
}

export interface FilterConfig {
  /** Unique key used as the property name in FilterValues */
  key: string;
  /** Type of filter to render */
  type: FilterType;
  /** Display label */
  label: string;
  /** Placeholder text */
  placeholder?: string;
  /** Options for select / multi-select filters */
  options?: FilterOption[];
  /** Width of the filter control */
  width?: number | string;
  /** Default value */
  defaultValue?: unknown;
}

export interface FilterValues {
  [key: string]: unknown;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface FilterToolbarProps {
  /** Filter configurations */
  filters: FilterConfig[];
  /** Current filter values */
  values: FilterValues;
  /** Called when any filter value changes */
  onChange: (values: FilterValues) => void;
  /** Called when the reset button is clicked */
  onReset?: () => void;
  /** Total count to display */
  total?: number;
  /** Debounce delay for search input in ms */
  searchDebounce?: number;
  /** Compact mode (single row) */
  compact?: boolean;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

// =============================================================================
// SEARCH ICON (inline SVG to avoid external dependency)
// =============================================================================

function FilterIcon(): ReactNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function useDebounce(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

function isFilterActive(config: FilterConfig, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (config.type === 'boolean' && value === false) return false;
  if (config.type === 'select' && value === '') return false;
  return true;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * FilterToolbar - Declarative filter toolbar for admin sections.
 *
 * Renders a row of filter controls based on a configuration array.
 * Supports search (debounced), select, multi-select, date-range,
 * boolean, and number-range filters.
 *
 * @example
 * ```tsx
 * const filters: FilterConfig[] = [
 *   { key: 'search', type: 'search', label: 'Search', placeholder: 'Search users...' },
 *   { key: 'status', type: 'select', label: 'Status', options: [
 *     { value: 'active', label: 'Active' },
 *     { value: 'blocked', label: 'Blocked' },
 *   ]},
 *   { key: 'verified', type: 'boolean', label: 'Verified' },
 * ];
 *
 * <FilterToolbar
 *   filters={filters}
 *   values={filterValues}
 *   onChange={setFilterValues}
 *   total={245}
 * />
 * ```
 */
export function FilterToolbar({
  filters,
  values,
  onChange,
  onReset,
  total,
  searchDebounce = 300,
  compact = false,
  sx,
}: FilterToolbarProps): ReactNode {
  const [, startTransition] = useTransition();

  // Track local search text so the input feels responsive (debounce only propagates)
  const searchFilter = filters.find((f) => f.type === 'search');
  const [localSearch, setLocalSearch] = useState<string>((values[searchFilter?.key ?? 'search'] as string) ?? '');
  const debouncedSearch = useDebounce(localSearch, searchDebounce);
  const prevDebouncedRef = useRef(debouncedSearch);

  // Propagate debounced search to parent
  useEffect(() => {
    if (debouncedSearch !== prevDebouncedRef.current) {
      prevDebouncedRef.current = debouncedSearch;
      const key = searchFilter?.key ?? 'search';
      startTransition(() => {
        onChange({ ...values, [key]: debouncedSearch });
      });
    }
  }, [debouncedSearch, searchFilter?.key, onChange, values]);

  // Count active filters (excluding search)
  const activeCount = useMemo(
    () => filters.filter((f) => f.type !== 'search' && isFilterActive(f, values[f.key])).length,
    [filters, values]
  );

  const hasAnyActive = useMemo(
    () => filters.some((f) => isFilterActive(f, f.type === 'search' ? localSearch : values[f.key])),
    [filters, values, localSearch]
  );

  // Handlers
  const handleChange = useCallback(
    (key: string, value: unknown) => {
      startTransition(() => {
        onChange({ ...values, [key]: value });
      });
    },
    [onChange, values]
  );

  const handleReset = useCallback(() => {
    setLocalSearch('');
    if (onReset) {
      onReset();
    } else {
      const resetValues: FilterValues = {};
      for (const f of filters) {
        if (f.type === 'search') resetValues[f.key] = '';
        else if (f.type === 'multi-select') resetValues[f.key] = [];
        else if (f.type === 'boolean') resetValues[f.key] = false;
        else if (f.type === 'date-range') {
          resetValues[`${f.key}From`] = '';
          resetValues[`${f.key}To`] = '';
        } else if (f.type === 'number-range') {
          resetValues[`${f.key}Min`] = '';
          resetValues[`${f.key}Max`] = '';
        } else {
          resetValues[f.key] = '';
        }
      }
      onChange(resetValues);
    }
  }, [onReset, onChange, filters]);

  // Render individual filter
  const renderFilter = useCallback(
    (config: FilterConfig): ReactNode => {
      const { key, type, label, placeholder, options, width } = config;

      switch (type) {
        case 'search':
          return (
            <SearchInput
              key={key}
              value={localSearch}
              onChange={setLocalSearch}
              placeholder={placeholder ?? 'Search...'}
              fullWidth={false}
              minWidth={width ?? 220}
            />
          );

        case 'select':
          return (
            <TextField
              key={key}
              select
              size="small"
              value={(values[key] as string) ?? ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(key, e.target.value)}
              slotProps={{ select: { displayEmpty: true } }}
              sx={{
                minWidth: width ?? 150,
                '& .MuiOutlinedInput-root': { borderRadius: 1 },
                '& .MuiOutlinedInput-notchedOutline legend': { width: 0 },
              }}
            >
              <MenuItem value="">
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </MenuItem>
              {options?.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          );

        case 'multi-select': {
          const selectedValues = (values[key] as string[] | undefined) ?? [];
          return (
            <TextField
              key={key}
              select
              size="small"
              value={selectedValues}
              onChange={(e: any) => handleChange(key, e.target.value)}
              slotProps={{
                select: {
                  multiple: true,
                  displayEmpty: true,
                  renderValue: (selected: unknown) => {
                    const sel = selected as string[];
                    if (sel.length === 0) {
                      return (
                        <Typography variant="body2" color="text.secondary">
                          {label}
                        </Typography>
                      );
                    }
                    return (
                      <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }}>
                        {sel.map((val) => {
                          const opt = options?.find((o) => o.value === val);
                          return (
                            <Chip
                              key={val}
                              label={opt?.label ?? val}
                              size="small"
                              sx={{ height: 20, fontSize: '0.75rem' }}
                            />
                          );
                        })}
                      </Stack>
                    );
                  },
                },
              }}
              sx={{
                minWidth: width ?? 180,
                '& .MuiOutlinedInput-root': { borderRadius: 1 },
                '& .MuiOutlinedInput-notchedOutline legend': { width: 0 },
              }}
            >
              {options?.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          );
        }

        case 'date-range':
          return (
            <DateRangeInput
              key={key}
              label={label}
              startDate={(values[`${key}From`] as string) ?? ''}
              endDate={(values[`${key}To`] as string) ?? ''}
              onChange={(from, to) => {
                handleChange(`${key}From`, from);
                handleChange(`${key}To`, to);
              }}
              width={width ?? 220}
              size="small"
            />
          );

        case 'boolean':
          return (
            <Chip
              key={key}
              label={label}
              variant={values[key] ? 'filled' : 'outlined'}
              color={values[key] ? 'primary' : 'default'}
              onClick={() => handleChange(key, !values[key])}
              size="small"
              sx={{
                borderRadius: 1,
                fontWeight: 500,
                height: 32,
                cursor: 'pointer',
                transition: (theme) =>
                  theme.transitions.create(['background-color', 'color', 'border-color'], {
                    duration: theme.transitions.duration.shorter,
                  }),
              }}
            />
          );

        case 'number-range':
          return (
            <Stack key={key} direction="row" spacing={1} alignItems="center">
              <TextField
                type="number"
                size="small"
                label={`${label} min`}
                value={(values[`${key}Min`] as string) ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(`${key}Min`, e.target.value)}
                sx={{ minWidth: width ?? 100 }}
              />
              <Typography variant="body2" color="text.disabled" sx={{ px: 0.5 }}>
                —
              </Typography>
              <TextField
                type="number"
                size="small"
                label={`${label} max`}
                value={(values[`${key}Max`] as string) ?? ''}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(`${key}Max`, e.target.value)}
                sx={{ minWidth: width ?? 100 }}
              />
            </Stack>
          );

        default:
          return null;
      }
    },
    [localSearch, values, handleChange]
  );

  return (
    <Stack
      spacing={compact ? 0 : 1.5}
      sx={{
        p: 2,
        borderRadius: 1,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.5),
        ...sx,
      }}
    >
      {/* Filter controls row */}
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1.5}>
        {filters.map(renderFilter)}

        {/* Active filter count + reset */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ ml: 'auto' }}>
          {activeCount > 0 && (
            <Badge badgeContent={activeCount} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem' } }}>
              <Box sx={{ color: 'text.secondary', display: 'flex', alignItems: 'center' }}>
                <FilterIcon />
              </Box>
            </Badge>
          )}

          {hasAnyActive && (
            <Button
              size="small"
              onClick={handleReset}
              sx={{
                minWidth: 0,
                px: 1.5,
                fontSize: '0.75rem',
                fontWeight: 500,
                color: 'text.secondary',
                '&:hover': { color: 'text.primary' },
              }}
            >
              Reset
            </Button>
          )}
        </Stack>
      </Stack>

      {/* Results count */}
      {total !== undefined && !compact && (
        <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5 }}>
          {total.toLocaleString()} result{total !== 1 ? 's' : ''}
        </Typography>
      )}
    </Stack>
  );
}
