'use client';

/**
 * useConfigFromQuery Hook
 *
 * Syncs theme/config settings with URL query parameters.
 * Enables shareable configuration links for demos and previews.
 *
 * Query parameter format: ?preset=luxury&mode=dark&primary=%23FF5630
 *
 * @module @omnitron/prism/hooks
 */

import { useEffect, useCallback, useMemo } from 'react';
import type { ThemePreset, ThemeMode, ThemeDirection, ComponentDensity } from '../types/theme.js';
import { PRESET_NAMES } from '../theme/create-theme.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Configuration values that can be controlled via URL params.
 */
export interface UrlConfigValues {
  /** Theme preset */
  preset?: ThemePreset;
  /** Light/dark/system mode */
  mode?: ThemeMode;
  /** Primary color (hex) */
  primary?: string;
  /** Text direction */
  direction?: ThemeDirection;
  /** Component density */
  density?: ComponentDensity;
  /** Contrast mode */
  contrast?: 'default' | 'high';
}

/**
 * Options for useConfigFromQuery hook.
 */
export interface UseConfigFromQueryOptions {
  /** Query parameter names mapping (default: 'preset', 'mode', 'primary', etc.) */
  paramNames?: {
    preset?: string;
    mode?: string;
    primary?: string;
    direction?: string;
    density?: string;
    contrast?: string;
  };
  /** Callback when config changes from URL */
  onConfigChange?: (config: UrlConfigValues) => void;
  /** Enable two-way sync (updates URL when config changes) */
  syncToUrl?: boolean;
}

/**
 * Return type for useConfigFromQuery hook.
 */
