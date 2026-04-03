/**
 * Prism Stores
 *
 * @module @omnitron-dev/prism/state/stores
 */

export { useThemeStore, themeStore, type ThemeState } from './theme.js';

export { useAuthStore, authStore, type AuthStoreState, type AuthStatus } from './auth.js';

export { useUIStore, uiStore, type UIState } from './ui.js';

export {
  useSettingsStore,
  settingsStore,
  getDefaultSettings,
  type SettingsState,
  type SettingsValues,
  type NavLayout,
  type NavColor,
} from './settings.js';
