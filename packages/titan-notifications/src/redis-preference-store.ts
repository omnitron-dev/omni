/**
 * Redis-based Preference Store for Notifications
 *
 * Production-ready implementation with:
 * - Quiet hours with timezone support
 * - Category-based preferences
 * - Per-user frequency limits
 * - Digest mode support
 */

import { Injectable, Optional } from '@omnitron-dev/titan/decorators';
import { safeJsonParse } from '@omnitron-dev/titan/utils';
import type { Redis } from 'ioredis';
import type { IPreferenceStore, NotificationPreferences, NotificationPayload } from './notifications.types.js';

// ============================================================================
// Extended Types
// ============================================================================

export interface ExtendedNotificationPreferences extends NotificationPreferences {
  /** Per-category preferences */
  categories?: Record<string, CategoryPreference>;
  /** Per-user frequency limits */
  frequency?: FrequencyLimits;
  /** Digest mode configuration */
  digest?: DigestConfig;
  /** Global quiet hours (applies to all channels) */
  quietHours?: QuietHoursConfig;
  /** Priority exceptions (allow urgent even during quiet hours) */
  allowUrgent?: boolean;
}

export interface CategoryPreference {
  enabled: boolean;
  channels?: string[];
  /** Override frequency for this category */
  frequency?: FrequencyLimits;
}

export interface FrequencyLimits {
  maxPerMinute?: number;
  maxPerHour?: number;
  maxPerDay?: number;
}

export interface DigestConfig {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly';
  /** Time to send digest (HH:mm format) */
  sendAt?: string;
  /** Day of week for weekly (0-6, Sunday=0) */
  dayOfWeek?: number;
  /** Day of month for monthly (1-31) */
  dayOfMonth?: number;
  /** Categories to include in digest */
  categories?: string[];
}

export interface QuietHoursConfig {
  enabled: boolean;
  /** Start time in HH:mm format */
  start: string;
  /** End time in HH:mm format */
  end: string;
  /** IANA timezone (e.g., 'America/New_York') */
  timezone?: string;
  /** Categories that bypass quiet hours */
  exceptions?: string[];
}

export interface RedisPreferenceStoreOptions {
  /** Redis key prefix */
  keyPrefix?: string;
  /** Default preferences for new users */
  defaultPreferences?: Partial<ExtendedNotificationPreferences>;
  /** TTL for frequency counters in seconds */
  counterTTL?: number;
}

// ============================================================================
// Default Preferences
// ============================================================================

const DEFAULT_PREFERENCES: ExtendedNotificationPreferences = {
  channels: {
    email: { enabled: true },
    push: { enabled: true },
    sms: { enabled: false },
    inApp: { enabled: true },
    webhook: { enabled: false },
  },
  globalMute: false,
  locale: 'en',
  timezone: 'UTC',
  allowUrgent: true,
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
    timezone: 'UTC',
    exceptions: [],
  },
};

// ============================================================================
// Implementation
// ============================================================================

@Injectable()
export class RedisPreferenceStore implements IPreferenceStore {
  private readonly keyPrefix: string;
  private readonly defaultPreferences: ExtendedNotificationPreferences;
  private readonly counterTTL: number;

  /**
   * Maximum number of preferences to store in memory.
   * Prevents unbounded growth when using in-memory fallback (no Redis).
   * FIFO eviction when limit reached - oldest preferences are removed.
   */
  private static readonly MAX_MEMORY_PREFERENCES = 10000;

  /**
   * Maximum number of frequency counter entries in memory.
   * Prevents unbounded growth from tracking many recipient+type combinations.
   */
  private static readonly MAX_MEMORY_COUNTERS = 50000;

  // In-memory store when Redis not available (bounded by MAX_MEMORY_PREFERENCES)
  private readonly memoryStore = new Map<string, ExtendedNotificationPreferences>();
  // Frequency counters (bounded by MAX_MEMORY_COUNTERS)
  private readonly counterStore = new Map<string, { count: number; resetAt: number }>();

  constructor(
    @Optional() private readonly redis?: Redis,
    options?: RedisPreferenceStoreOptions
  ) {
    this.keyPrefix = options?.keyPrefix ?? 'notifications:prefs:';
    this.defaultPreferences = { ...DEFAULT_PREFERENCES, ...options?.defaultPreferences };
    this.counterTTL = options?.counterTTL ?? 86400;
  }

  // ============================================================================
  // IPreferenceStore Implementation
  // ============================================================================

  async getPreferences(recipientId: string): Promise<ExtendedNotificationPreferences | null> {
    if (this.redis) {
      const key = this.buildKey(recipientId);
      const data = await this.redis.get(key);
      return data ? safeJsonParse<ExtendedNotificationPreferences>(data) : null;
    }
    return this.memoryStore.get(recipientId) ?? null;
  }

