'use client';

/**
 * Settings Drawer
 *
 * UI component for managing application settings.
 * Displays configurable sections for theme, layout, and preferences.
 *
 * @module @omnitron-dev/prism/components/settings
 */

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import { alpha, useTheme } from '@mui/material/styles';

// Icons - using unicode/text since we don't have icon package
const CloseIcon = () => <span style={{ fontSize: 20 }}>✕</span>;
const RefreshIcon = () => <span style={{ fontSize: 16 }}>↻</span>;
const SunIcon = () => <span style={{ fontSize: 18 }}>☀</span>;
const MoonIcon = () => <span style={{ fontSize: 18 }}>☾</span>;

import { useSettings } from './settings-provider.js';
import type { ComponentDensity } from '../../types/theme.js';
import type { NavLayout } from '../../state/stores/settings.js';
import { PRESET_NAMES, PRESET_DISPLAY_NAMES } from '../../theme/create-theme.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Settings drawer props.
 */
export interface SettingsDrawerProps {
  /** Drawer width */
  width?: number;
  /** Sections to display */
  sections?: SettingsSection[];
}

/**
 * Available settings sections.
 */
export type SettingsSection =
  | 'mode'
  | 'contrast'
  | 'direction'
  | 'presets'
  | 'primaryColor'
  | 'fontSize'
  | 'density'
  | 'navLayout'
  | 'stretch';

// =============================================================================
// PRESET COLORS
// =============================================================================

const PRESET_COLORS: Record<string, string> = {
  'default-light': '#3385F0',
  'default-dark': '#3385F0',
  luxury: '#B8860B',
  arctic: '#1E88E5',
  nature: '#22C55E',
  ember: '#FF5F11',
  dracula: '#BD93F9',
  midnight: '#6366F1',
  retro: '#F59E0B',
  minimal: '#64748B',
};

// =============================================================================
// SECTION COMPONENTS
// =============================================================================

interface SectionProps {
  title: string;
  children: ReactNode;
}

