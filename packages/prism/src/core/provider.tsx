/**
 * Prism Provider
 *
 * Root provider for the Prism design system.
 * Uses useSettingsStore (Zustand) as the single source of truth for settings.
 *
 * @module @omnitron/prism/core/provider
 */

import type { ReactNode } from 'react';
import { useMemo, useEffect, useCallback } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import rtlPlugin from 'stylis-plugin-rtl';

import type { PrismConfig, PartialPrismConfig } from '../types/config.js';
import type { PrismTheme } from '../types/theme.js';
import { defaultPrismConfig } from '../types/config.js';
import { PrismContext } from './context.js';
import type { PrismSettingsState } from './context.js';
import { useResolvedMode } from './hooks/use-media-query.js';
import { createPrismTheme } from '../theme/create-theme.js';
import { useSettingsStore } from '../state/stores/settings.js';

/**
 * Props for PrismProvider.
 */
export interface PrismProviderProps {
  /** Child components */
  children: ReactNode;
  /** Configuration overrides */
  config?: PartialPrismConfig;
  /** Default settings (overrides defaults but not persisted values) */
  defaultSettings?: Partial<PrismSettingsState>;
  /** Disable CSS baseline */
  disableCssBaseline?: boolean;
  /** Custom theme overrides */
  themeOverrides?: Record<string, unknown>;
}

/**
 * Merge configurations deeply.
 */
function mergeConfig(base: PrismConfig, overrides?: PartialPrismConfig): PrismConfig {
  if (!overrides) return base;

  return {
    ...base,
    ...overrides,
    paths: { ...base.paths, ...overrides.paths },
    registries: { ...base.registries, ...overrides.registries },
    theme: { ...base.theme, ...overrides.theme },
    style: { ...base.style, ...overrides.style },
    features: { ...base.features, ...overrides.features },
  } as PrismConfig;
}

/** Stable no-op for deprecated drawer controls */
const noOpDrawerWarning = () => {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[PrismProvider] Settings drawer is now managed by SettingsProvider. ' +
        'Use useSettingsDrawer() from @omnitron/prism/components/settings instead.'
    );
  }
};

/**
 * PrismProvider - Root provider for Prism design system.
 *
 * Provides theme, settings, and configuration to all child components.
 * Uses Zustand's useSettingsStore as the single source of truth for settings.
 *
 * @example
 * ```tsx
 * import { PrismProvider } from '@omnitron/prism';
 *
 * function App() {
 *   return (
 *     <PrismProvider
 *       config={{
 *         theme: { preset: 'luxury', mode: 'dark' },
 *         features: { darkMode: true, rtl: true },
 *       }}
 *     >
 *       <YourApp />
 *     </PrismProvider>
 *   );
 * }
 * ```
 */
