/**
 * Prism Context
 *
 * Global context for Prism configuration and state.
 *
 * @module @omnitron-dev/prism/core/context
 */

import { createContext, useContext } from 'react';
import type { PrismConfig } from '../types/config.js';
import type { PrismTheme, ThemeMode, ThemePreset, ThemeDirection } from '../types/theme.js';
import type { NavLayout, NavColor } from '../state/stores/settings.js';

/**
 * Settings state managed by Prism.
 * @deprecated Use useSettingsStore from '@omnitron-dev/prism/state' for full settings access.
 * This interface is maintained for backwards compatibility with PrismContext.
 */
export interface PrismSettingsState {
  /** Current theme mode */
  mode: ThemeMode;
  /** Current theme preset */
  preset: ThemePreset;
  /** Text direction */
  direction: ThemeDirection;
  /** Sidebar collapsed state */
  sidebarCollapsed: boolean;
  /** Settings drawer open */
  settingsDrawerOpen: boolean;
  /** Primary color override */
  primaryColor: string | null;
  /** High contrast mode */
  contrast: 'default' | 'high';
  /** Base font size (12-20) */
  fontSize: number;
  /** Selected font family */
  fontFamily: string;
  /** Navigation layout */
  navLayout: NavLayout;
  /** Navigation color mode */
  navColor: NavColor;
}

/**
 * Prism context value.
 */
export interface PrismContextValue {
  /** Current configuration */
  config: PrismConfig;
  /** Current theme */
  theme: PrismTheme;
  /** Settings state */
  settings: PrismSettingsState;

  // Theme actions
  /** Set theme mode */
  setMode: (mode: ThemeMode) => void;
  /** Toggle between light/dark */
  toggleMode: () => void;
  /** Set theme preset */
  setPreset: (preset: ThemePreset) => void;
  /** Set text direction */
  setDirection: (direction: ThemeDirection) => void;

  // Settings actions
  /** Toggle sidebar */
  toggleSidebar: () => void;
  /** Set sidebar collapsed */
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Open settings drawer */
  openSettingsDrawer: () => void;
  /** Close settings drawer */
  closeSettingsDrawer: () => void;
  /** Toggle settings drawer */
  toggleSettingsDrawer: () => void;

  // Reset
  /** Reset all settings to defaults */
  resetSettings: () => void;
}

/**
 * Prism context.
 */
export const PrismContext = createContext<PrismContextValue | null>(null);

PrismContext.displayName = 'PrismContext';

/**
 * Hook to access Prism context.
 *
 * @returns Prism context value
 * @throws If used outside PrismProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, setMode, toggleSidebar } = usePrismContext();
 *
 *   return (
 *     <Button onClick={() => setMode('dark')}>
 *       Switch to Dark Mode
 *     </Button>
 *   );
 * }
 * ```
 */
export function usePrismContext(): PrismContextValue {
  const context = useContext(PrismContext);

  if (!context) {
    throw new Error('usePrismContext must be used within a PrismProvider');
  }

  return context;
}

/**
 * Default settings state.
 */
export const defaultSettingsState: PrismSettingsState = {
  mode: 'light',
  preset: 'default-light',
  direction: 'ltr',
  sidebarCollapsed: false,
  settingsDrawerOpen: false,
  primaryColor: null,
  contrast: 'default',
  fontSize: 16,
  fontFamily: 'Public Sans Variable',
  navLayout: 'vertical',
  navColor: 'integrate',
};
