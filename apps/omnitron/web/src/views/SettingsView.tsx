import { defineComponent, signal } from '@omnitron-dev/aether';
import { For } from '@omnitron-dev/aether/control-flow';

interface SettingGroup {
  id: string;
  name: string;
  icon: string;
  settings: Setting[];
}

interface Setting {
  id: string;
  label: string;
  type: 'boolean' | 'select' | 'text' | 'number' | 'color';
  value: any;
  options?: { value: string; label: string }[];
  description?: string;
}

/**
 * Settings View
 *
 * Application settings and preferences management
 */
export default defineComponent(() => {
  const activeGroup = signal('appearance');

  const settingGroups = signal<SettingGroup[]>([
    {
      id: 'appearance',
      name: 'Appearance',
      icon: '🎨',
      settings: [
        { id: 'theme', label: 'Theme', type: 'select', value: 'dark', options: [
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'auto', label: 'Auto (System)' }
        ], description: 'Choose your preferred color theme' },
        { id: 'fontSize', label: 'Font Size', type: 'number', value: 14, description: 'Editor font size in pixels' },
        { id: 'fontFamily', label: 'Font Family', type: 'select', value: 'monospace', options: [
          { value: 'monospace', label: 'Monospace' },
          { value: 'sans-serif', label: 'Sans Serif' },
          { value: 'serif', label: 'Serif' }
        ]},
        { id: 'accentColor', label: 'Accent Color', type: 'color', value: '#3b82f6' },
        { id: 'compactMode', label: 'Compact Mode', type: 'boolean', value: false, description: 'Reduce spacing for more content' }
      ]
    },
    {
      id: 'editor',
      name: 'Editor',
      icon: '📝',
      settings: [
        { id: 'autoSave', label: 'Auto Save', type: 'boolean', value: true, description: 'Automatically save files after changes' },
        { id: 'tabSize', label: 'Tab Size', type: 'number', value: 2, description: 'Number of spaces for tabs' },
        { id: 'wordWrap', label: 'Word Wrap', type: 'boolean', value: true },
        { id: 'lineNumbers', label: 'Show Line Numbers', type: 'boolean', value: true },
        { id: 'minimap', label: 'Show Minimap', type: 'boolean', value: false },
        { id: 'formatOnSave', label: 'Format on Save', type: 'boolean', value: true }
      ]
    },
    {
      id: 'terminal',
      name: 'Terminal',
      icon: '💻',
      settings: [
        { id: 'shell', label: 'Default Shell', type: 'select', value: 'bash', options: [
          { value: 'bash', label: 'Bash' },
          { value: 'zsh', label: 'Zsh' },
          { value: 'fish', label: 'Fish' },
          { value: 'powershell', label: 'PowerShell' }
        ]},
        { id: 'terminalFontSize', label: 'Font Size', type: 'number', value: 13 },
        { id: 'cursorStyle', label: 'Cursor Style', type: 'select', value: 'block', options: [
          { value: 'block', label: 'Block' },
          { value: 'underline', label: 'Underline' },
          { value: 'line', label: 'Line' }
        ]},
        { id: 'scrollback', label: 'Scrollback Lines', type: 'number', value: 1000 }
      ]
    },
    {
      id: 'ai',
      name: 'AI Assistant',
      icon: '🤖',
      settings: [
        { id: 'aiModel', label: 'Default Model', type: 'select', value: 'gpt-4', options: [
          { value: 'gpt-4', label: 'GPT-4' },
          { value: 'gpt-3.5', label: 'GPT-3.5 Turbo' },
          { value: 'claude', label: 'Claude 3' },
          { value: 'local', label: 'Local Model' }
        ]},
        { id: 'aiAutoComplete', label: 'Auto Complete', type: 'boolean', value: true },
        { id: 'aiSuggestions', label: 'Show Suggestions', type: 'boolean', value: true },
        { id: 'aiTemperature', label: 'Creativity', type: 'number', value: 0.7, description: 'Higher values make output more creative (0.0 - 1.0)' }
      ]
    },
    {
      id: 'privacy',
      name: 'Privacy & Security',
      icon: '🔒',
      settings: [
        { id: 'telemetry', label: 'Send Telemetry', type: 'boolean', value: false, description: 'Help improve Omnitron by sending anonymous usage data' },
        { id: 'crashReports', label: 'Send Crash Reports', type: 'boolean', value: true },
        { id: 'savePasswords', label: 'Save Passwords', type: 'boolean', value: false },
        { id: 'clearDataOnExit', label: 'Clear Data on Exit', type: 'boolean', value: false }
      ]
    },
    {
      id: 'advanced',
      name: 'Advanced',
      icon: '⚙️',
      settings: [
        { id: 'devMode', label: 'Developer Mode', type: 'boolean', value: false, description: 'Enable advanced developer features' },
        { id: 'experimentalFeatures', label: 'Experimental Features', type: 'boolean', value: false },
        { id: 'maxWorkers', label: 'Max Worker Threads', type: 'number', value: 4 },
        { id: 'cacheSize', label: 'Cache Size (MB)', type: 'number', value: 512 },
        { id: 'logLevel', label: 'Log Level', type: 'select', value: 'info', options: [
          { value: 'debug', label: 'Debug' },
          { value: 'info', label: 'Info' },
          { value: 'warn', label: 'Warning' },
          { value: 'error', label: 'Error' }
        ]}
      ]
    }
  ]);

  const updateSetting = (groupId: string, settingId: string, value: any) => {
    settingGroups.update(groups =>
      groups.map(group =>
        group.id === groupId
          ? {
              ...group,
              settings: group.settings.map(setting =>
                setting.id === settingId ? { ...setting, value } : setting
              )
            }
          : group
      )
    );
    console.log(`Updated ${groupId}.${settingId} to`, value);
  };

  const resetToDefaults = () => {
    if (confirm('Reset all settings to defaults?')) {
      console.log('Resetting to defaults...');
      // Reset logic here
    }
  };

  return () => (
    <div class="view settings-view">
      <div class="view-header">
        <h2>Settings</h2>
        <div class="settings-actions">
          <button class="button" onClick={resetToDefaults}>Reset to Defaults</button>
          <button class="primary-button">Export Settings</button>
        </div>
      </div>

      <div class="view-content">
        <div class="settings-container">
          <div class="settings-sidebar">
            <For each={settingGroups}>
              {(group) => (
                <div
                  class={() => `settings-group-item ${activeGroup() === group().id ? 'active' : ''}`}
                  onClick={() => activeGroup.set(group().id)}
                >
                  <span class="group-icon">{group().icon}</span>
                  <span class="group-name">{group().name}</span>
                </div>
              )}
            </For>
          </div>

          <div class="settings-content">
            <For each={settingGroups}>
              {(group) => (
                <div
                  class="settings-group"
                  style={{ display: activeGroup() === group().id ? 'block' : 'none' }}
                >
                  <h3>{group().icon} {group().name}</h3>
                  <div class="settings-list">
                    <For each={() => group().settings}>
                      {(setting) => (
                        <div class="setting-item">
                          <div class="setting-header">
                            <label class="setting-label">{setting().label}</label>
                            {setting().description && (
                              <p class="setting-description">{setting().description}</p>
                            )}
                          </div>
                          <div class="setting-control">
                            {setting().type === 'boolean' && (
                              <label class="switch">
                                <input
                                  type="checkbox"
                                  checked={setting().value}
                                  onChange={(e) =>
                                    updateSetting(group().id, setting().id, e.currentTarget.checked)
                                  }
                                />
                                <span class="slider"></span>
                              </label>
                            )}
                            {setting().type === 'select' && (
                              <select
                                value={setting().value}
                                onChange={(e) =>
                                  updateSetting(group().id, setting().id, e.currentTarget.value)
                                }
                              >
                                <For each={() => setting().options || []}>
                                  {(option) => (
                                    <option value={option().value}>{option().label}</option>
                                  )}
                                </For>
                              </select>
                            )}
                            {setting().type === 'text' && (
                              <input
                                type="text"
                                value={setting().value}
                                onChange={(e) =>
                                  updateSetting(group().id, setting().id, e.currentTarget.value)
                                }
                              />
                            )}
                            {setting().type === 'number' && (
                              <input
                                type="number"
                                value={setting().value}
                                onChange={(e) =>
                                  updateSetting(group().id, setting().id, Number(e.currentTarget.value))
                                }
                              />
                            )}
                            {setting().type === 'color' && (
                              <input
                                type="color"
                                value={setting().value}
                                onChange={(e) =>
                                  updateSetting(group().id, setting().id, e.currentTarget.value)
                                }
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
});