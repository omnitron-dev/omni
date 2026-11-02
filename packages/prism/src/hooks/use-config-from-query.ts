'use client';

/**
 * useConfigFromQuery Hook
 *
 * Syncs theme/config settings with URL query parameters.
 * Enables shareable configuration links for demos and previews.
 *
 * Query parameter format: ?preset=luxury&mode=dark&primary=%23FF5630
 *
 * @module @omnitron-dev/prism/hooks
 */

import { useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { useEventCallback } from '@mui/material/utils';
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
  /** Settings to mirror when syncToUrl is enabled. A shared URL takes precedence on mount. */
  values?: UrlConfigValues;
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

const configKeys = Object.keys(DEFAULT_PARAM_NAMES) as (keyof UrlConfigValues)[];
const configUrlChanged = 'prism:config-url-change';
const readSearch = () => window.location.search;
const serverSearch = () => '';

function subscribeToSearch(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(configUrlChanged, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(configUrlChanged, onChange);
  };
}

function replaceUrl(url: URL) {
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, '', url);
    window.dispatchEvent(new Event(configUrlChanged));
  }
}

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
 * import { useConfigFromQuery } from '@omnitron-dev/prism/hooks';
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
  const { paramNames, onConfigChange, syncToUrl = false, values } = options;
  const { preset = 'preset', mode = 'mode', primary = 'primary', direction = 'dir', density = 'density', contrast = 'contrast' } = paramNames ?? DEFAULT_PARAM_NAMES;
  const params = useMemo(() => ({ preset, mode, primary, direction, density, contrast }),
    [preset, mode, primary, direction, density, contrast]);
  const search = useSyncExternalStore(subscribeToSearch, readSearch, serverSearch);
  const configFromUrl = useMemo<UrlConfigValues>(() => {
    const searchParams = new URLSearchParams(search);
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
  }, [params, search]);

  const receivedConfig = useRef(false);
  const notifyConfig = useEventCallback((next: UrlConfigValues) => onConfigChange?.(next));
  useEffect(() => {
    const hasValues = Object.keys(configFromUrl).length > 0;
    if (hasValues || receivedConfig.current) notifyConfig(configFromUrl);
    receivedConfig.current = hasValues;
  }, [configFromUrl, notifyConfig]);

  const applyValues = useCallback((url: URL, next: Partial<UrlConfigValues>) => {
    for (const key of configKeys) {
      const value = next[key];
      if (value !== undefined) {
        if (value) url.searchParams.set(params[key], value);
        else url.searchParams.delete(params[key]);
      }
    }
    return url;
  }, [params]);

  const updateUrl = useCallback((next: Partial<UrlConfigValues>) => {
    if (typeof window !== 'undefined') replaceUrl(applyValues(new URL(window.location.href), next));
  }, [applyValues]);

  const clearUrl = useCallback(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    for (const key of configKeys) url.searchParams.delete(params[key]);
    replaceUrl(url);
  }, [params]);

  // URL navigation is an independent input. Mirror only changes to the supplied
  // settings, so Back and a shared URL cannot be overwritten by an old render.
  const previousValues = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!syncToUrl || !values) { previousValues.current = undefined; return; }
    const signature = JSON.stringify(configKeys.map(key => values[key]));
    const previous = previousValues.current;
    previousValues.current = signature;
    if (previous === signature) return;
    if (previous !== undefined || !configKeys.some(key => new URLSearchParams(window.location.search).has(params[key]))) {
      updateUrl(values);
    }
  }, [syncToUrl, values, params, updateUrl]);

  const generateUrl = useCallback((next: Partial<UrlConfigValues>, baseUrl?: string) => {
    const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const base = baseUrl ?? (typeof window === 'undefined' ? '' : origin + window.location.pathname);
    const url = applyValues(new URL(base || '/', origin), next);
    if (/^[a-z][a-z\d+.-]*:/i.test(base)) return url.href;
    if (base.startsWith('//')) return `//${url.host}${url.pathname}${url.search}${url.hash}`;
    return (base ? base.split(/[?#]/, 1)[0] : '') + url.search + url.hash;
  }, [applyValues]);

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
