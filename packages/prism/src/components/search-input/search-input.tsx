/**
 * SearchInput — Unified search field for the entire platform.
 *
 * Features:
 * - Consistent styling (filled appearance, no outline notch issues)
 * - Built-in search icon (left) and clear button (right)
 * - Optional debounce for expensive filters
 * - Compact mode for sidebars (smaller padding)
 * - Works standalone or controlled
 */

import { useState, useEffect, useRef, forwardRef, type ChangeEvent, type ReactNode } from 'react';
import InputBase from '@mui/material/InputBase';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { alpha, useTheme, type SxProps, type Theme } from '@mui/material/styles';

// ---------------------------------------------------------------------------
// Icons (inline SVG — no external dependency)
// ---------------------------------------------------------------------------

function SearchIcon({ size = 18 }: { size?: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function ClearIcon(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchInputProps {
  /** Current value (controlled). */
  value?: string;
  /** Change handler. Receives the raw string (or debounced string if `debounce` > 0). */
  onChange?: (value: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Debounce delay in ms. 0 = no debounce (default). */
  debounce?: number;
  /** Compact mode — smaller padding, for sidebars and tight spaces. */
  compact?: boolean;
  /** Full width. Default true. */
  fullWidth?: boolean;
  /** Fixed or min width. */
  width?: number | string;
  /** Min width. */
  minWidth?: number | string;
  /** Clear button tooltip text. */
  clearTooltip?: string;
  /** Autofocus on mount. */
  autoFocus?: boolean;
  /** Focus handler. */
  onFocus?: () => void;
  /** Blur handler. */
  onBlur?: () => void;
  /** Keyboard handler. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Custom sx overrides. */
  sx?: SxProps<Theme>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  {
    value: controlledValue,
    onChange,
    placeholder = 'Search...',
    debounce = 0,
    compact = false,
    fullWidth = true,
    width,
    minWidth,
    clearTooltip = 'Clear',
    autoFocus,
    onFocus,
    onBlur,
    onKeyDown,
    sx,
  },
  ref
) {
  const theme = useTheme();

  // Internal state for debounced mode or uncontrolled usage
  const [localValue, setLocalValue] = useState(controlledValue ?? '');
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync internal state when controlled value changes externally
  useEffect(() => {
    if (controlledValue !== undefined) {
      setLocalValue(controlledValue);
    }
  }, [controlledValue]);

  const displayValue = controlledValue !== undefined && debounce === 0 ? controlledValue : localValue;

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);

    if (debounce > 0) {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange?.(val), debounce);
    } else {
      onChange?.(val);
    }
  };

  const handleClear = () => {
    setLocalValue('');
    clearTimeout(timerRef.current);
    onChange?.('');
  };

  // Cleanup timer
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const py = compact ? 0.625 : 0.75;
  const px = compact ? 1.25 : 1.5;
  const inputPy = compact ? '3px' : '4px';

  return (
    <InputBase
      ref={ref}
      fullWidth={fullWidth}
      placeholder={placeholder}
      value={displayValue}
      onChange={handleChange}
      autoFocus={autoFocus}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      startAdornment={
        <InputAdornment position="start" sx={{ color: 'text.disabled', mr: compact ? 0.75 : 1 }}>
          <SearchIcon size={compact ? 16 : 18} />
        </InputAdornment>
      }
      endAdornment={
        displayValue ? (
          <InputAdornment position="end">
            <Tooltip title={clearTooltip}>
              <Box
                component="button"
                type="button"
                onClick={handleClear}
                sx={{
                  p: 0.25,
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  color: 'text.disabled',
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '50%',
                  '&:hover': { color: 'text.secondary' },
                }}
              >
                <ClearIcon />
              </Box>
            </Tooltip>
          </InputAdornment>
        ) : null
      }
      sx={{
        px,
        py,
        borderRadius: 1,
        fontSize: '0.875rem',
        bgcolor: alpha(theme.palette.grey[500], 0.08),
        transition: theme.transitions.create(['background-color'], {
          duration: theme.transitions.duration.shorter,
        }),
        '&:hover': {
          bgcolor: alpha(theme.palette.grey[500], 0.12),
        },
        '&.Mui-focused': {
          bgcolor: alpha(theme.palette.grey[500], 0.16),
        },
        '& .MuiInputBase-input': {
          py: inputPy,
          px: 0,
          overflow: 'visible',
          '&::placeholder': {
            opacity: 0.64,
          },
        },
        ...(width != null && { width }),
        ...(minWidth != null && { minWidth }),
        ...(!fullWidth && { width: width ?? 'auto' }),
        ...(Array.isArray(sx) ? Object.assign({}, ...sx) : sx),
      }}
    />
  );
});
