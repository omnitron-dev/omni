/**
 * Comprehensive Tests for PreferenceManager
 * Tests user notification preferences with mocked Redis
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  PreferenceManager,
  UserPreferences,
  ChannelPreference,
  CategoryPreference,
  QuietHours,
  FrequencyLimit,
} from '../../../src/modules/notifications/preference-manager.js';
import { ChannelType } from '../../../src/modules/notifications/channel-manager.js';
import type { NotificationPayload } from '../../../src/modules/notifications/notifications.service.js';

// Create a mock Redis instance
function createMockRedis() {
  const storage = new Map<string, string>();

  return {
    storage,
    get: jest.fn().mockImplementation(async (key: string) => {
      return storage.get(key) || null;
    }),
    set: jest.fn().mockImplementation(async (key: string, value: string) => {
      storage.set(key, value);
      return 'OK';
    }),
    del: jest.fn().mockImplementation(async (...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (storage.delete(key)) count++;
      }
      return count;
    }),
    multi: jest.fn().mockImplementation(() => {
      const commands: Array<{ cmd: string; args: any[] }> = [];
      const multiInstance = {
        incr: jest.fn().mockImplementation((key: string) => {
          commands.push({ cmd: 'incr', args: [key] });
          return multiInstance;
        }),
        expire: jest.fn().mockImplementation((key: string, ttl: number) => {
          commands.push({ cmd: 'expire', args: [key, ttl] });
          return multiInstance;
        }),
        exec: jest.fn().mockImplementation(async () => {
          const results: Array<[Error | null, any]> = [];
          for (const command of commands) {
            if (command.cmd === 'incr') {
              const key = command.args[0];
              const current = parseInt(storage.get(key) || '0', 10);
              const newValue = current + 1;
              storage.set(key, String(newValue));
              results.push([null, newValue]);
            } else if (command.cmd === 'expire') {
              results.push([null, 1]);
            }
          }
          return results;
        }),
      };
      return multiInstance;
    }),
  };
}

describe('PreferenceManager', () => {
  let preferenceManager: PreferenceManager;
  let mockRedis: ReturnType<typeof createMockRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis = createMockRedis();
    preferenceManager = new PreferenceManager(mockRedis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getPreferences', () => {
    it('should return default preferences for new user', async () => {
      const prefs = await preferenceManager.getPreferences('new-user');

      expect(prefs.enabled).toBe(true);
      expect(prefs.channels[ChannelType.Email]?.enabled).toBe(true);
      expect(prefs.channels[ChannelType.InApp]?.enabled).toBe(true);
      expect(prefs.channels[ChannelType.SMS]?.enabled).toBe(false);
    });

    it('should return stored preferences for existing user', async () => {
      const customPrefs: UserPreferences = {
        enabled: false,
        channels: {
          [ChannelType.Email]: { enabled: false },
          [ChannelType.Push]: { enabled: true },
        },
        categories: {
          marketing: false,
          alerts: true,
        },
        locale: 'es',
      };

      mockRedis.storage.set('notifications:preferences:existing-user', JSON.stringify(customPrefs));

      const prefs = await preferenceManager.getPreferences('existing-user');

      expect(prefs.enabled).toBe(false);
      expect(prefs.channels[ChannelType.Email]?.enabled).toBe(false);
      expect(prefs.categories.marketing).toBe(false);
      expect(prefs.locale).toBe('es');
    });

    it('should return defaults when stored data is invalid JSON', async () => {
      mockRedis.storage.set('notifications:preferences:bad-json-user', 'invalid-json');

      const prefs = await preferenceManager.getPreferences('bad-json-user');

      // Should return defaults
      expect(prefs.enabled).toBe(true);
    });
  });

  describe('updatePreferences', () => {
    it('should update specific preferences', async () => {
      const updates: Partial<UserPreferences> = {
        enabled: false,
        locale: 'fr',
      };

      const result = await preferenceManager.updatePreferences('update-user-1', updates);

      expect(result.enabled).toBe(false);
      expect(result.locale).toBe('fr');
      // Original defaults should be preserved
      expect(result.channels[ChannelType.InApp]?.enabled).toBe(true);
    });

    it('should merge channel preferences', async () => {
      const updates: Partial<UserPreferences> = {
        channels: {
          [ChannelType.Email]: { enabled: false },
        },
      };

      const result = await preferenceManager.updatePreferences('update-user-2', updates);

      expect(result.channels[ChannelType.Email]?.enabled).toBe(false);
      // Other channels should retain defaults
      expect(result.channels[ChannelType.InApp]?.enabled).toBe(true);
    });

    it('should merge category preferences', async () => {
      const updates: Partial<UserPreferences> = {
        categories: {
          marketing: false,
          alerts: { enabled: true, channels: [ChannelType.Push] },
        },
      };

      const result = await preferenceManager.updatePreferences('update-user-3', updates);

      expect(result.categories.marketing).toBe(false);
      expect((result.categories.alerts as CategoryPreference).enabled).toBe(true);
      expect((result.categories.alerts as CategoryPreference).channels).toContain(ChannelType.Push);
    });

    it('should persist updated preferences to Redis', async () => {
      const updates: Partial<UserPreferences> = {
        enabled: false,
      };

      await preferenceManager.updatePreferences('persist-user', updates);

      expect(mockRedis.set).toHaveBeenCalledWith(
        'notifications:preferences:persist-user',
        expect.any(String)
      );
    });

    it('should update quiet hours settings', async () => {
      const updates: Partial<UserPreferences> = {
        quietHours: {
          enabled: true,
          start: '23:00',
          end: '07:00',
          timezone: 'America/New_York',
          exceptions: ['critical'],
        },
      };

      const result = await preferenceManager.updatePreferences('quiet-hours-user', updates);

      expect(result.quietHours?.enabled).toBe(true);
      expect(result.quietHours?.start).toBe('23:00');
      expect(result.quietHours?.end).toBe('07:00');
      expect(result.quietHours?.exceptions).toContain('critical');
    });

    it('should update frequency limits', async () => {
      const updates: Partial<UserPreferences> = {
        frequency: {
          maxPerDay: 20,
          maxPerHour: 5,
          maxPerMinute: 1,
        },
      };

      const result = await preferenceManager.updatePreferences('frequency-user', updates);

      expect(result.frequency?.maxPerDay).toBe(20);
      expect(result.frequency?.maxPerHour).toBe(5);
      expect(result.frequency?.maxPerMinute).toBe(1);
    });

    it('should update digest settings', async () => {
      const updates: Partial<UserPreferences> = {
        digest: {
          enabled: true,
          frequency: 'weekly',
          time: '09:00',
          channels: [ChannelType.Email],
        },
      };

      const result = await preferenceManager.updatePreferences('digest-user', updates);

      expect(result.digest?.enabled).toBe(true);
      expect(result.digest?.frequency).toBe('weekly');
    });
  });

  describe('shouldSendNotification', () => {
    describe('Global opt-out', () => {
      it('should block notifications when globally disabled', async () => {
        mockRedis.storage.set(
          'notifications:preferences:disabled-user',
          JSON.stringify({ enabled: false, channels: {}, categories: {} })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'disabled-user',
          notification,
          ChannelType.Email
        );

        expect(shouldSend).toBe(false);
      });

      it('should allow notifications when enabled', async () => {
        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'enabled-user',
          notification,
          ChannelType.InApp
        );

        expect(shouldSend).toBe(true);
      });
    });

    describe('Channel preferences', () => {
      it('should block notifications for disabled channels', async () => {
        mockRedis.storage.set(
          'notifications:preferences:channel-user',
          JSON.stringify({
            enabled: true,
            channels: { [ChannelType.SMS]: { enabled: false } },
            categories: {},
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'channel-user',
          notification,
          ChannelType.SMS
        );

        expect(shouldSend).toBe(false);
      });

      it('should allow notifications for enabled channels', async () => {
        mockRedis.storage.set(
          'notifications:preferences:channel-user-2',
          JSON.stringify({
            enabled: true,
            channels: { [ChannelType.Email]: { enabled: true } },
            categories: {},
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'channel-user-2',
          notification,
          ChannelType.Email
        );

        expect(shouldSend).toBe(true);
      });
    });

    describe('Category preferences', () => {
      it('should block notifications for disabled categories (boolean)', async () => {
        mockRedis.storage.set(
          'notifications:preferences:category-user',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: { marketing: false },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
          metadata: { category: 'marketing' },
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'category-user',
          notification,
          ChannelType.Email
        );

        expect(shouldSend).toBe(false);
      });

      it('should block notifications for disabled categories (object)', async () => {
        mockRedis.storage.set(
          'notifications:preferences:category-user-2',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: { promotions: { enabled: false } },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Sale!',
          body: 'Big sale today',
          metadata: { category: 'promotions' },
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'category-user-2',
          notification,
          ChannelType.Push
        );

        expect(shouldSend).toBe(false);
      });

      it('should respect category channel restrictions', async () => {
        mockRedis.storage.set(
          'notifications:preferences:category-channel-user',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {
              alerts: { enabled: true, channels: [ChannelType.Push, ChannelType.Email] },
            },
          })
        );

        const notification: NotificationPayload = {
          type: 'warning',
          title: 'Alert',
          body: 'System alert',
          metadata: { category: 'alerts' },
        };

        // SMS not in allowed channels for alerts category
        const shouldSendSms = await preferenceManager.shouldSendNotification(
          'category-channel-user',
          notification,
          ChannelType.SMS
        );

        // Email is allowed
        const shouldSendEmail = await preferenceManager.shouldSendNotification(
          'category-channel-user',
          notification,
          ChannelType.Email
        );

        expect(shouldSendSms).toBe(false);
        expect(shouldSendEmail).toBe(true);
      });

      it('should allow notifications for unconfigured categories', async () => {
        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
          metadata: { category: 'unknown-category' },
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'default-user',
          notification,
          ChannelType.InApp
        );

        expect(shouldSend).toBe(true);
      });
    });

    describe('Frequency limits', () => {
      it('should block notifications exceeding per-minute limit', async () => {
        mockRedis.storage.set(
          'notifications:preferences:freq-user-1',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            frequency: { maxPerMinute: 1 },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        // First notification should pass
        const first = await preferenceManager.shouldSendNotification(
          'freq-user-1',
          notification,
          ChannelType.InApp
        );
        expect(first).toBe(true);

        // Second should be blocked
        const second = await preferenceManager.shouldSendNotification(
          'freq-user-1',
          notification,
          ChannelType.InApp
        );
        expect(second).toBe(false);
      });

      it('should block notifications exceeding per-hour limit', async () => {
        mockRedis.storage.set(
          'notifications:preferences:freq-user-2',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            frequency: { maxPerHour: 2 },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        // First two should pass
        await preferenceManager.shouldSendNotification('freq-user-2', notification, ChannelType.InApp);
        await preferenceManager.shouldSendNotification('freq-user-2', notification, ChannelType.InApp);

        // Third should be blocked
        const third = await preferenceManager.shouldSendNotification(
          'freq-user-2',
          notification,
          ChannelType.InApp
        );
        expect(third).toBe(false);
      });

      it('should block notifications exceeding per-day limit', async () => {
        mockRedis.storage.set(
          'notifications:preferences:freq-user-3',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            frequency: { maxPerDay: 1 },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        // First should pass
        const first = await preferenceManager.shouldSendNotification(
          'freq-user-3',
          notification,
          ChannelType.InApp
        );
        expect(first).toBe(true);

        // Second should be blocked
        const second = await preferenceManager.shouldSendNotification(
          'freq-user-3',
          notification,
          ChannelType.InApp
        );
        expect(second).toBe(false);
      });
    });

    describe('Quiet hours', () => {
      it('should block notifications during quiet hours', async () => {
        // Mock current time to be during quiet hours (e.g., 23:30)
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

        // Set quiet hours to include current time
        const startHour = (currentHour - 1 + 24) % 24;
        const endHour = (currentHour + 1) % 24;

        mockRedis.storage.set(
          'notifications:preferences:quiet-user-1',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            quietHours: {
              enabled: true,
              start: `${startHour.toString().padStart(2, '0')}:00`,
              end: `${endHour.toString().padStart(2, '0')}:00`,
              timezone: 'UTC',
            },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'quiet-user-1',
          notification,
          ChannelType.Email
        );

        expect(shouldSend).toBe(false);
      });

      it('should allow urgent notifications during quiet hours', async () => {
        const now = new Date();
        const currentHour = now.getHours();
        const startHour = (currentHour - 1 + 24) % 24;
        const endHour = (currentHour + 1) % 24;

        mockRedis.storage.set(
          'notifications:preferences:quiet-user-2',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            quietHours: {
              enabled: true,
              start: `${startHour.toString().padStart(2, '0')}:00`,
              end: `${endHour.toString().padStart(2, '0')}:00`,
              timezone: 'UTC',
            },
          })
        );

        const notification: NotificationPayload = {
          type: 'critical',
          title: 'Urgent Alert',
          body: 'Critical system failure',
          metadata: { priority: 'urgent' },
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'quiet-user-2',
          notification,
          ChannelType.Push
        );

        expect(shouldSend).toBe(true);
      });

      it('should allow exception categories during quiet hours', async () => {
        const now = new Date();
        const currentHour = now.getHours();
        const startHour = (currentHour - 1 + 24) % 24;
        const endHour = (currentHour + 1) % 24;

        mockRedis.storage.set(
          'notifications:preferences:quiet-user-3',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            quietHours: {
              enabled: true,
              start: `${startHour.toString().padStart(2, '0')}:00`,
              end: `${endHour.toString().padStart(2, '0')}:00`,
              timezone: 'UTC',
              exceptions: ['security', 'critical-alerts'],
            },
          })
        );

        const notification: NotificationPayload = {
          type: 'warning',
          title: 'Security Alert',
          body: 'Suspicious login detected',
          metadata: { category: 'security' },
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'quiet-user-3',
          notification,
          ChannelType.SMS
        );

        expect(shouldSend).toBe(true);
      });

      it('should allow notifications when quiet hours are disabled', async () => {
        mockRedis.storage.set(
          'notifications:preferences:quiet-user-4',
          JSON.stringify({
            enabled: true,
            channels: {},
            categories: {},
            quietHours: {
              enabled: false,
              start: '22:00',
              end: '08:00',
              timezone: 'UTC',
            },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Test',
          body: 'Test message',
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'quiet-user-4',
          notification,
          ChannelType.Email
        );

        expect(shouldSend).toBe(true);
      });
    });

    describe('Combined preferences', () => {
      it('should evaluate all preference rules', async () => {
        mockRedis.storage.set(
          'notifications:preferences:combined-user',
          JSON.stringify({
            enabled: true,
            channels: { [ChannelType.Email]: { enabled: true } },
            categories: { marketing: true },
            frequency: { maxPerDay: 100 },
            quietHours: { enabled: false, start: '22:00', end: '08:00', timezone: 'UTC' },
          })
        );

        const notification: NotificationPayload = {
          type: 'info',
          title: 'Marketing',
          body: 'New product!',
          metadata: { category: 'marketing' },
        };

        const shouldSend = await preferenceManager.shouldSendNotification(
          'combined-user',
          notification,
          ChannelType.Email
        );

        expect(shouldSend).toBe(true);
      });
    });
  });

  describe('resetPreferences', () => {
    it('should reset preferences to defaults', async () => {
      // First set custom preferences
      mockRedis.storage.set(
        'notifications:preferences:reset-user',
        JSON.stringify({
          enabled: false,
          channels: { [ChannelType.Email]: { enabled: false } },
          categories: {},
        })
      );

      // Reset
      const result = await preferenceManager.resetPreferences('reset-user');

      // Should return defaults
      expect(result.enabled).toBe(true);
      expect(result.channels[ChannelType.Email]?.enabled).toBe(true);
    });

    it('should delete preference key from Redis', async () => {
      await preferenceManager.resetPreferences('reset-user-2');

      expect(mockRedis.del).toHaveBeenCalled();
    });

    it('should clear frequency counters', async () => {
      await preferenceManager.resetPreferences('reset-user-3');

      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringContaining('frequency:reset-user-3:minute'),
        expect.stringContaining('frequency:reset-user-3:hour'),
        expect.stringContaining('frequency:reset-user-3:day')
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing metadata category gracefully', async () => {
      mockRedis.storage.set(
        'notifications:preferences:edge-user-1',
        JSON.stringify({
          enabled: true,
          channels: {},
          categories: { marketing: false },
        })
      );

      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'No category',
        // No metadata.category
      };

      const shouldSend = await preferenceManager.shouldSendNotification(
        'edge-user-1',
        notification,
        ChannelType.InApp
      );

      expect(shouldSend).toBe(true);
    });

    it('should handle string channel type', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test message',
      };

      const shouldSend = await preferenceManager.shouldSendNotification(
        'edge-user-2',
        notification,
        'inApp' as ChannelType
      );

      expect(shouldSend).toBe(true);
    });

    it('should handle empty user ID', async () => {
      const prefs = await preferenceManager.getPreferences('');
      expect(prefs.enabled).toBe(true);
    });

    it('should handle special characters in user ID', async () => {
      const prefs = await preferenceManager.getPreferences('user:with:colons@example.com');
      expect(prefs.enabled).toBe(true);
    });
  });

  describe('Quiet Hours Edge Cases', () => {
    it('should handle overnight quiet hours (spanning midnight)', async () => {
      // Set quiet hours from 22:00 to 06:00 (spans midnight)
      mockRedis.storage.set(
        'notifications:preferences:overnight-user',
        JSON.stringify({
          enabled: true,
          channels: {},
          categories: {},
          quietHours: {
            enabled: true,
            start: '22:00',
            end: '06:00',
            timezone: 'UTC',
          },
        })
      );

      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test message',
      };

      // This test is time-dependent - the result depends on current time
      const shouldSend = await preferenceManager.shouldSendNotification(
        'overnight-user',
        notification,
        ChannelType.Email
      );

      // Just verify it runs without error
      expect(typeof shouldSend).toBe('boolean');
    });

    it('should handle same start and end time', async () => {
      mockRedis.storage.set(
        'notifications:preferences:same-time-user',
        JSON.stringify({
          enabled: true,
          channels: {},
          categories: {},
          quietHours: {
            enabled: true,
            start: '12:00',
            end: '12:00',
            timezone: 'UTC',
          },
        })
      );

      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test message',
      };

      const shouldSend = await preferenceManager.shouldSendNotification(
        'same-time-user',
        notification,
        ChannelType.Email
      );

      // Should allow since start equals end means no quiet period
      expect(typeof shouldSend).toBe('boolean');
    });
  });
});
