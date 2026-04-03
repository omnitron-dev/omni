/**
 * Settings Store
 *
 * Comprehensive settings management with persistence.
 * Combines theme preferences with layout and navigation settings.
 *
 * @module @omnitron/prism/state/stores/settings
 */

import { createPersistedStore, createSelectors } from '../create-store.js';
import type { ThemePreset, ThemeMode, ThemeDirection, ComponentDensity } from '../../types/theme.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Navigation layout options for dashboard.
 */
export type NavLayout = 'vertical' | 'horizontal' | 'mini';

/**
 * Navigation color scheme.
 */
export type NavColor = 'integrate' | 'apparent';

/**
 * Settings state and actions.
 */
export interface SettingsState {
  // Theme
  /** Current theme mode */
  mode: ThemeMode;
  /** Current theme preset */
  preset: ThemePreset;
  /** Primary color override (hex) */
  primaryColor: string | null;
  /** High contrast mode */
  contrast: 'default' | 'high';
  /** Text direction */
  direction: ThemeDirection;

  // Typography
  /** Base font size (12-20) */
  fontSize: number;
  /** Font family override */
  fontFamily: string | null;

  // Layout
  /** Component density */
  density: ComponentDensity;
  /** Compact sidebar (deprecated — use sidebarCollapsed) */
  compactSidebar: boolean;
  /** Per-layout sidebar collapsed state (keyed by persistKey) */
  sidebarCollapsed: Record<string, boolean>;
  /** Dashboard navigation layout */
  navLayout: NavLayout;
  /** Navigation color scheme */
  navColor: NavColor;
  /** Stretch content to full width */
  stretch: boolean;

  /** Per-table rows-per-page preference (keyed by table ID) */
  tableRowsPerPage: Record<string, number>;

  // Actions
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setPreset: (preset: ThemePreset) => void;
  setPrimaryColor: (color: string | null) => void;
  setContrast: (contrast: 'default' | 'high') => void;
  setDirection: (direction: ThemeDirection) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string | null) => void;
  setDensity: (density: ComponentDensity) => void;
  setCompactSidebar: (compact: boolean) => void;
  setSidebarCollapsed: (key: string, collapsed: boolean) => void;
  getSidebarCollapsed: (key: string) => boolean;
  setNavLayout: (layout: NavLayout) => void;
  setNavColor: (color: NavColor) => void;
  setStretch: (stretch: boolean) => void;
  setTableRowsPerPage: (tableId: string, rows: number) => void;
  getTableRowsPerPage: (tableId: string, fallback?: number) => number;
  updateSettings: (updates: Partial<SettingsValues>) => void;
  reset: () => void;
  canReset: () => boolean;
}

/**
 * Settings values (state without actions).
 */
export type SettingsValues = Omit<
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
  | 'setSidebarCollapsed'
  | 'getSidebarCollapsed'
  | 'setNavLayout'
  | 'setNavColor'
  | 'setStretch'
  | 'setTableRowsPerPage'
  | 'getTableRowsPerPage'
  | 'updateSettings'
  | 'reset'
  | 'canReset'
>;

// =============================================================================
// DEFAULT STATE
// =============================================================================

const defaultSettings: SettingsValues = {
  // Theme
  mode: 'light',
  preset: 'default-light',
  primaryColor: null,
  contrast: 'default',
  direction: 'ltr',

  // Typography
  fontSize: 16,
  fontFamily: null, // null = use Prism default (Nunito Sans Variable)

  // Layout
  density: 'standard',
  compactSidebar: false,
  sidebarCollapsed: {},
  navLayout: 'vertical',
  navColor: 'integrate',
  stretch: true,
  tableRowsPerPage: {},
};

// =============================================================================
// STORE
// =============================================================================

/**
 * Settings store with persistence.
 *
 * @example
 * ```tsx
 * function SettingsPanel() {
 *   const { mode, setMode, preset, setPreset, canReset, reset } = useSettingsStore();
 *
 *   return (
 *     <div>
 *       <Switch checked={mode === 'dark'} onChange={() => setMode(mode === 'dark' ? 'light' : 'dark')} />
 *       <Select value={preset} onChange={(e) => setPreset(e.target.value as ThemePreset)}>
 *         <MenuItem value="default-light">Light</MenuItem>
 *         <MenuItem value="luxury">Luxury</MenuItem>
 *       </Select>
 *       {canReset() && <Button onClick={reset}>Reset</Button>}
 *     </div>
 *   );
 * }
 * ```
 */
export const useSettingsStore = createPersistedStore<SettingsState>(
  (set, get) => ({
    ...defaultSettings,

    // Theme actions
    setMode: (mode) => set({ mode }),
    toggleMode: () =>
      set((state) => {
        state.mode = state.mode === 'light' ? 'dark' : 'light';
      }),
    setPreset: (preset) => set({ preset }),
    setPrimaryColor: (primaryColor) => set({ primaryColor }),
    setContrast: (contrast) => set({ contrast }),
    setDirection: (direction) => set({ direction }),

    // Typography actions
    setFontSize: (fontSize) => set({ fontSize: Math.min(20, Math.max(12, fontSize)) }),
    setFontFamily: (fontFamily) => set({ fontFamily }),

    // Layout actions
    setDensity: (density) => set({ density }),
    setCompactSidebar: (compactSidebar) => set({ compactSidebar }),
    setSidebarCollapsed: (key, collapsed) =>
      set((state) => {
        state.sidebarCollapsed = { ...state.sidebarCollapsed, [key]: collapsed };
      }),
    getSidebarCollapsed: (key) => get().sidebarCollapsed[key] ?? false,
    setNavLayout: (navLayout) => set({ navLayout }),
    setNavColor: (navColor) => set({ navColor }),
    setStretch: (stretch) => set({ stretch }),
    setTableRowsPerPage: (tableId, rows) =>
      set((state) => {
        state.tableRowsPerPage = { ...state.tableRowsPerPage, [tableId]: rows };
      }),
    getTableRowsPerPage: (tableId, fallback = 25) => get().tableRowsPerPage[tableId] ?? fallback,

    // Batch update
    updateSettings: (updates) => set(updates),

    // Reset
    reset: () => set(defaultSettings),
    canReset: () => {
      const state = get();
      return Object.keys(defaultSettings).some(
        (key) => state[key as keyof SettingsValues] !== defaultSettings[key as keyof SettingsValues]
      );
    },
  }),
  'settings'
);

/**
 * Settings store with auto-generated selectors.
 *
 * @example
 * ```tsx
 * const mode = settingsStore.use.mode();
 * const preset = settingsStore.use.preset();
 * ```
 */
export const settingsStore = createSelectors(useSettingsStore);

/**
 * Get default settings values.
 */
export function getDefaultSettings(): SettingsValues {
  return { ...defaultSettings };
}
