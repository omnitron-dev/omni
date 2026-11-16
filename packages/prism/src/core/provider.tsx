/**
 * Prism Provider
 *
 * Root provider for the Prism design system.
 * Uses useSettingsStore for persisted settings, with an explicit mode for SSR or controlled trees.
 *
 * @module core/provider
 */

import type { ReactNode } from 'react';
import type {} from '@mui/material/themeCssVarsAugmentation';
import { useMemo, useEffect, useCallback } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider, useColorScheme, useTheme } from '@mui/material/styles';
import useEnhancedEffect from '@mui/utils/useEnhancedEffect';
import CssBaseline from '@mui/material/CssBaseline';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import rtlPlugin from 'stylis-plugin-rtl';

import type { PrismConfig, PartialPrismConfig } from '../types/config.js';
import type { PrismTheme, ThemeMode } from '../types/theme.js';
import { defaultPrismConfig } from '../types/config.js';
import { PrismContext } from './context.js';
import type { PrismSettingsState, PrismContextValue } from './context.js';
import { createPrismTheme, type PrismThemeOverrides } from '../theme/create-theme.js';
import { useSettingsStore, type SettingsValues } from '../state/stores/settings.js';
import { useResolvedMode } from './hooks/use-media-query.js';

/**
 * Props for PrismProvider.
 */
export interface PrismProviderProps {
  /** Child components */
  children: ReactNode;
  /** Configuration overrides */
  config?: PartialPrismConfig;
  /** Controlled mode, applied during SSR and the first client render without writing the settings store. */
  mode?: ThemeMode;
  /** Receives mode changes requested through Prism context. With mode set, the owner updates that prop. */
  onModeChange?: (mode: ThemeMode) => void;
  /** Opt into MUI's persisted light/dark/system selection instead of the application settings store. */
  modeStorageKey?: string;
  /** Initial selection for modeStorageKey; also pass it to PrismThemeScript. */
  defaultMode?: ThemeMode;
  /** Default settings (overrides defaults but not persisted values) */
  defaultSettings?: Partial<SettingsValues>;
  /** Disable CSS baseline */
  disableCssBaseline?: boolean;
  /** Static overrides or palettes compiled for both native modes before first paint. */
  themeOverrides?: PrismThemeOverrides;
  /**
   * Locale code passed to MUI's `LocalizationProvider` as
   * `adapterLocale` — e.g. `'ru'`, `'en'`. Must be a locale already
   * registered with dayjs (e.g. `import 'dayjs/locale/ru'`).
   * Switches calendar month/weekday labels and date masks.
   * If omitted, MUI falls back to dayjs's global locale (English).
   */
  dateAdapterLocale?: string;
  /**
   * Override for MUI x-date-pickers' built-in strings
   * (e.g. ARIA labels, toolbar text). Passed straight through to
   * `LocalizationProvider.localeText`. Typically pulled from
   * `@mui/x-date-pickers/locales` (e.g. `ruRU.components.MuiLocalizationProvider.defaultProps.localeText`).
   */
  dateLocaleText?: Record<string, unknown>;
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
        'Use useSettingsDrawer() from @omnitron-dev/prism/components/settings instead.'
    );
  }
};