export function PrismProvider({
  children,
  config: configOverrides,
  defaultSettings,
  disableCssBaseline = false,
  themeOverrides,
}: PrismProviderProps): ReactNode {
  // Merge configuration
  const config = useMemo(() => mergeConfig(defaultPrismConfig, configOverrides), [configOverrides]);

  // Use Zustand store as single source of truth for settings
  // Zustand actions are stable references, no need for useCallback wrappers
  const {
    // State values
    mode: storeMode,
    preset: storePreset,
    direction: storeDirection,
    primaryColor: storePrimaryColor,
    contrast: storeContrast,
    compactSidebar,
    fontSize: storeFontSize,
    fontFamily: storeFontFamily,
    navLayout: storeNavLayout,
    navColor: storeNavColor,
    // Actions (stable references from Zustand)
    setMode,
    toggleMode,
    setPreset,
    setDirection,
    setCompactSidebar,
    reset: resetSettings,
  } = useSettingsStore();

  // Initialize store with config values on first mount
  useEffect(() => {
    if (defaultSettings?.mode) setMode(defaultSettings.mode);
    if (defaultSettings?.preset) setPreset(defaultSettings.preset);
    if (defaultSettings?.direction) setDirection(defaultSettings.direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount - intentionally empty deps

  // Create settings object for context (backwards compatibility)
  const settings = useMemo<PrismSettingsState>(
    () => ({
      mode: storeMode,
      preset: storePreset,
      direction: storeDirection,
      sidebarCollapsed: compactSidebar,
      settingsDrawerOpen: false, // Managed by SettingsProvider component
      primaryColor: storePrimaryColor,
      contrast: storeContrast,
      fontSize: storeFontSize,
      fontFamily: storeFontFamily ?? 'Public Sans Variable',
      navLayout: storeNavLayout,
      navColor: storeNavColor,
    }),
    [
      storeMode,
      storePreset,
      storeDirection,
      compactSidebar,
      storePrimaryColor,
      storeContrast,
      storeFontSize,
      storeFontFamily,
      storeNavLayout,
      storeNavColor,
    ]
  );

  // Sidebar toggle — uses functional read from store to avoid stale closure
  const toggleSidebar = useCallback(() => {
    const current = useSettingsStore.getState().compactSidebar;
    setCompactSidebar(!current);
  }, [setCompactSidebar]);

  // Settings drawer is managed by SettingsProvider component
  // These are no-ops for backwards compatibility (stable reference, hoisted below)

  // Emotion cache for RTL support — flips CSS properties automatically via Stylis plugin
  const emotionCache = useMemo(
    () =>
      storeDirection === 'rtl'
        ? createCache({ key: 'prism-rtl', stylisPlugins: [rtlPlugin] })
        : createCache({ key: 'prism-ltr' }),
    [storeDirection]
  );

  // Set document direction attribute (SSR-safe)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = storeDirection;
    }
  }, [storeDirection]);

  // Set document font size (SSR-safe)
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (storeFontSize && storeFontSize !== 16) {
        document.documentElement.style.fontSize = `${storeFontSize}px`;
      } else {
        document.documentElement.style.removeProperty('font-size');
      }
    }
  }, [storeFontSize]);

  // Resolve 'system' mode to actual 'light' or 'dark' based on OS preference
  const resolvedMode = useResolvedMode(storeMode);

  // Create theme based on current settings
  const theme = useMemo<PrismTheme>(
    () =>
      createPrismTheme({
        preset: storePreset,
        mode: resolvedMode,
        direction: storeDirection,
        primaryColor: storePrimaryColor || config.theme.primaryColor,
        typography: config.theme.typography,
        cssVariables: config.theme.cssVariables,
        components: config.theme.components,
        contrast: storeContrast,
        fontFamily: storeFontFamily,
        fontSize: storeFontSize,
        overrides: themeOverrides,
      }),
    [
      storePreset,
      resolvedMode,
      storeDirection,
      storePrimaryColor,
      storeContrast,
      storeFontSize,
      storeFontFamily,
      config.theme,
      themeOverrides,
    ]
  );

  // Context value
  // Zustand actions are stable, so they don't need to be in deps
  const contextValue = useMemo(
    () => ({
      config,
      theme,
      settings,
      // Zustand actions (stable references)
      setMode,
      toggleMode,
      setPreset,
      setDirection,
      toggleSidebar,
      setSidebarCollapsed: setCompactSidebar,
      resetSettings,
      // Deprecated drawer controls (no-ops, stable module-level reference)
      openSettingsDrawer: noOpDrawerWarning,
      closeSettingsDrawer: noOpDrawerWarning,
      toggleSettingsDrawer: noOpDrawerWarning,
    }),
    [
      config,
      theme,
      settings,
      setMode,
      toggleMode,
      setPreset,
      setDirection,
      toggleSidebar,
      setCompactSidebar,
      resetSettings,
    ]
  );

  return (
    <CacheProvider value={emotionCache}>
      <PrismContext.Provider value={contextValue}>
        <MuiThemeProvider theme={theme}>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            {!disableCssBaseline && <CssBaseline />}
            {children}
          </LocalizationProvider>
        </MuiThemeProvider>
      </PrismContext.Provider>
    </CacheProvider>
  );
}
