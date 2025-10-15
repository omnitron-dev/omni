import { Injectable } from '@omnitron-dev/aether/di';
import { signal } from '@omnitron-dev/aether';

export interface Setting {
  id: string;
  label: string;
  type: 'boolean' | 'select' | 'text' | 'number' | 'color';
  value: any;
  options?: { value: string; label: string }[];
  description?: string;
}

export interface SettingGroup {
  id: string;
  name: string;
  icon: string;
  settings: Setting[];
}

/**
 * Settings Service
 *
 * Manages application settings
 */
@Injectable({ scope: 'module' })
export class SettingsService {
  private settingGroups = signal<SettingGroup[]>([
    {
      id: 'appearance',
      name: 'Appearance',
      icon: '🎨',
      settings: [
        {
          id: 'theme',
          label: 'Theme',
          type: 'select',
          value: 'dark',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Auto (System)' },
          ],
          description: 'Choose your preferred color theme',
        },
        {
          id: 'fontSize',
          label: 'Font Size',
          type: 'number',
          value: 14,
          description: 'Editor font size in pixels',
        },
        {
          id: 'fontFamily',
          label: 'Font Family',
          type: 'select',
          value: 'monospace',
          options: [
            { value: 'monospace', label: 'Monospace' },
            { value: 'sans-serif', label: 'Sans Serif' },
            { value: 'serif', label: 'Serif' },
          ],
        },
        {
          id: 'accentColor',
          label: 'Accent Color',
          type: 'color',
          value: '#3b82f6',
        },
        {
          id: 'compactMode',
          label: 'Compact Mode',
          type: 'boolean',
          value: false,
          description: 'Reduce spacing for more content',
        },
      ],
    },
    {
      id: 'editor',
      name: 'Editor',
      icon: '📝',
      settings: [
        {
          id: 'autoSave',
          label: 'Auto Save',
          type: 'boolean',
          value: true,
          description: 'Automatically save files after changes',
        },
        {
          id: 'tabSize',
          label: 'Tab Size',
          type: 'number',
          value: 2,
          description: 'Number of spaces for tabs',
        },
        {
          id: 'wordWrap',
          label: 'Word Wrap',
          type: 'boolean',
          value: true,
        },
        {
          id: 'lineNumbers',
          label: 'Show Line Numbers',
          type: 'boolean',
          value: true,
        },
        {
          id: 'minimap',
          label: 'Show Minimap',
          type: 'boolean',
          value: false,
        },
        {
          id: 'formatOnSave',
          label: 'Format on Save',
          type: 'boolean',
          value: true,
        },
      ],
    },
    {
      id: 'terminal',
      name: 'Terminal',
      icon: '💻',
      settings: [
        {
          id: 'shell',
          label: 'Default Shell',
          type: 'select',
          value: 'bash',
          options: [
            { value: 'bash', label: 'Bash' },
            { value: 'zsh', label: 'Zsh' },
            { value: 'fish', label: 'Fish' },
            { value: 'powershell', label: 'PowerShell' },
          ],
        },
        {
          id: 'terminalFontSize',
          label: 'Font Size',
          type: 'number',
          value: 13,
        },
        {
          id: 'cursorStyle',
          label: 'Cursor Style',
          type: 'select',
          value: 'block',
          options: [
            { value: 'block', label: 'Block' },
            { value: 'underline', label: 'Underline' },
            { value: 'line', label: 'Line' },
          ],
        },
        {
          id: 'scrollback',
          label: 'Scrollback Lines',
          type: 'number',
          value: 1000,
        },
      ],
    },
    {
      id: 'ai',
      name: 'AI Assistant',
      icon: '🤖',
      settings: [
        {
          id: 'aiModel',
          label: 'Default Model',
          type: 'select',
          value: 'gpt-4',
          options: [
            { value: 'gpt-4', label: 'GPT-4' },
            { value: 'gpt-3.5', label: 'GPT-3.5 Turbo' },
            { value: 'claude', label: 'Claude 3' },
            { value: 'local', label: 'Local Model' },
          ],
        },
        {
          id: 'aiAutoComplete',
          label: 'Auto Complete',
          type: 'boolean',
          value: true,
        },
        {
          id: 'aiSuggestions',
          label: 'Show Suggestions',
          type: 'boolean',
          value: true,
        },
        {
          id: 'aiTemperature',
          label: 'Creativity',
          type: 'number',
          value: 0.7,
          description: 'Higher values make output more creative (0.0 - 1.0)',
        },
      ],
    },
    {
      id: 'privacy',
      name: 'Privacy & Security',
      icon: '🔒',
      settings: [
        {
          id: 'telemetry',
          label: 'Send Telemetry',
          type: 'boolean',
          value: false,
          description: 'Help improve Omnitron by sending anonymous usage data',
        },
        {
          id: 'crashReports',
          label: 'Send Crash Reports',
          type: 'boolean',
          value: true,
        },
        {
          id: 'savePasswords',
          label: 'Save Passwords',
          type: 'boolean',
          value: false,
        },
        {
          id: 'clearDataOnExit',
          label: 'Clear Data on Exit',
          type: 'boolean',
          value: false,
        },
      ],
    },
    {
      id: 'advanced',
      name: 'Advanced',
      icon: '⚙️',
      settings: [
        {
          id: 'devMode',
          label: 'Developer Mode',
          type: 'boolean',
          value: false,
          description: 'Enable advanced developer features',
        },
        {
          id: 'experimentalFeatures',
          label: 'Experimental Features',
          type: 'boolean',
          value: false,
        },
        {
          id: 'maxWorkers',
          label: 'Max Worker Threads',
          type: 'number',
          value: 4,
        },
        {
          id: 'cacheSize',
          label: 'Cache Size (MB)',
          type: 'number',
          value: 512,
        },
        {
          id: 'logLevel',
          label: 'Log Level',
          type: 'select',
          value: 'info',
          options: [
            { value: 'debug', label: 'Debug' },
            { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warning' },
            { value: 'error', label: 'Error' },
          ],
        },
      ],
    },
  ]);