  async setPreferences(recipientId: string, preferences: Partial<ExtendedNotificationPreferences>): Promise<void> {
    const fullPrefs: ExtendedNotificationPreferences = {
      ...this.defaultPreferences,
      ...preferences,
      channels: {
        ...this.defaultPreferences.channels,
        ...preferences.channels,
      },
    };

    if (this.redis) {
      const key = this.buildKey(recipientId);
      await this.redis.set(key, JSON.stringify(fullPrefs));
    } else {
      // Apply FIFO eviction if at capacity
      if (!this.memoryStore.has(recipientId) && this.memoryStore.size >= RedisPreferenceStore.MAX_MEMORY_PREFERENCES) {
        const firstKey = this.memoryStore.keys().next().value;
        if (firstKey) {
          this.memoryStore.delete(firstKey);
        }
      }
      this.memoryStore.set(recipientId, fullPrefs);
    }
  }

  async updatePreferences(recipientId: string, updates: Partial<ExtendedNotificationPreferences>): Promise<void> {
    const current = await this.getPreferences(recipientId);
    const merged = this.mergePreferences(current ?? this.defaultPreferences, updates);
    await this.setPreferences(recipientId, merged);
  }

  async deletePreferences(recipientId: string): Promise<void> {
    if (this.redis) {
      const key = this.buildKey(recipientId);
      await this.redis.del(key);
      // Also delete frequency counters
      const counterPattern = `${this.keyPrefix}counter:${recipientId}:*`;
      const keys = await this.redis.keys(counterPattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } else {
      this.memoryStore.delete(recipientId);
    }
  }

  // ============================================================================
  // Advanced Methods
  // ============================================================================

  /**
   * Comprehensive check if notification should be sent
   */
  async shouldSend(
    recipientId: string,
    payload: NotificationPayload,
    channel: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const prefs = (await this.getPreferences(recipientId)) ?? this.defaultPreferences;

    // 1. Check global mute
    if (prefs.globalMute) {
      return { allowed: false, reason: 'global_mute' };
    }

    // 2. Check channel enabled
    const channelPref = prefs.channels[channel];
    if (channelPref && !channelPref.enabled) {
      return { allowed: false, reason: 'channel_disabled' };
    }

    // 3. Check notification type allowed for channel
    if (channelPref?.types && !channelPref.types.includes(payload.type)) {
      return { allowed: false, reason: 'type_not_allowed' };
    }

    // 4. Check category preferences
    const category = payload.metadata?.category;
    if (category && prefs.categories) {
      const categoryPref = prefs.categories[category];
      if (categoryPref && !categoryPref.enabled) {
        return { allowed: false, reason: 'category_disabled' };
      }
      if (categoryPref?.channels && !categoryPref.channels.includes(channel)) {
        return { allowed: false, reason: 'category_channel_not_allowed' };
      }
    }

    // 5. Check quiet hours
    const quietHoursResult = this.checkQuietHours(prefs, payload, channel);
    if (!quietHoursResult.allowed) {
      return quietHoursResult;
    }

    // 6. Check frequency limits
    const frequencyResult = await this.checkFrequencyLimits(recipientId, prefs, category);
    if (!frequencyResult.allowed) {
      return frequencyResult;
    }

    return { allowed: true };
  }

  /**
   * Record that a notification was sent (for frequency tracking)
   */
  async recordSent(recipientId: string, category?: string): Promise<void> {
    const now = Date.now();

    // Record for minute/hour/day windows
    const windows = ['minute', 'hour', 'day'] as const;
    const divisors = { minute: 60000, hour: 3600000, day: 86400000 };

    for (const window of windows) {
      const bucket = Math.floor(now / divisors[window]);
      const key = category
        ? `${this.keyPrefix}counter:${recipientId}:${category}:${window}:${bucket}`
        : `${this.keyPrefix}counter:${recipientId}:${window}:${bucket}`;

      if (this.redis) {
        await this.redis.incr(key);
        await this.redis.expire(key, this.counterTTL);
      } else {
        const entry = this.counterStore.get(key);
        if (entry && entry.resetAt > now) {
          entry.count++;
        } else {
          // Apply FIFO eviction if at capacity (before adding new entry)
          if (!this.counterStore.has(key) && this.counterStore.size >= RedisPreferenceStore.MAX_MEMORY_COUNTERS) {
            // Clean up expired entries first
            for (const [k, v] of this.counterStore.entries()) {
              if (v.resetAt < now) {
                this.counterStore.delete(k);
              }
            }
            // If still at capacity, evict oldest (FIFO)
            if (this.counterStore.size >= RedisPreferenceStore.MAX_MEMORY_COUNTERS) {
              const firstKey = this.counterStore.keys().next().value;
              if (firstKey) {
                this.counterStore.delete(firstKey);
              }
            }
          }
          this.counterStore.set(key, {
            count: 1,
            resetAt: now + divisors[window],
          });
        }
      }
    }
  }

  /**
   * Get default preferences (for new users)
   */
  getDefaultPreferences(): ExtendedNotificationPreferences {
    return { ...this.defaultPreferences };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private buildKey(recipientId: string): string {
    return `${this.keyPrefix}${recipientId}`;
  }

  private mergePreferences(
    current: ExtendedNotificationPreferences,
    updates: Partial<ExtendedNotificationPreferences>
  ): ExtendedNotificationPreferences {
    return {
      ...current,
      ...updates,
      channels: {
        ...current.channels,
        ...updates.channels,
      },
      categories: {
        ...current.categories,
        ...updates.categories,
      },
      quietHours: updates.quietHours ? { ...current.quietHours, ...updates.quietHours } : current.quietHours,
      frequency: updates.frequency ? { ...current.frequency, ...updates.frequency } : current.frequency,
      digest: updates.digest ? { ...current.digest, ...updates.digest } : current.digest,
    };
  }

  private checkQuietHours(
    prefs: ExtendedNotificationPreferences,
    payload: NotificationPayload,
    channel: string
  ): { allowed: boolean; reason?: string } {
    // Check channel-specific quiet hours
    const channelPref = prefs.channels[channel];
    if (channelPref?.quietHours) {
      if (this.isInQuietHours(channelPref.quietHours.start, channelPref.quietHours.end, prefs.timezone)) {
        // Check if urgent notifications bypass quiet hours
        if (prefs.allowUrgent && payload.priority === 'urgent') {
          return { allowed: true };
        }
        return { allowed: false, reason: 'channel_quiet_hours' };
      }
    }

    // Check global quiet hours
    if (prefs.quietHours?.enabled) {
      if (
        this.isInQuietHours(prefs.quietHours.start, prefs.quietHours.end, prefs.quietHours.timezone ?? prefs.timezone)
      ) {
        // Check exceptions
        const category = payload.metadata?.category;
        if (category && prefs.quietHours.exceptions?.includes(category)) {
          return { allowed: true };
        }
        // Check urgent bypass
        if (prefs.allowUrgent && payload.priority === 'urgent') {
          return { allowed: true };
        }
        return { allowed: false, reason: 'quiet_hours' };
      }
    }

    return { allowed: true };
  }

  private isInQuietHours(start: string, end: string, timezone?: string): boolean {
    const now = new Date();
    const currentMinutes = this.getCurrentMinutesInTimezone(now, timezone);
    const startMinutes = this.parseTimeToMinutes(start);
    const endMinutes = this.parseTimeToMinutes(end);

    // Handle midnight-spanning ranges (e.g., 22:00 to 08:00)
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  private getCurrentMinutesInTimezone(date: Date, timezone?: string): number {
    try {
      if (timezone) {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour: 'numeric',
          minute: 'numeric',
          hour12: false,
        });
        const parts = formatter.formatToParts(date);
        const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
        const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
        return hour * 60 + minute;
      }
    } catch {
      // Fallback to UTC
    }
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }

  private parseTimeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  }

