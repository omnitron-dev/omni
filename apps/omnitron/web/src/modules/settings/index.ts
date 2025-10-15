/**
 * Settings Module
 *
 * Exports for the settings module
 */

export { SettingsModule } from './settings.module';
export { SettingsService } from './services/settings.service';
export { PreferencesService } from './services/preferences.service';
export { ConfigService } from './services/config.service';
export { useSettingsStore } from './stores/settings.store';
export type {
  Setting,
  SettingGroup,
} from './services/settings.service';
export type { UserPreferences } from './services/preferences.service';
export type { AppConfig } from './services/config.service';
