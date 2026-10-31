import { SearchIcon as SearchGlyph, CloseIcon } from '../../icons/controls.js';
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

import { useState, useEffect, useRef, type ChangeEvent, type ReactNode } from 'react';
import type { Ref } from 'react';
import InputBase from '@mui/material/InputBase';
import InputAdornment from '@mui/material/InputAdornment';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import { alpha, useTheme, type SxProps, type Theme } from '@mui/material/styles';

// ---------------------------------------------------------------------------
// Icons (inline SVG — no external dependency)
// ---------------------------------------------------------------------------

function SearchIcon({ size = 18 }: { size?: number }): ReactNode {
  return <SearchGlyph sx={{ fontSize: size }} />;
}

function ClearIcon(): ReactNode {
  return <CloseIcon sx={{ fontSize: 16 }} />;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchInputProps {
  /** Current value (controlled). */
  value?: string;
  /** Change handler. Receives the raw string (or debounced string if `debounce` > 0). */
  onChange?: (value: string) => void;
  /** Accessible name; defaults to the placeholder. */
  'aria-label'?: string;
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

export function SearchInput({
  value: controlledValue,
  onChange,
  placeholder = 'Search...',
  'aria-label': ariaLabel,
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
  ref,
}: SearchInputProps & { ref?: Ref<HTMLInputElement> }) {
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
      data-keyboard-search
      ref={ref}
      fullWidth={fullWidth}
      placeholder={placeholder}
      inputProps={{ 'aria-label': ariaLabel ?? placeholder }}
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
                aria-label={clearTooltip}
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
}
