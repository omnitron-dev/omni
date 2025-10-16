import { Injectable, inject } from '@omnitron-dev/aether/di';
import { SettingsService } from './settings.service';

export interface UserPreferences {
  theme: string;
  language: string;
  notifications: boolean;
  autoSave: boolean;
  compactMode: boolean;
}

/**
 * Preferences Service
 *
 * Manages user preferences
 */
@Injectable({ scope: 'module' })
export class PreferencesService {
  private settingsService = inject(SettingsService);

  /**
   * Get user preferences
   */
  getPreferences(): UserPreferences {
    return {
      theme: this.settingsService.getSetting('appearance', 'theme') || 'dark',
      language: 'en',
      notifications: true,
      autoSave: this.settingsService.getSetting('editor', 'autoSave') || true,
      compactMode: this.settingsService.getSetting('appearance', 'compactMode') || false,
    };
  }

  /**
   * Update preferences
   */
  updatePreferences(preferences: Partial<UserPreferences>) {
    if (preferences.theme) {
      this.settingsService.updateSetting('appearance', 'theme', preferences.theme);
    }
    if (preferences.autoSave !== undefined) {
      this.settingsService.updateSetting('editor', 'autoSave', preferences.autoSave);
    }
    if (preferences.compactMode !== undefined) {
      this.settingsService.updateSetting('appearance', 'compactMode', preferences.compactMode);
    }
  }

  /**
   * Apply theme
   */
  applyTheme(theme: string) {
    document.documentElement.setAttribute('data-theme', theme);
    this.updatePreferences({ theme });
  }

  /**
   * Toggle compact mode
   */
  toggleCompactMode() {
    const current = this.getPreferences().compactMode;
    this.updatePreferences({ compactMode: !current });
    document.documentElement.classList.toggle('compact-mode', !current);
  }

  /**
   * Get preference value
   */
  getPreference<K extends keyof UserPreferences>(key: K): UserPreferences[K] {
    return this.getPreferences()[key];
  }

  /**
   * Set preference value
   */
  setPreference<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    this.updatePreferences({ [key]: value } as Partial<UserPreferences>);
  }
}