  /**
   * Get all setting groups
   */
  getSettingGroups(): SettingGroup[] {
    return this.settingGroups();
  }

  /**
   * Get a specific setting group
   */
  getSettingGroup(groupId: string): SettingGroup | undefined {
    return this.settingGroups().find(g => g.id === groupId);
  }

  /**
   * Get a specific setting value
   */
  getSetting(groupId: string, settingId: string): any {
    const group = this.getSettingGroup(groupId);
    const setting = group?.settings.find(s => s.id === settingId);
    return setting?.value;
  }

  /**
   * Update a setting value
   */
  updateSetting(groupId: string, settingId: string, value: any) {
    this.settingGroups.update(groups =>
      groups.map(group =>
        group.id === groupId
          ? {
              ...group,
              settings: group.settings.map(setting =>
                setting.id === settingId ? { ...setting, value } : setting
              ),
            }
          : group
      )
    );

    // Persist to storage
    this.persistSettings();
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults() {
    // In a real implementation, this would restore default values
    console.log('Resetting to defaults...');
  }

  /**
   * Export settings as JSON
   */
  exportSettings(): string {
    return JSON.stringify(this.settingGroups(), null, 2);
  }

  /**
   * Import settings from JSON
   */
  importSettings(json: string): boolean {
    try {
      const imported = JSON.parse(json);
      this.settingGroups.set(imported);
      this.persistSettings();
      return true;
    } catch (error) {
      console.error('Failed to import settings:', error);
      return false;
    }
  }

  /**
   * Persist settings to storage
   */
  private persistSettings() {
    // In a real implementation, this would save to localStorage or backend
    try {
      localStorage.setItem('omnitron-settings', JSON.stringify(this.settingGroups()));
    } catch (error) {
      console.error('Failed to persist settings:', error);
    }
  }

  /**
   * Load settings from storage
   */
  loadSettings() {
    try {
      const stored = localStorage.getItem('omnitron-settings');
      if (stored) {
        this.settingGroups.set(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }
}
