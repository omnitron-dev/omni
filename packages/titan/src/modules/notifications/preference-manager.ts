import { Injectable } from '../../decorators/index.js';
import { Redis } from 'ioredis';
import type { ILogger } from '../logger/logger.types.js';
import { NotificationPayload } from './notifications.service.js';
import { ChannelType } from './channel-manager.js';

export interface ChannelPreference {
  enabled: boolean;
  settings?: any;
}

export interface CategoryPreference {
  enabled: boolean;
  channels?: ChannelType[];
  frequency?: FrequencyLimit;
}

export interface FrequencyLimit {
  maxPerDay?: number;
  maxPerHour?: number;
  maxPerMinute?: number;
}

export interface QuietHours {
  enabled: boolean;
  start: string; // HH:mm format
  end: string; // HH:mm format
  timezone: string;
  exceptions?: string[]; // Category exceptions
}

export interface UserPreferences {
  enabled: boolean;
  channels: {
    [key in ChannelType]?: ChannelPreference;
  };
  categories: {
    [category: string]: boolean | CategoryPreference;
  };
  frequency?: FrequencyLimit;
  quietHours?: QuietHours;
  locale?: string;
  digest?: {
    enabled: boolean;
    frequency: 'daily' | 'weekly' | 'monthly';
    time: string; // HH:mm format
    channels: ChannelType[];
  };
}

@Injectable()
export class PreferenceManager {
  private readonly PREFERENCE_KEY_PREFIX = 'notifications:preferences:';
  private readonly FREQUENCY_KEY_PREFIX = 'notifications:frequency:';
  private defaultPreferences: UserPreferences;

  constructor(
    private redis: Redis,
    private logger?: ILogger,
  ) {
    this.defaultPreferences = this.getDefaultPreferences();
  }

  /**
   * Get user notification preferences
   */
  async getPreferences(userId: string): Promise<UserPreferences> {
    const key = `${this.PREFERENCE_KEY_PREFIX}${userId}`;
    const stored = await this.redis.get(key);

    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (error) {
        this.logger?.warn({ err: error, userId }, 'Failed to parse user preferences');
        // Fall back to defaults if parsing fails
      }
    }

