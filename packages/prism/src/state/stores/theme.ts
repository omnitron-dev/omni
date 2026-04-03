/**
 * Theme Store
 *
 * @deprecated Use useSettingsStore from './settings' instead.
 * This store is maintained for backwards compatibility only.
 * The useSettingsStore provides the same functionality plus additional
 * settings like navLayout, density, fontSize, and more.
 *
 * Migration example:
 * ```tsx
 * // Before (deprecated)
 * const { mode, setMode } = useThemeStore();
 *
 * // After (recommended)
 * const { mode, setMode } = useSettingsStore();
 * ```
 *
 * @module @omnitron-dev/prism/state/stores
 */

import { createPersistedStore, createSelectors } from '../create-store.js';
import type { ThemeMode, ThemeDirection } from '../../types/theme.js';

/**
 * Theme store state and actions.
 */
export interface ThemeState {
  /** Current theme mode */
  mode: ThemeMode;
  /** Text direction */
  direction: ThemeDirection;
  /** Current preset name */
  preset: string;
  /** Compact layout mode */
  compactLayout: boolean;
  /** High contrast mode */
  contrast: 'default' | 'high';
  /** Primary color override */
  primaryColor: string | null;

  // Actions
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setDirection: (direction: ThemeDirection) => void;
  setPreset: (preset: string) => void;
  setCompactLayout: (compact: boolean) => void;
  setContrast: (contrast: 'default' | 'high') => void;
  setPrimaryColor: (color: string | null) => void;
  reset: () => void;
}

const defaultState = {
  mode: 'light' as ThemeMode,
  direction: 'ltr' as ThemeDirection,
  preset: 'default',
  compactLayout: false,
  contrast: 'default' as const,
  primaryColor: null,
};

/**
 * Theme store with persistence.
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const { mode, toggleMode } = useThemeStore();
 *   return <button onClick={toggleMode}>{mode}</button>;
 * }
 * ```
 */
export const useThemeStore = createPersistedStore<ThemeState>(
  (set) => ({
    ...defaultState,

    setMode: (mode) => set({ mode }),
    toggleMode: () =>
      set((state) => {
        state.mode = state.mode === 'light' ? 'dark' : 'light';
      }),
    setDirection: (direction) => set({ direction }),
    setPreset: (preset) => set({ preset }),
    setCompactLayout: (compactLayout) => set({ compactLayout }),
    setContrast: (contrast) => set({ contrast }),
    setPrimaryColor: (primaryColor) => set({ primaryColor }),
    reset: () => set(defaultState),
  }),
  'theme'
);

/**
 * Theme store with auto-generated selectors.
 *
 * @example
 * ```tsx
 * const mode = themeStore.use.mode();
 * ```
 */
export const themeStore = createSelectors(useThemeStore);
