/**
 * Channel Registry Service
 *
 * Manages registration, lifecycle, and health monitoring of notification channels.
 * Provides centralized access to all available channels in the system.
 */

import { Injectable } from '@omnitron-dev/titan/decorators';
import type { NotificationChannel } from './channel.interface.js';
import { ChannelType, type ChannelHealth } from './channel.interface.js';
import type { NotificationRecipient, NotificationPayload } from '../notifications.types.js';

/**
 * Channel selection strategy
 */
export type ChannelStrategy = 'first-available' | 'all' | 'fallback' | 'priority';

/**
 * Options for channel selection
 */
export interface ChannelSelectionOptions {
  /** Channels to consider (default: all registered) */
  channels?: string[];
  /** Selection strategy */
  strategy?: ChannelStrategy;
  /** Recipient to validate against */
  recipient?: NotificationRecipient;
  /** Notification for channel-specific validation */
  notification?: NotificationPayload;
}

/**
 * Result of channel selection
 */
export interface ChannelSelectionResult {
  /** Selected channels in order */
  channels: NotificationChannel[];
  /** Channels that were skipped and why */
  skipped: Array<{ channel: string; reason: string }>;
}

/**
 * Service for managing notification channels
 */
@Injectable()
export class ChannelRegistry {
  private readonly channels = new Map<string, NotificationChannel>();
  private readonly channelPriorities = new Map<string, number>();
  private initialized = false;

  /**
   * Register a notification channel
   * @param channel The channel to register
   * @throws Error if a channel with the same name is already registered
   */
  register(channel: NotificationChannel): void {
    if (this.channels.has(channel.name)) {
      throw new Error(`Channel '${channel.name}' is already registered`);
    }
    this.channels.set(channel.name, channel);
  }

  /**
   * Unregister a notification channel by name
   * @param name The name of the channel to unregister
   * @returns true if the channel was unregistered, false if it wasn't found
   */
  unregister(name: string): boolean {
    return this.channels.delete(name);
  }

  /**
   * Get a channel by name
   * @param name The name of the channel
   * @returns The channel if found, undefined otherwise
   */
  get(name: string): NotificationChannel | undefined {
    return this.channels.get(name);
  }

  /**
   * Get all registered channels
   * @returns Array of all channels
   */
  getAll(): NotificationChannel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Check if a channel is registered
   * @param name The name of the channel
   * @returns true if the channel is registered
   */
  has(name: string): boolean {
    return this.channels.has(name);
  }

  /**
   * Get all channels of a specific type
   * @param type The channel type to filter by
   * @returns Array of channels matching the type
   */
  getByType(type: ChannelType): NotificationChannel[] {
    return Array.from(this.channels.values()).filter((channel) => channel.type === type);
  }

  /**
   * Get channels by names
   * @param names Array of channel names
   * @returns Array of found channels
   */
  getByNames(names: string[]): NotificationChannel[] {
    return names.map((name) => this.channels.get(name)).filter((ch): ch is NotificationChannel => ch !== undefined);
  }

  /**
   * Initialize all registered channels
   * Calls the initialize() method on each channel if it exists
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initPromises: Promise<void>[] = [];
    for (const channel of this.channels.values()) {
      if (channel.initialize) {
        initPromises.push(channel.initialize());
      }
    }

    await Promise.all(initPromises);
    this.initialized = true;
  }

  /**
   * Shutdown all registered channels
   * Calls the shutdown() method on each channel if it exists
   */
  async shutdownAll(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const shutdownPromises: Promise<void>[] = [];
    for (const channel of this.channels.values()) {
      if (channel.shutdown) {
        shutdownPromises.push(channel.shutdown());
      }
    }

    await Promise.all(shutdownPromises);
    this.initialized = false;
  }

  /**
   * Perform health checks on all registered channels
   * @returns Map of channel names to their health status
   */
  async healthCheck(): Promise<Map<string, ChannelHealth>> {
    const healthMap = new Map<string, ChannelHealth>();
    const healthPromises = Array.from(this.channels.entries()).map(async ([name, channel]) => {
      try {
        const health = await channel.healthCheck();
        healthMap.set(name, health);
      } catch (error) {
        healthMap.set(name, {
          name,
          type: channel.type,
          available: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.all(healthPromises);
    return healthMap;
  }

  /**
   * Check availability of all channels
   * @returns Map of channel names to availability status
   */
  async checkAvailability(): Promise<Map<string, boolean>> {
    const availabilityMap = new Map<string, boolean>();
    const availabilityPromises = Array.from(this.channels.entries()).map(async ([name, channel]) => {
      try {
        const available = await channel.isAvailable();
        availabilityMap.set(name, available);
      } catch {
        availabilityMap.set(name, false);
      }
    });

    await Promise.all(availabilityPromises);
    return availabilityMap;
  }

  /**
   * Get the number of registered channels
   * @returns Number of channels
   */
  get count(): number {
    return this.channels.size;
  }

  /**
   * Get the initialization status
   * @returns true if all channels have been initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Select channels based on strategy
   * @param options Selection options including strategy and filters
   * @returns Selected channels and skipped channels with reasons
   */
  async selectChannels(options: ChannelSelectionOptions = {}): Promise<ChannelSelectionResult> {
    const { channels: requestedChannels, strategy = 'all', recipient, notification: _notification } = options;

    const result: ChannelSelectionResult = {
      channels: [],
      skipped: [],
    };

    // Get channels to consider
    let candidates = requestedChannels ? this.getByNames(requestedChannels) : this.getAll();

    // Sort by priority if priority strategy
    if (strategy === 'priority') {
      candidates = [...candidates].sort((a, b) => {
        const priorityA = this.channelPriorities.get(a.name) ?? 100;
        const priorityB = this.channelPriorities.get(b.name) ?? 100;
        return priorityA - priorityB;
      });
    }

    for (const channel of candidates) {
      // Check availability
      let available: boolean;
      try {
        available = await channel.isAvailable();
      } catch {
        available = false;
      }

      if (!available) {
        result.skipped.push({ channel: channel.name, reason: 'not_available' });
        continue;
      }

      // Validate recipient if provided
      if (recipient && !channel.validateRecipient(recipient)) {
        result.skipped.push({ channel: channel.name, reason: 'invalid_recipient' });
        continue;
      }

      // Channel is suitable
      result.channels.push(channel);

      // For 'first-available', stop after finding one
      if (strategy === 'first-available' && result.channels.length === 1) {
        break;
      }
    }

    return result;
  }

  /**
   * Set channel priority (lower number = higher priority)
   * @param channelName The name of the channel
   * @param priority Priority value (lower = higher priority)
   */
  setPriority(channelName: string, priority: number): void {
    this.channelPriorities.set(channelName, priority);
  }

  /**
   * Get channel priority
   * @param channelName The name of the channel
   * @returns Priority value (default: 100)
   */
  getPriority(channelName: string): number {
    return this.channelPriorities.get(channelName) ?? 100;
  }

  /**
   * Clear all registered channels
   * @throws Error if channels are currently initialized
   */
  clear(): void {
    if (this.initialized) {
      throw new Error('Cannot clear channels while initialized. Call shutdownAll() first.');
    }
    this.channels.clear();
  }
}