export interface UseConfigFromQueryReturn {
  /** Parsed config values from URL */
  configFromUrl: UrlConfigValues;
  /** Update URL with new config values */
  updateUrl: (values: Partial<UrlConfigValues>) => void;
  /** Clear all config from URL */
  clearUrl: () => void;
  /** Generate URL with config values */
  generateUrl: (values: Partial<UrlConfigValues>, baseUrl?: string) => string;
  /** Check if URL has any config params */
  hasUrlConfig: boolean;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_PARAM_NAMES = {
  preset: 'preset',
  mode: 'mode',
  primary: 'primary',
  direction: 'dir',
  density: 'density',
  contrast: 'contrast',
} as const;

const VALID_MODES: ThemeMode[] = ['light', 'dark', 'system'];
const VALID_DIRECTIONS: ThemeDirection[] = ['ltr', 'rtl'];
const VALID_DENSITIES: ComponentDensity[] = ['compact', 'standard', 'comfortable'];
const VALID_CONTRASTS = ['default', 'high'] as const;

// =============================================================================
// VALIDATORS
// =============================================================================

function isValidPreset(value: string | null): value is ThemePreset {
  return value !== null && PRESET_NAMES.includes(value as ThemePreset);
}

function isValidMode(value: string | null): value is ThemeMode {
  return value !== null && VALID_MODES.includes(value as ThemeMode);
}

function isValidDirection(value: string | null): value is ThemeDirection {
  return value !== null && VALID_DIRECTIONS.includes(value as ThemeDirection);
}

function isValidDensity(value: string | null): value is ComponentDensity {
  return value !== null && VALID_DENSITIES.includes(value as ComponentDensity);
}

function isValidContrast(value: string | null): value is 'default' | 'high' {
  return value !== null && (VALID_CONTRASTS as readonly string[]).includes(value);
}

function isValidHexColor(value: string | null): boolean {
  if (!value) return false;
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to sync theme configuration with URL query parameters.
 *
 * Enables shareable configuration links for demos, previews, and design reviews.
 *
 * @param options - Hook options
 * @returns Object with URL config parsing and manipulation utilities
 *
 * @example
 * ```tsx
 * import { useConfigFromQuery } from '@omnitron/prism/hooks';
 *
 * function ThemeSettings() {
 *   const {
 *     configFromUrl,
 *     updateUrl,
 *     generateUrl,
 *     hasUrlConfig,
 *   } = useConfigFromQuery({
 *     onConfigChange: (config) => {
 *       // Apply config to your theme context
 *       if (config.preset) setPreset(config.preset);
 *       if (config.mode) setMode(config.mode);
 *       if (config.primary) setPrimaryColor(config.primary);
 *     },
 *   });
 *
 *   // Generate shareable link
 *   const shareUrl = generateUrl({
 *     preset: currentPreset,
 *     mode: currentMode,
 *     primary: currentPrimary,
 *   });
 *
 *   return (
 *     <div>
 *       {hasUrlConfig && <Alert>Using config from URL</Alert>}
 *       <Button onClick={() => navigator.clipboard.writeText(shareUrl)}>
 *         Copy Share Link
 *       </Button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useConfigFromQuery(options: UseConfigFromQueryOptions = {}): UseConfigFromQueryReturn {
  const { paramNames = DEFAULT_PARAM_NAMES, onConfigChange, syncToUrl = false } = options;

  // Merge with defaults
  const params = { ...DEFAULT_PARAM_NAMES, ...paramNames };

  // Parse config from current URL
  const configFromUrl = useMemo<UrlConfigValues>(() => {
    if (typeof window === 'undefined') return {};

    const searchParams = new URLSearchParams(window.location.search);
    const config: UrlConfigValues = {};

    const presetValue = searchParams.get(params.preset);
    if (isValidPreset(presetValue)) {
      config.preset = presetValue;
    }

    const modeValue = searchParams.get(params.mode);
    if (isValidMode(modeValue)) {
      config.mode = modeValue;
    }

    const primaryValue = searchParams.get(params.primary);
    if (isValidHexColor(primaryValue)) {
      config.primary = primaryValue as string;
    }

    const directionValue = searchParams.get(params.direction);
    if (isValidDirection(directionValue)) {
      config.direction = directionValue;
    }

    const densityValue = searchParams.get(params.density);
    if (isValidDensity(densityValue)) {
      config.density = densityValue;
    }

    const contrastValue = searchParams.get(params.contrast);
    if (isValidContrast(contrastValue)) {
      config.contrast = contrastValue;
    }

    return config;
  }, [params.preset, params.mode, params.primary, params.direction, params.density, params.contrast]);

  // Notify on config change from URL
  useEffect(() => {
    if (onConfigChange && Object.keys(configFromUrl).length > 0) {
      onConfigChange(configFromUrl);
    }
  }, [configFromUrl, onConfigChange]);

  // Update URL with new config values
  const updateUrl = useCallback(
    (values: Partial<UrlConfigValues>) => {
      if (typeof window === 'undefined') return;

      const searchParams = new URLSearchParams(window.location.search);

      // Update or remove each param
      if (values.preset !== undefined) {
        if (values.preset) {
          searchParams.set(params.preset, values.preset);
        } else {
          searchParams.delete(params.preset);
        }
      }

      if (values.mode !== undefined) {
        if (values.mode) {
          searchParams.set(params.mode, values.mode);
        } else {
          searchParams.delete(params.mode);
        }
      }

      if (values.primary !== undefined) {
        if (values.primary) {
          searchParams.set(params.primary, values.primary);
        } else {
          searchParams.delete(params.primary);
        }
      }

      if (values.direction !== undefined) {
        if (values.direction) {
          searchParams.set(params.direction, values.direction);
        } else {
          searchParams.delete(params.direction);
        }
      }

      if (values.density !== undefined) {
        if (values.density) {
          searchParams.set(params.density, values.density);
        } else {
          searchParams.delete(params.density);
        }
      }

      if (values.contrast !== undefined) {
        if (values.contrast) {
          searchParams.set(params.contrast, values.contrast);
        } else {
          searchParams.delete(params.contrast);
        }
      }

      // Update URL without page reload
      const newUrl = searchParams.toString()
        ? `${window.location.pathname}?${searchParams.toString()}`
        : window.location.pathname;

      window.history.replaceState({}, '', newUrl);
    },
    [params]
  );

  // Clear all config from URL
  const clearUrl = useCallback(() => {
    if (typeof window === 'undefined') return;

    const searchParams = new URLSearchParams(window.location.search);

    // Remove all config params
    searchParams.delete(params.preset);
    searchParams.delete(params.mode);
    searchParams.delete(params.primary);
    searchParams.delete(params.direction);
    searchParams.delete(params.density);
    searchParams.delete(params.contrast);

    const newUrl = searchParams.toString()
      ? `${window.location.pathname}?${searchParams.toString()}`
      : window.location.pathname;

    window.history.replaceState({}, '', newUrl);
  }, [params]);

  // Generate URL with config values
  const generateUrl = useCallback(
    (values: Partial<UrlConfigValues>, baseUrl?: string) => {
      const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '');
      const searchParams = new URLSearchParams();

      if (values.preset) {
        searchParams.set(params.preset, values.preset);
      }
      if (values.mode) {
        searchParams.set(params.mode, values.mode);
      }
      if (values.primary) {
        searchParams.set(params.primary, values.primary);
      }
      if (values.direction) {
        searchParams.set(params.direction, values.direction);
      }
      if (values.density) {
        searchParams.set(params.density, values.density);
      }
      if (values.contrast) {
        searchParams.set(params.contrast, values.contrast);
      }

      const queryString = searchParams.toString();
      return queryString ? `${base}?${queryString}` : base;
    },
    [params]
  );

  // Check if URL has any config params
  const hasUrlConfig = Object.keys(configFromUrl).length > 0;

  return {
    configFromUrl,
    updateUrl,
    clearUrl,
    generateUrl,
    hasUrlConfig,
  };
}