  private async checkFrequencyLimits(
    recipientId: string,
    prefs: ExtendedNotificationPreferences,
    category?: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const limits =
      category && prefs.categories?.[category]?.frequency ? prefs.categories[category].frequency : prefs.frequency;

    if (!limits) {
      return { allowed: true };
    }

    const now = Date.now();
    const checks = [
      { window: 'minute', limit: limits.maxPerMinute, divisor: 60000 },
      { window: 'hour', limit: limits.maxPerHour, divisor: 3600000 },
      { window: 'day', limit: limits.maxPerDay, divisor: 86400000 },
    ];

    for (const check of checks) {
      if (!check.limit) continue;

      const bucket = Math.floor(now / check.divisor);
      const key = category
        ? `${this.keyPrefix}counter:${recipientId}:${category}:${check.window}:${bucket}`
        : `${this.keyPrefix}counter:${recipientId}:${check.window}:${bucket}`;

      let count = 0;
      if (this.redis) {
        count = parseInt((await this.redis.get(key)) || '0', 10);
      } else {
        const entry = this.counterStore.get(key);
        if (entry && entry.resetAt > now) {
          count = entry.count;
        }
      }

      if (count >= check.limit) {
        return { allowed: false, reason: `frequency_${check.window}_exceeded` };
      }
    }

    return { allowed: true };
  }
}
