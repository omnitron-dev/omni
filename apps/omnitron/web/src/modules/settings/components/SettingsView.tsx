import { defineComponent, onMount } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { For } from '@omnitron-dev/aether/control-flow';
import { SettingsService } from '../services/settings.service';
import { useSettingsStore } from '../stores/settings.store';

/**
 * Settings View
 *
 * Main settings view container
 */
export default defineComponent(() => {
  const settingsService = inject(SettingsService);
  const settingsStore = useSettingsStore();

  onMount(() => {
    settingsService.loadSettings();
  });

  const updateSetting = (groupId: string, settingId: string, value: any) => {
    settingsService.updateSetting(groupId, settingId, value);
    settingsStore.markModified();
  };

  const resetToDefaults = () => {
    if (confirm('Reset all settings to defaults?')) {
      settingsService.resetToDefaults();
      settingsStore.markSaved();
    }
  };

  const exportSettings = () => {
    const json = settingsService.exportSettings();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'omnitron-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return () => {
    const settingGroups = settingsService.getSettingGroups();

    return (
      <div class="view settings-view">
        <div class="view-header">
          <h2>Settings</h2>
          <div class="settings-actions">
            <button class="button" onClick={resetToDefaults}>
              Reset to Defaults
            </button>
            <button class="primary-button" onClick={exportSettings}>
              Export Settings
            </button>
          </div>
        </div>

        <div class="view-content">
          <div class="settings-container">
            <div class="settings-sidebar">
              <For each={() => settingGroups}>
                {group => (
                  <div
                    class={() =>
                      `settings-group-item ${
                        settingsStore.activeGroup() === group().id ? 'active' : ''
                      }`
                    }
                    onClick={() => settingsStore.setActiveGroup(group().id)}
                  >
                    <span class="group-icon">{group().icon}</span>
                    <span class="group-name">{group().name}</span>
                  </div>
                )}
              </For>
            </div>

            <div class="settings-content">
              <For each={() => settingGroups}>
                {group => (
                  <div
                    class="settings-group"
                    style={{
                      display:
                        settingsStore.activeGroup() === group().id
                          ? 'block'
                          : 'none',
                    }}
                  >
                    <h3>
                      {group().icon} {group().name}
                    </h3>
                    <div class="settings-list">
                      <For each={() => group().settings}>
                        {setting => (
                          <div class="setting-item">
                            <div class="setting-header">
                              <label class="setting-label">{setting().label}</label>
                              {setting().description && (
                                <p class="setting-description">
                                  {setting().description}
                                </p>
                              )}
                            </div>
                            <div class="setting-control">
                              {setting().type === 'boolean' && (
                                <label class="switch">
                                  <input
                                    type="checkbox"
                                    checked={setting().value}
                                    onChange={e =>
                                      updateSetting(
                                        group().id,
                                        setting().id,
                                        e.currentTarget.checked
                                      )
                                    }
                                  />
                                  <span class="slider"></span>
                                </label>
                              )}
                              {setting().type === 'select' && (
                                <select
                                  value={setting().value}
                                  onChange={e =>
                                    updateSetting(
                                      group().id,
                                      setting().id,
                                      e.currentTarget.value
                                    )
                                  }
                                >
                                  <For each={() => setting().options || []}>
                                    {option => (
                                      <option value={option().value}>
                                        {option().label}
                                      </option>
                                    )}
                                  </For>
                                </select>
                              )}
                              {setting().type === 'text' && (
                                <input
                                  type="text"
                                  value={setting().value}
                                  onChange={e =>
                                    updateSetting(
                                      group().id,
                                      setting().id,
                                      e.currentTarget.value
                                    )
                                  }
                                />
                              )}
                              {setting().type === 'number' && (
                                <input
                                  type="number"
                                  value={setting().value}
                                  onChange={e =>
                                    updateSetting(
                                      group().id,
                                      setting().id,
                                      Number(e.currentTarget.value)
                                    )
                                  }
                                />
                              )}
                              {setting().type === 'color' && (
                                <input
                                  type="color"
                                  value={setting().value}
                                  onChange={e =>
                                    updateSetting(
                                      group().id,
                                      setting().id,
                                      e.currentTarget.value
                                    )
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
  };
});
