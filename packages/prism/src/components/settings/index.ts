/**
 * Settings Components
 *
 * Provider and drawer for application settings management.
 *
 * @module @omnitron/prism/components/settings
 */

export {
  SettingsProvider,
  useSettings,
  useSettingsDrawer,
  type SettingsProviderProps,
  type SettingsContextValue,
  type SettingsDrawerState,
} from './settings-provider.js';

export { SettingsDrawer, type SettingsDrawerProps, type SettingsSection } from './settings-drawer.js';