function Section({ title, children }: SectionProps): ReactNode {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          mb: 1.5,
          fontWeight: 600,
          color: 'text.secondary',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

// =============================================================================
// MODE SECTION
// =============================================================================

function ModeSection(): ReactNode {
  const { settings, actions } = useSettings();
  const theme = useTheme();

  return (
    <Section title="Mode">
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={settings.mode}
        onChange={(_, value) => value && actions.setMode(value)}
        sx={{ gap: 1 }}
      >
        <ToggleButton
          value="light"
          sx={{
            flex: 1,
            py: 1.5,
            gap: 1,
            border: `1px solid ${theme.palette.divider}`,
            '&.Mui-selected': {
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              borderColor: theme.palette.primary.main,
            },
          }}
        >
          <SunIcon /> Light
        </ToggleButton>
        <ToggleButton
          value="dark"
          sx={{
            flex: 1,
            py: 1.5,
            gap: 1,
            border: `1px solid ${theme.palette.divider}`,
            '&.Mui-selected': {
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              borderColor: theme.palette.primary.main,
            },
          }}
        >
          <MoonIcon /> Dark
        </ToggleButton>
      </ToggleButtonGroup>
    </Section>
  );
}

// =============================================================================
// CONTRAST SECTION
// =============================================================================

function ContrastSection(): ReactNode {
  const { settings, actions } = useSettings();

  return (
    <Section title="Contrast">
      <FormControlLabel
        control={
          <Switch
            checked={settings.contrast === 'high'}
            onChange={(e) => actions.setContrast(e.target.checked ? 'high' : 'default')}
          />
        }
        label="High Contrast"
        sx={{ ml: 0 }}
      />
    </Section>
  );
}

// =============================================================================
// DIRECTION SECTION
// =============================================================================

function DirectionSection(): ReactNode {
  const { settings, actions } = useSettings();
  const theme = useTheme();

  return (
    <Section title="Direction">
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={settings.direction}
        onChange={(_, value) => value && actions.setDirection(value)}
        sx={{ gap: 1 }}
      >
        <ToggleButton
          value="ltr"
          sx={{
            flex: 1,
            py: 1,
            border: `1px solid ${theme.palette.divider}`,
            '&.Mui-selected': {
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              borderColor: theme.palette.primary.main,
            },
          }}
        >
          LTR
        </ToggleButton>
        <ToggleButton
          value="rtl"
          sx={{
            flex: 1,
            py: 1,
            border: `1px solid ${theme.palette.divider}`,
            '&.Mui-selected': {
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              borderColor: theme.palette.primary.main,
            },
          }}
        >
          RTL
        </ToggleButton>
      </ToggleButtonGroup>
    </Section>
  );
}

// =============================================================================
// PRESETS SECTION
// =============================================================================

function PresetsSection(): ReactNode {
  const { settings, actions } = useSettings();
  const theme = useTheme();

  return (
    <Section title="Presets">
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 1.5,
        }}
      >
        {PRESET_NAMES.map((preset) => {
          const isSelected = settings.preset === preset;
          const color = PRESET_COLORS[preset] || '#666';

          return (
            <Tooltip key={preset} title={PRESET_DISPLAY_NAMES[preset]} placement="top">
              <Box
                onClick={() => actions.setPreset(preset)}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '50%',
                  bgcolor: color,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: isSelected ? `3px solid ${theme.palette.text.primary}` : '3px solid transparent',
                  boxShadow: isSelected ? `0 0 0 2px ${color}` : 'none',
                  transition: 'all 0.2s',
                  '&:hover': {
                    transform: 'scale(1.1)',
                  },
                }}
              >
                {isSelected && (
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: 'white',
                    }}
                  />
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Section>
  );
}

// =============================================================================
// PRIMARY COLOR SECTION
// =============================================================================

const COLOR_OPTIONS = [
  { label: 'Blue', value: '#3385F0' },
  { label: 'Green', value: '#22C55E' },
  { label: 'Purple', value: '#8B5CF6' },
  { label: 'Red', value: '#EF4444' },
  { label: 'Orange', value: '#F97316' },
  { label: 'Cyan', value: '#06B6D4' },
  { label: 'Pink', value: '#EC4899' },
  { label: 'Amber', value: '#F59E0B' },
];

function PrimaryColorSection(): ReactNode {
  const { settings, actions } = useSettings();
  const theme = useTheme();

  return (
    <Section title="Primary Color">
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {COLOR_OPTIONS.map((option) => {
          const isSelected = settings.primaryColor === option.value;

          return (
            <Tooltip key={option.value} title={option.label} placement="top">
              <Box
                onClick={() => actions.setPrimaryColor(option.value)}
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: option.value,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: isSelected ? `2px solid ${theme.palette.text.primary}` : '2px solid transparent',
                  transition: 'transform 0.2s',
                  '&:hover': {
                    transform: 'scale(1.15)',
                  },
                }}
              >
                {isSelected && (
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      bgcolor: 'white',
                    }}
                  />
                )}
              </Box>
            </Tooltip>
          );
        })}
        {settings.primaryColor && (
          <Tooltip title="Reset to default" placement="top">
            <Box
              onClick={() => actions.setPrimaryColor(null)}
              sx={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                border: `1px dashed ${theme.palette.divider}`,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'text.secondary',
                fontSize: 14,
                '&:hover': {
                  borderColor: theme.palette.text.primary,
                },
              }}
            >
              <RefreshIcon />
            </Box>
          </Tooltip>
        )}
      </Box>
    </Section>
  );
}

// =============================================================================
// FONT SIZE SECTION
// =============================================================================

function FontSizeSection(): ReactNode {
  const { settings, actions } = useSettings();

  return (
    <Section title="Font Size">
      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="body2" sx={{ minWidth: 24, color: 'text.secondary' }}>
          A
        </Typography>
        <Slider
          min={14}
          max={18}
          step={1}
          value={settings.fontSize}
          onChange={(_, value) => actions.setFontSize(value as number)}
          valueLabelDisplay="auto"
          marks
          sx={{ flex: 1 }}
        />
        <Typography variant="body1" sx={{ minWidth: 24, fontWeight: 600 }}>
          A
        </Typography>
      </Stack>
    </Section>
  );
}

// =============================================================================
// DENSITY SECTION
// =============================================================================