    return this.defaultPreferences;
  }

  /**
   * Update user preferences
   */
  async updatePreferences(userId: string, updates: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getPreferences(userId);
    const updated = this.mergePreferences(current, updates);

    const key = `${this.PREFERENCE_KEY_PREFIX}${userId}`;
    await this.redis.set(key, JSON.stringify(updated));

    return updated;
  }

  /**
   * Check if notification should be sent based on preferences
   */
  async shouldSendNotification(
    userId: string,
    notification: NotificationPayload,
    channel: ChannelType | string
  ): Promise<boolean> {
    const prefs = await this.getPreferences(userId);

    // Global opt-out
    if (!prefs.enabled) {
      return false;
    }

    // Channel-specific opt-out
    const channelType = channel as ChannelType;
    if (prefs.channels[channelType] && !prefs.channels[channelType]!.enabled) {
      return false;
    }

    // Category preferences
    if (notification.metadata?.category) {
      const categoryPref = prefs.categories[notification.metadata.category];
      if (categoryPref === false) {
        return false;
      }
      if (typeof categoryPref === 'object' && !categoryPref.enabled) {
        return false;
      }
      if (typeof categoryPref === 'object' && categoryPref.channels && !categoryPref.channels.includes(channelType)) {
        return false;
      }
    }

    // Frequency limits
    if (prefs.frequency) {
      const withinLimit = await this.checkFrequencyLimit(userId, prefs.frequency);
      if (!withinLimit) {
        return false;
      }
    }

    // Quiet hours (skip for urgent notifications)
    if (prefs.quietHours?.enabled && notification.metadata?.priority !== 'urgent') {
      const inQuietHours = this.isInQuietHours(prefs.quietHours);
      if (inQuietHours && !this.isException(notification, prefs.quietHours)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check frequency limits
   */
  private async checkFrequencyLimit(userId: string, limit: FrequencyLimit): Promise<boolean> {
    const now = Date.now();

    // Check per-minute limit
    if (limit.maxPerMinute) {
      const minuteKey = `${this.FREQUENCY_KEY_PREFIX}${userId}:minute`;
      const minuteCount = await this.getAndIncrementCounter(minuteKey, 60);
      if (minuteCount > limit.maxPerMinute) {
        return false;
      }
    }

    // Check per-hour limit
    if (limit.maxPerHour) {
      const hourKey = `${this.FREQUENCY_KEY_PREFIX}${userId}:hour`;
      const hourCount = await this.getAndIncrementCounter(hourKey, 3600);
      if (hourCount > limit.maxPerHour) {
        return false;
      }
    }

    // Check per-day limit
    if (limit.maxPerDay) {
      const dayKey = `${this.FREQUENCY_KEY_PREFIX}${userId}:day`;
      const dayCount = await this.getAndIncrementCounter(dayKey, 86400);
      if (dayCount > limit.maxPerDay) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get and increment counter with TTL
   */
  private async getAndIncrementCounter(key: string, ttl: number): Promise<number> {
    const multi = this.redis.multi();
    multi.incr(key);
    multi.expire(key, ttl);
    const result = await multi.exec();

    if (!result || !result[0] || result[0][0]) {
      return 1; // Default to 1 if there's an error
    }

    return result[0][1] as number;
  }

  /**
   * Check if current time is within quiet hours
   */
  private isInQuietHours(quietHours: QuietHours): boolean {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Parse start and end times
    const startParts = quietHours.start.split(':').map(Number);
    const endParts = quietHours.end.split(':').map(Number);
    const currentParts = currentTime.split(':').map(Number);

    const startHour = startParts[0] ?? 0;
    const startMinute = startParts[1] ?? 0;
    const endHour = endParts[0] ?? 0;
    const endMinute = endParts[1] ?? 0;
    const currentHour = currentParts[0] ?? 0;
    const currentMinute = currentParts[1] ?? 0;

    // Convert to minutes for easier comparison
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    const currentMinutes = currentHour * 60 + currentMinute;

    // Handle overnight quiet hours
    if (startMinutes > endMinutes) {
      // Quiet hours span midnight
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    } else {
      // Normal quiet hours
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
  }

  /**
   * Check if notification is an exception to quiet hours
   */
  private isException(notification: NotificationPayload, quietHours: QuietHours): boolean {
    if (!quietHours.exceptions || !notification.metadata?.category) {
      return false;
    }

    return quietHours.exceptions.includes(notification.metadata.category);
  }

  /**
   * Merge preference updates with current preferences
   */
  private mergePreferences(current: UserPreferences, updates: Partial<UserPreferences>): UserPreferences {
    return {
      ...current,
      ...updates,
      channels: {
        ...current.channels,
        ...(updates.channels || {}),
      },
      categories: {
        ...current.categories,
        ...(updates.categories || {}),
      },
    };
  }

  /**
   * Get default preferences
   */
  private getDefaultPreferences(): UserPreferences {
    return {
      enabled: true,
      channels: {
        [ChannelType.Email]: { enabled: true },
        [ChannelType.Push]: { enabled: true },
        [ChannelType.SMS]: { enabled: false },
        [ChannelType.InApp]: { enabled: true },
        [ChannelType.Webhook]: { enabled: false },
      },
      categories: {},
      frequency: {
        maxPerDay: 50,
        maxPerHour: 10,
        maxPerMinute: 3,
      },
      quietHours: {
        enabled: false,
        start: '22:00',
        end: '08:00',
        timezone: 'UTC',
        exceptions: [],
      },
      locale: 'en',
    };
  }

  /**
   * Reset user preferences to defaults
   */
  async resetPreferences(userId: string): Promise<UserPreferences> {
    const key = `${this.PREFERENCE_KEY_PREFIX}${userId}`;
    await this.redis.del(key);

    // Also clear frequency counters
    const frequencyKeys = [
      `${this.FREQUENCY_KEY_PREFIX}${userId}:minute`,
      `${this.FREQUENCY_KEY_PREFIX}${userId}:hour`,
      `${this.FREQUENCY_KEY_PREFIX}${userId}:day`,
    ];
    await this.redis.del(...frequencyKeys);

    return this.defaultPreferences;
  }
}