/**
 * PrismProvider - Root provider for Prism design system.
 *
 * Provides theme, settings, and configuration to all child components.
 * An explicit mode belongs to this provider; otherwise mode follows the persisted settings store.
 *
 * @example
 * ```tsx
 * import { PrismProvider } from '@omnitron-dev/prism';
 *
 * function App() {
 *   return (
 *     <PrismProvider
 *       mode="dark"
 *       config={{
 *         theme: { preset: 'luxury' },
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
  mode: controlledMode,
  onModeChange,
  modeStorageKey,
  defaultMode = 'system',
  defaultSettings,
  disableCssBaseline = false,
  themeOverrides,
  dateAdapterLocale,
  dateLocaleText,
}: PrismProviderProps): ReactNode {
  if (modeStorageKey !== undefined && controlledMode !== undefined) {
    throw new Error('PrismProvider: choose controlled mode or modeStorageKey, not both.');
  }
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
    setMode: setStoreMode,
    setPreset,
    setDirection,
    setCompactSidebar,
    reset: resetSettings,
  } = useSettingsStore();

  const mode = controlledMode ?? (modeStorageKey !== undefined ? defaultMode : storeMode);
  const setMode = useCallback((nextMode: ThemeMode) => {
    if (controlledMode === undefined) setStoreMode(nextMode);
    onModeChange?.(nextMode);
  }, [controlledMode, setStoreMode, onModeChange]);

  useEnhancedEffect(() => {
    const { mode: initialMode, ...initialSettings } = defaultSettings ?? {};
    void useSettingsStore.initializeDefaults({ ...initialSettings,
      ...(controlledMode === undefined && modeStorageKey === undefined && initialMode !== undefined && { mode: initialMode }),
    });
  }, [controlledMode, modeStorageKey, defaultSettings]);

  // Create settings object for context (backwards compatibility)
  const settings = useMemo<PrismSettingsState>(
    () => ({
      mode,
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
      mode,
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

  // Create theme based on current settings
  const buildTheme = useCallback(
    (themeMode: ThemeMode) =>
      createPrismTheme({
        preset: storePreset,
        mode: themeMode,
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
      storeDirection,
      storePrimaryColor,
      storeContrast,
      storeFontSize,
      storeFontFamily,
      config.theme,
      themeOverrides,
    ]
  );
  const theme = useMemo(() => buildTheme(mode), [buildTheme, mode]);
  if (modeStorageKey !== undefined && !theme.vars) {
    throw new Error('PrismProvider: modeStorageKey requires CSS variables.');
  }

  // Context value
  // Zustand actions are stable, so they don't need to be in deps
  const contextValue = useMemo(
    () => ({
      config,
      theme,
      settings,
      // Zustand actions (stable references)
      setMode,
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
      setPreset,
      setDirection,
      toggleSidebar,
      setCompactSidebar,
      resetSettings,
    ]
  );

  const content = (selectedTheme: PrismTheme) => (
    <CacheProvider value={emotionCache}>
      <MuiThemeProvider
        theme={selectedTheme}
        defaultMode={mode}
        modeStorageKey={modeStorageKey}
        colorSchemeStorageKey={modeStorageKey === undefined ? undefined : `${modeStorageKey}-scheme`}
        storageManager={modeStorageKey === undefined ? null : undefined}
        forceThemeRerender={Boolean(selectedTheme.vars)}
        disableTransitionOnChange
      >
        <PrismThemeState value={contextValue} persisted={modeStorageKey !== undefined} onModeChange={onModeChange}>
          <LocalizationProvider
            dateAdapter={AdapterDayjs}
            adapterLocale={dateAdapterLocale}
            localeText={dateLocaleText as any}
          >
            {!disableCssBaseline && <CssBaseline />}
            {children}
          </LocalizationProvider>
        </PrismThemeState>
      </MuiThemeProvider>
    </CacheProvider>
  );
  return !theme.vars
    ? <StaticThemeMode mode={mode} theme={theme} buildTheme={buildTheme}>{content}</StaticThemeMode>
    : content(theme);
}

/** Only non-variable themes require JS media resolution; native schemes keep one MUI listener. */
function StaticThemeMode({ mode: requestedMode, theme, buildTheme, children }: {
  mode: ThemeMode;
  theme: PrismTheme;
  buildTheme: (mode: ThemeMode) => PrismTheme;
  children: (theme: PrismTheme) => ReactNode;
}): ReactNode {
  const mode = useResolvedMode(requestedMode);
  const resolved = useMemo(() => theme.palette.mode === mode ? theme : buildTheme(mode), [theme, mode, buildTheme]);
  return children(resolved);
}

/** MUI owns CSS scheme selection; application state remains the authority when controlled. */
function PrismThemeState({ value, persisted, onModeChange, children }: {
  value: Omit<PrismContextValue, 'toggleMode'>;
  persisted: boolean;
  onModeChange?: (mode: ThemeMode) => void;
  children: ReactNode;
}): ReactNode {
  const theme = useTheme() as PrismTheme;
  const { mode: nativeMode, setMode: setNativeMode } = useColorScheme();
  const setOwnedMode = value.setMode;
  const hasNativeSchemes = Boolean(theme.vars);
  useEnhancedEffect(() => {
    if (hasNativeSchemes && !persisted && nativeMode !== value.settings.mode) setNativeMode(value.settings.mode);
  }, [hasNativeSchemes, nativeMode, persisted, setNativeMode, value.settings.mode]);
  const mode = persisted ? nativeMode ?? value.settings.mode : value.settings.mode;
  const setMode = useCallback((next: ThemeMode) => {
    if (persisted) {
      setNativeMode(next);
      onModeChange?.(next);
    } else setOwnedMode(next);
  }, [onModeChange, persisted, setNativeMode, setOwnedMode]);
  const toggleMode = useCallback(() => setMode(theme.palette.mode === 'dark' ? 'light' : 'dark'), [setMode, theme.palette.mode]);
  const context = useMemo(() => ({ ...value, theme, settings: { ...value.settings, mode }, setMode, toggleMode }),
    [mode, setMode, theme, toggleMode, value]);
  return <PrismContext.Provider value={context}>{children}</PrismContext.Provider>;
}
