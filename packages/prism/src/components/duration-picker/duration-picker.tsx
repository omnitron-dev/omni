'use client';

/**
 * DurationPicker — Compact duration selector with presets and custom input.
 *
 * Designed for moderation actions (ban/mute) in dialogs or menus.
 * Value is in seconds; `null` represents permanent/indefinite duration.
 */

import { useCallback, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import type { SelectChangeEvent } from '@mui/material/Select';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;

type TimeUnit = 'hours' | 'days' | 'weeks';

interface Preset {
  label: string;
  value: number | null; // seconds, null = permanent
  key: string;
}

const PRESETS: Preset[] = [
  { label: '1h', value: HOUR, key: '1h' },
  { label: '6h', value: 6 * HOUR, key: '6h' },
  { label: '1d', value: DAY, key: '1d' },
  { label: '7d', value: 7 * DAY, key: '7d' },
  { label: '30d', value: 30 * DAY, key: '30d' },
  { label: '\u221E', value: null, key: 'permanent' },
];

const UNIT_SECONDS: Record<TimeUnit, number> = {
  hours: HOUR,
  days: DAY,
  weeks: WEEK,
};

const CUSTOM_KEY = 'custom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DurationPickerLabels {
  /** Title label. @default 'Duration' */
  title?: string;
  /** Custom button label. @default 'Custom' */
  custom?: string;
  /** Time unit labels. */
  hours?: string;
  days?: string;
  weeks?: string;
}

export interface DurationPickerProps {
  /** Duration in seconds. `null` = permanent/indefinite. */
  value: number | null;
  /** Called when duration changes. */
  onChange: (seconds: number | null) => void;
  /** Component size. @default 'small' */
  size?: 'small' | 'medium';
  /** Disable all interactions. */
  disabled?: boolean;
  /** Override default English labels for i18n. */
  labels?: DurationPickerLabels;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find which preset key matches the current value, or 'custom' if none. */
function resolveActiveKey(value: number | null): string {
  const match = PRESETS.find((p) => p.value === value);
  return match ? match.key : CUSTOM_KEY;
}

/** Decompose seconds into a human-friendly { amount, unit } pair. */
function decomposeSeconds(seconds: number): { amount: number; unit: TimeUnit } {
  if (seconds > 0 && seconds % WEEK === 0) return { amount: seconds / WEEK, unit: 'weeks' };
  if (seconds > 0 && seconds % DAY === 0) return { amount: seconds / DAY, unit: 'days' };
  return { amount: Math.max(1, Math.round(seconds / HOUR)), unit: 'hours' };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DurationPicker({ value, onChange, size = 'small', disabled = false, labels }: DurationPickerProps) {
  const theme = useTheme();

  const activeKey = useMemo(() => resolveActiveKey(value), [value]);

  // Local state for custom input — only used when custom is active
  const [customAmount, setCustomAmount] = useState<number>(() => {
    if (activeKey === CUSTOM_KEY && value !== null && value > 0) {
      return decomposeSeconds(value).amount;
    }
    return 1;
  });
  const [customUnit, setCustomUnit] = useState<TimeUnit>(() => {
    if (activeKey === CUSTOM_KEY && value !== null && value > 0) {
      return decomposeSeconds(value).unit;
    }
    return 'hours';
  });

  const isCustom = activeKey === CUSTOM_KEY;

  // ------- Handlers -------

  const handlePresetChange = useCallback(
    (_: React.MouseEvent<HTMLElement>, newKey: string | null) => {
      if (newKey === null) return; // MUI fires null on deselect — ignore
      if (newKey === CUSTOM_KEY) {
        // Switch to custom — emit current custom values
        onChange(customAmount * UNIT_SECONDS[customUnit]);
        return;
      }
      const preset = PRESETS.find((p) => p.key === newKey);
      if (preset) onChange(preset.value);
    },
    [onChange, customAmount, customUnit]
  );

  const handleCustomAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseInt(e.target.value, 10);
      const clamped = Number.isFinite(raw) && raw > 0 ? raw : 1;
      setCustomAmount(clamped);
      onChange(clamped * UNIT_SECONDS[customUnit]);
    },
    [onChange, customUnit]
  );

  const handleCustomUnitChange = useCallback(
    (e: SelectChangeEvent<TimeUnit>) => {
      const unit = e.target.value as TimeUnit;
      setCustomUnit(unit);
      onChange(customAmount * UNIT_SECONDS[unit]);
    },
    [onChange, customAmount]
  );

  // ------- Styles -------

  const toggleSx = {
    '& .MuiToggleButton-root': {
      px: size === 'small' ? 1.25 : 1.75,
      py: size === 'small' ? 0.5 : 0.75,
      fontSize: size === 'small' ? '0.8125rem' : '0.875rem',
      fontWeight: 600,
      lineHeight: 1.5,
      borderColor: alpha(theme.palette.divider, 0.2),
      color: theme.palette.text.secondary,
      textTransform: 'none' as const,
      '&.Mui-selected': {
        color: theme.palette.primary.main,
        bgcolor: alpha(theme.palette.primary.main, 0.08),
        borderColor: alpha(theme.palette.primary.main, 0.3),
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.16),
        },
      },
      '&.Mui-disabled': {
        color: theme.palette.text.disabled,
      },
    },
  };

  return (
    <Box>
      <Typography
        variant="caption"
        sx={{
          mb: 0.75,
          display: 'block',
          fontWeight: 600,
          color: 'text.secondary',
        }}
      >
        {labels?.title ?? 'Duration'}
      </Typography>

      <ToggleButtonGroup
        exclusive
        value={isCustom ? CUSTOM_KEY : activeKey}
        onChange={handlePresetChange}
        size={size}
        disabled={disabled}
        sx={{
          ...toggleSx,
          flexWrap: 'wrap',
          gap: 0.5,
          '& .MuiToggleButtonGroup-grouped': {
            border: '1px solid',
            borderRadius: '8px !important',
            borderColor: alpha(theme.palette.divider, 0.2),
            '&:not(:first-of-type)': {
              borderLeft: '1px solid',
              borderColor: alpha(theme.palette.divider, 0.2),
              marginLeft: 0,
            },
          },
        }}
      >
        {PRESETS.map((preset) => (
          <ToggleButton key={preset.key} value={preset.key}>
            {preset.label}
          </ToggleButton>
        ))}
        <ToggleButton value={CUSTOM_KEY}>{labels?.custom ?? 'Custom'}</ToggleButton>
      </ToggleButtonGroup>

      {/* Custom duration input row */}
      {isCustom && (
        <Box
          sx={{
            mt: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <TextField
            type="number"
            value={customAmount}
            onChange={handleCustomAmountChange}
            disabled={disabled}
            size={size}
            slotProps={{
              htmlInput: { min: 1, max: 9999, style: { textAlign: 'center' } },
            }}
            sx={{ width: 80 }}
          />
          <Select<TimeUnit>
            value={customUnit}
            onChange={handleCustomUnitChange}
            disabled={disabled}
            size={size}
            sx={{ minWidth: 100 }}
          >
            <MenuItem value="hours">{labels?.hours ?? 'hours'}</MenuItem>
            <MenuItem value="days">{labels?.days ?? 'days'}</MenuItem>
            <MenuItem value="weeks">{labels?.weeks ?? 'weeks'}</MenuItem>
          </Select>
        </Box>
      )}
    </Box>
  );
}
