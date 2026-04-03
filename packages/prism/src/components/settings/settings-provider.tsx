'use client';

/**
 * Settings Provider
 *
 * Provides settings context and drawer state management.
 * Wraps the application to enable settings drawer access anywhere.
 *
 * @module @omnitron-dev/prism/components/settings
 */

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useSettingsStore, type SettingsState, type SettingsValues } from '../../state/stores/settings.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Settings drawer state and controls.
 */
export interface SettingsDrawerState {
  /** Whether the drawer is open */
  open: boolean;
  /** Open the drawer */
  onOpen: () => void;
  /** Close the drawer */
  onClose: () => void;
  /** Toggle the drawer */
  onToggle: () => void;
}

/**
 * Settings context value.
 */
export interface SettingsContextValue {
  /** Current settings values */
  settings: SettingsValues;
  /** Settings actions */
  actions: Pick<
    SettingsState,
    | 'setMode'
    | 'toggleMode'
    | 'setPreset'
    | 'setPrimaryColor'
    | 'setContrast'
    | 'setDirection'
    | 'setFontSize'
    | 'setFontFamily'
    | 'setDensity'
    | 'setCompactSidebar'
    | 'setNavLayout'
    | 'setNavColor'
    | 'setStretch'
    | 'updateSettings'
    | 'reset'
  >;
  /** Whether settings can be reset (differ from defaults) */
  canReset: boolean;
  /** Drawer state and controls */
  drawer: SettingsDrawerState;
}

/**
 * Settings provider props.
 */
export interface SettingsProviderProps {
  /** Child components */
  children: ReactNode;
  /** Initial drawer open state */
  defaultOpen?: boolean;
}

// =============================================================================
// CONTEXT
// =============================================================================

const SettingsContext = createContext<SettingsContextValue | null>(null);

// =============================================================================
// PROVIDER
// =============================================================================

/**
 * Settings Provider - Provides settings state and drawer controls.
 *
 * @example
 * ```tsx
 * // In your app root
 * function App() {
 *   return (
 *     <SettingsProvider>
 *       <ThemeProvider theme={theme}>
 *         <MyApp />
 *         <SettingsDrawer />
 *       </ThemeProvider>
 *     </SettingsProvider>
 *   );
 * }
 *
 * // In any component
 * function Header() {
 *   const { drawer } = useSettings();
 *   return <IconButton onClick={drawer.onOpen}><SettingsIcon /></IconButton>;
 * }
 * ```
 */
export function SettingsProvider({ children, defaultOpen = false }: SettingsProviderProps): ReactNode {
  // Drawer state
  const [open, setOpen] = useState(defaultOpen);

  // Get store state and actions
  const store = useSettingsStore();

  // Drawer controls
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);
  const onToggle = useCallback(() => setOpen((prev) => !prev), []);

  // Extract settings values (without actions)
  const settings: SettingsValues = useMemo(
    () => ({
      mode: store.mode,
      preset: store.preset,
      primaryColor: store.primaryColor,
      contrast: store.contrast,
      direction: store.direction,
      fontSize: store.fontSize,
      fontFamily: store.fontFamily,
      density: store.density,
      compactSidebar: store.compactSidebar,
      sidebarCollapsed: store.sidebarCollapsed,
      navLayout: store.navLayout,
      navColor: store.navColor,
      stretch: store.stretch,
      tableRowsPerPage: store.tableRowsPerPage,
    }),
    [
      store.mode,
      store.preset,
      store.primaryColor,
      store.contrast,
      store.direction,
      store.fontSize,
      store.fontFamily,
      store.density,
      store.compactSidebar,
      store.sidebarCollapsed,
      store.navLayout,
      store.navColor,
      store.stretch,
      store.tableRowsPerPage,
    ]
  );

  // Extract actions
  const actions = useMemo(
    () => ({
      setMode: store.setMode,
      toggleMode: store.toggleMode,
      setPreset: store.setPreset,
      setPrimaryColor: store.setPrimaryColor,
      setContrast: store.setContrast,
      setDirection: store.setDirection,
      setFontSize: store.setFontSize,
      setFontFamily: store.setFontFamily,
      setDensity: store.setDensity,
      setCompactSidebar: store.setCompactSidebar,
      setNavLayout: store.setNavLayout,
      setNavColor: store.setNavColor,
      setStretch: store.setStretch,
      updateSettings: store.updateSettings,
      reset: store.reset,
    }),
    [
      store.setMode,
      store.toggleMode,
      store.setPreset,
      store.setPrimaryColor,
      store.setContrast,
      store.setDirection,
      store.setFontSize,
      store.setFontFamily,
      store.setDensity,
      store.setCompactSidebar,
      store.setNavLayout,
      store.setNavColor,
      store.setStretch,
      store.updateSettings,
      store.reset,
    ]
  );

  // Context value
  const value: SettingsContextValue = useMemo(
    () => ({
      settings,
      actions,
      canReset: store.canReset(),
      drawer: { open, onOpen, onClose, onToggle },
    }),
    [settings, actions, store, open, onOpen, onClose, onToggle]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to access settings context.
 *
 * @returns Settings context value
 * @throws If used outside of SettingsProvider
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { settings, actions } = useSettings();
 *   return (
 *     <Switch
 *       checked={settings.mode === 'dark'}
 *       onChange={() => actions.toggleMode()}
 *     />
 *   );
 * }
 * ```
 */
export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);

  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }

  return context;
}

/**
 * Hook to access only the drawer controls.
 *
 * @returns Drawer state and controls
 * @throws If used outside of SettingsProvider
 *
 * @example
 * ```tsx
 * function SettingsButton() {
 *   const drawer = useSettingsDrawer();
 *   return <IconButton onClick={drawer.onOpen}><SettingsIcon /></IconButton>;
 * }
 * ```
 */
export function useSettingsDrawer(): SettingsDrawerState {
  const { drawer } = useSettings();
  return drawer;
}