function DensitySection(): ReactNode {
  const { settings, actions } = useSettings();
  const theme = useTheme();

  const densityOptions: { value: ComponentDensity; label: string }[] = [
    { value: 'compact', label: 'Compact' },
    { value: 'standard', label: 'Standard' },
    { value: 'comfortable', label: 'Comfortable' },
  ];

  return (
    <Section title="Density">
      <ToggleButtonGroup
        exclusive
        fullWidth
        value={settings.density}
        onChange={(_, value) => value && actions.setDensity(value)}
        sx={{ gap: 1 }}
      >
        {densityOptions.map((option) => (
          <ToggleButton
            key={option.value}
            value={option.value}
            sx={{
              flex: 1,
              py: 1,
              fontSize: '0.75rem',
              border: `1px solid ${theme.palette.divider}`,
              '&.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, 0.08),
                borderColor: theme.palette.primary.main,
              },
            }}
          >
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Section>
  );
}

// =============================================================================
// NAV LAYOUT SECTION
// =============================================================================

function NavLayoutSection(): ReactNode {
  const { settings, actions } = useSettings();
  const theme = useTheme();

  const layoutOptions: { value: NavLayout; label: string; icon: string }[] = [
    { value: 'vertical', label: 'Vertical', icon: '▌' },
    { value: 'horizontal', label: 'Horizontal', icon: '▬' },
    { value: 'mini', label: 'Mini', icon: '│' },
  ];

  return (
    <Section title="Navigation Layout">
      <Box sx={{ display: 'flex', gap: 1.5 }}>
        {layoutOptions.map((option) => {
          const isSelected = settings.navLayout === option.value;

          return (
            <Box
              key={option.value}
              onClick={() => actions.setNavLayout(option.value)}
              sx={{
                flex: 1,
                py: 2,
                px: 1,
                borderRadius: 1,
                cursor: 'pointer',
                textAlign: 'center',
                border: `1px solid ${isSelected ? theme.palette.primary.main : theme.palette.divider}`,
                bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: theme.palette.primary.main,
                },
              }}
            >
              <Typography sx={{ fontSize: 24, mb: 0.5, lineHeight: 1 }}>{option.icon}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {option.label}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Section>
  );
}

// =============================================================================
// STRETCH SECTION
// =============================================================================

function StretchSection(): ReactNode {
  const { settings, actions } = useSettings();

  return (
    <Section title="Layout">
      <FormControlLabel
        control={<Switch checked={settings.stretch} onChange={(e) => actions.setStretch(e.target.checked)} />}
        label="Stretch to full width"
        sx={{ ml: 0 }}
      />
    </Section>
  );
}

// =============================================================================
// SECTION MAP
// =============================================================================

const SECTION_COMPONENTS: Record<SettingsSection, () => ReactNode> = {
  mode: ModeSection,
  contrast: ContrastSection,
  direction: DirectionSection,
  presets: PresetsSection,
  primaryColor: PrimaryColorSection,
  fontSize: FontSizeSection,
  density: DensitySection,
  navLayout: NavLayoutSection,
  stretch: StretchSection,
};

const DEFAULT_SECTIONS: SettingsSection[] = ['mode', 'presets', 'primaryColor', 'density', 'navLayout', 'stretch'];

// =============================================================================
// SETTINGS DRAWER
// =============================================================================

/**
 * Settings Drawer - Configurable settings panel.
 *
 * @example
 * ```tsx
 * // Basic usage - must be inside SettingsProvider
 * <SettingsDrawer />
 *
 * // With custom sections
 * <SettingsDrawer
 *   sections={['mode', 'presets', 'primaryColor']}
 *   width={320}
 * />
 * ```
 */
export function SettingsDrawer({ width = 300, sections = DEFAULT_SECTIONS }: SettingsDrawerProps): ReactNode {
  const { drawer, canReset, actions } = useSettings();
  const theme = useTheme();

  return (
    <Drawer
      anchor="right"
      open={drawer.open}
      onClose={drawer.onClose}
      PaperProps={{
        sx: {
          width,
          backgroundImage: 'none',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Settings
        </Typography>
        <Stack direction="row" spacing={0.5}>
          {canReset && (
            <Tooltip title="Reset to defaults">
              <IconButton size="small" onClick={actions.reset} aria-label="Reset settings to defaults">
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          )}
          <IconButton size="small" onClick={drawer.onClose} aria-label="Close settings">
            <CloseIcon />
          </IconButton>
        </Stack>
      </Box>

      {/* Content */}
      <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto' }}>
        {sections.map((section) => {
          const SectionComponent = SECTION_COMPONENTS[section];
          return SectionComponent ? <SectionComponent key={section} /> : null;
        })}
      </Box>

      {/* Footer */}
      <Box sx={{ p: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Button fullWidth variant="soft" color="primary" onClick={drawer.onClose}>
          Close
        </Button>
      </Box>
    </Drawer>
  );
}
