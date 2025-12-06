/**
 * Comprehensive Tests for NotificationService
 * Tests notification sending, broadcasting, and scheduling functionality
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  NotificationService,
  NotificationPayload,
  Recipient,
  SendOptions,
} from '../../../src/modules/notifications/index.js';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import { ChannelManager, ChannelType } from '../../../src/modules/notifications/channel-manager.js';
import { PreferenceManager } from '../../../src/modules/notifications/preference-manager.js';
import { RateLimiter } from '../../../src/modules/notifications/rate-limiter.js';

describe('NotificationService', () => {
  let service: NotificationService;
  let rotifManager: NotificationManager;
  let channelManager: ChannelManager;
  let preferenceManager: PreferenceManager;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    // Create mocks
    rotifManager = {
      publish: jest.fn().mockResolvedValue({ id: 'msg-123' }),
      subscribe: jest.fn(),
      unsubscribe: jest.fn(),
      isReady: jest.fn().mockReturnValue(true),
    } as any;

    channelManager = {
      send: jest.fn().mockResolvedValue({
        success: 1,
        failure: 0,
        delivered: [{ id: 'rcpt-1' }],
        failed: [],
      }),
      hasChannel: jest.fn().mockReturnValue(true),
      addChannel: jest.fn(),
      removeChannel: jest.fn(),
      getChannels: jest.fn().mockReturnValue(['inApp', 'email']),
      planDelivery: jest.fn().mockResolvedValue(new Map([['inApp', { recipients: [{ id: 'user-1' }] }]])),
    } as any;

    preferenceManager = {
      getUserPreferences: jest.fn().mockResolvedValue({
        userId: 'user-1',
        channels: {
          inApp: { enabled: true },
          email: { enabled: true },
          sms: { enabled: false },
        },
      }),
      setUserPreferences: jest.fn().mockResolvedValue(true),
      canSend: jest.fn().mockResolvedValue(true),
      shouldSendNotification: jest.fn().mockResolvedValue(true),
    } as any;

    rateLimiter = {
      checkLimit: jest.fn().mockResolvedValue(true),
      recordEvent: jest.fn().mockResolvedValue(true),
      reset: jest.fn().mockResolvedValue(true),
    } as any;

    // Create service instance
    service = new NotificationService(rotifManager, channelManager, preferenceManager, rateLimiter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('send', () => {
    it('should send a notification to a single recipient', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test Notification',
        body: 'This is a test notification',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      // Note: Correct parameter order is (recipients, notification, options)
      const result = await service.send(recipient, notification);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.sent).toBeGreaterThanOrEqual(0);
      expect(preferenceManager.shouldSendNotification).toHaveBeenCalled();
    });

    it('should send notifications to multiple recipients', async () => {
      const notification: NotificationPayload = {
        type: 'success',
        title: 'Batch Notification',
        body: 'Notification to multiple users',
      };

      const recipients: Recipient[] = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
        { id: 'user-3', email: 'user3@example.com' },
      ];

      const result = await service.send(recipients, notification);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('should respect user preferences and filter blocked users', async () => {
      preferenceManager.shouldSendNotification = jest.fn().mockResolvedValue(false);
      channelManager.planDelivery = jest.fn().mockResolvedValue(new Map());

      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test body',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(recipient, notification);

      expect(result.filtered).toBe(1);
      expect(result.sent).toBe(0);
    });

    it('should respect rate limits', async () => {
      rateLimiter.checkLimit = jest.fn().mockResolvedValue(false);
      channelManager.planDelivery = jest.fn().mockResolvedValue(new Map());

      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test body',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(recipient, notification);

      expect(result.filtered).toBe(1);
      expect(result.sent).toBe(0);
    });

    it('should handle channel selection options', async () => {
      const notification: NotificationPayload = {
        type: 'warning',
        title: 'Channel Test',
        body: 'Testing channel selection',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
        phone: '+1234567890',
      };

      const options: SendOptions = {
        channels: [ChannelType.Email, ChannelType.SMS],
      };

      const result = await service.send(recipient, notification, options);

      expect(result).toBeDefined();
      expect(channelManager.planDelivery).toHaveBeenCalled();
    });

    it('should handle deduplication of notifications', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Dedupe Test',
        body: 'Testing deduplication',
        metadata: {
          deduplicationKey: 'unique-key-123',
        },
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const options: SendOptions = {
        exactlyOnce: true,
        deduplicationTTL: 3600000,
      };

      // First send should succeed
      const result1 = await service.send(recipient, notification, options);
      expect(result1.sent).toBeGreaterThanOrEqual(0);

      // Second send with same deduplication key should be filtered
      const result2 = await service.send(recipient, notification, options);
      expect(result2.filtered).toBe(1);
      expect(result2.sent).toBe(0);
    });

    it('should handle scheduled notifications via options', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Scheduled',
        body: 'This is scheduled',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const scheduledTime = new Date(Date.now() + 3600000); // 1 hour from now
      const options: SendOptions = {
        scheduledTime,
      };

      const result = await service.send(recipient, notification, options);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('should handle notification with full metadata', async () => {
      const notification: NotificationPayload = {
        type: 'critical',
        title: 'Critical Alert',
        body: 'System critical error',
        metadata: {
          priority: 'urgent',
          category: 'system-alerts',
          tags: ['critical', 'system', 'urgent'],
          ttl: 3600,
          tracking: {
            impressions: true,
            clicks: true,
          },
        },
      };

      const recipient: Recipient = {
        id: 'admin-1',
        email: 'admin@example.com',
      };

      const result = await service.send(recipient, notification);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('should handle failed delivery gracefully', async () => {
      rotifManager.publish = jest.fn().mockRejectedValue(new Error('Network error'));

      const notification: NotificationPayload = {
        type: 'error',
        title: 'Test',
        body: 'Test body',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(recipient, notification);

      expect(result.failed).toBeGreaterThan(0);
      expect(result.sent).toBe(0);
    });

    it('should handle multiple channels with all strategy', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Multi-Channel Test',
        body: 'Testing multiple channels',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
        phone: '+1234567890',
        pushTokens: ['token-1'],
      };

      const options: SendOptions = {
        channels: [ChannelType.Push, ChannelType.SMS, ChannelType.Email],
        channelStrategy: 'all',
      };

      // Mock planning for multiple channels
      channelManager.planDelivery = jest.fn().mockResolvedValue(
        new Map([
          ['push', { recipients: [recipient] }],
          ['sms', { recipients: [recipient] }],
          ['email', { recipients: [recipient] }],
        ])
      );

      const result = await service.send(recipient, notification, options);

      expect(channelManager.planDelivery).toHaveBeenCalled();
      expect(result.sent).toBeGreaterThanOrEqual(0);
    });

    it('should generate notification ID when not provided', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'No ID Test',
        body: 'Testing ID generation',
      };

      const recipient: Recipient = { id: 'user-1' };

      const result = await service.send(recipient, notification);

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.id.length).toBeGreaterThan(0);
    });

    it('should use provided notification ID', async () => {
      const notification: NotificationPayload = {
        id: 'custom-id-123',
        type: 'info',
        title: 'Custom ID Test',
        body: 'Testing custom ID',
      };

      const recipient: Recipient = { id: 'user-1' };

      const result = await service.send(recipient, notification);

      expect(result.id).toBe('custom-id-123');
    });

    it('should handle empty recipients array', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Empty Test',
        body: 'No recipients',
      };

      const result = await service.send([], notification);

      // With empty recipients, the service may still return a result object
      // The implementation determines behavior - verify consistent structure
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      // sent + failed + filtered = total recipients processed
      expect(typeof result.sent).toBe('number');
      expect(typeof result.failed).toBe('number');
    });

    it('should handle delay option', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Delayed',
        body: 'Delayed notification',
      };

      const recipient: Recipient = { id: 'user-1' };

      const options: SendOptions = {
        delay: 5000, // 5 second delay
      };

      const result = await service.send(recipient, notification, options);

      expect(result).toBeDefined();
      // The delay is passed to rotif publish
      expect(rotifManager.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ delayMs: 5000 })
      );
    });
  });

  describe('broadcast', () => {
    it('should broadcast to a segment', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Broadcast',
        body: 'Broadcast message',
      };

      const target = {
        id: 'broadcast-1',
        segment: 'premium-users',
      };

      const result = await service.broadcast(target, notification);

      expect(result).toBeDefined();
      expect(result.recipients).toBeGreaterThanOrEqual(0);
    });

    it('should broadcast to specific user IDs', async () => {
      const notification: NotificationPayload = {
        type: 'success',
        title: 'Update',
        body: 'New feature available',
      };

      const target = {
        id: 'broadcast-2',
        userIds: ['user-1', 'user-2', 'user-3'],
      };

      const options = {
        batchSize: 2,
      };

      const result = await service.broadcast(target, notification, options);

      expect(result.recipients).toBe(3);
      expect(result.batches).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty user IDs', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Empty Broadcast',
        body: 'No users',
      };

      const target = {
        id: 'broadcast-3',
        userIds: [],
      };

      const result = await service.broadcast(target, notification);

      expect(result.recipients).toBe(0);
    });

    it('should broadcast without batching for small audiences', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Small Broadcast',
        body: 'Small audience',
      };

      const target = {
        id: 'broadcast-4',
        userIds: ['user-1', 'user-2'],
      };

      const options = {
        batchSize: 1000, // Large batch size
      };

      const result = await service.broadcast(target, notification, options);

      expect(result.recipients).toBe(2);
      expect(result.batches).toBeUndefined(); // No batching needed
    });
  });

  describe('schedule', () => {
    it('should schedule a notification for future delivery', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Reminder',
        body: "Don't forget!",
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const deliveryTime = new Date(Date.now() + 86400000); // Tomorrow

      const result = await service.schedule(recipient, notification, deliveryTime);

      expect(result.scheduled).toBe(true);
      expect(result.scheduleId).toBeDefined();
      expect(result.deliveryTime).toBeGreaterThan(Date.now());
    });

    it('should schedule with timestamp number', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Timestamp Test',
        body: 'Using numeric timestamp',
      };

      const recipient: Recipient = { id: 'user-1' };

      const deliveryTime = Date.now() + 3600000; // 1 hour from now

      const result = await service.schedule(recipient, notification, deliveryTime);

      expect(result.scheduled).toBe(true);
      expect(result.deliveryTime).toBe(deliveryTime);
    });

    it('should schedule recurring notifications', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Weekly Report',
        body: 'Your weekly summary',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const deliveryTime = new Date();
      const options = {
        recurrence: {
          pattern: '0 9 * * MON', // Every Monday at 9 AM
          endDate: new Date(Date.now() + 30 * 86400000), // 30 days
        },
      };

      const result = await service.schedule(recipient, notification, deliveryTime, options);

      expect(result.scheduled).toBe(true);
      expect(result.scheduleId).toBeDefined();
    });

    it('should schedule to multiple recipients', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Scheduled Batch',
        body: 'Scheduled for multiple users',
      };

      const recipients: Recipient[] = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
      ];

      const deliveryTime = new Date(Date.now() + 3600000);

      const result = await service.schedule(recipients, notification, deliveryTime);

      expect(result.scheduled).toBe(true);
      expect(result.scheduleId).toBeDefined();
    });
  });

  describe('cancelScheduled', () => {
    it('should cancel a scheduled notification', async () => {
      // First schedule
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const scheduleResult = await service.schedule(recipient, notification, new Date(Date.now() + 3600000));

      // Then cancel
      const cancelResult = await service.cancelScheduled(scheduleResult.scheduleId);

      expect(cancelResult).toBe(true);
    });

    it('should return false for non-existent schedule', async () => {
      const cancelResult = await service.cancelScheduled('non-existent-schedule-id');

      expect(cancelResult).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle recipient with minimal data', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Minimal',
        body: 'Minimal recipient',
      };

      const recipient: Recipient = { id: 'user-1' };

      const result = await service.send(recipient, notification);

      expect(result).toBeDefined();
    });

    it('should handle recipient with all optional fields', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Full Recipient',
        body: 'Full recipient data',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
        phone: '+1234567890',
        pushTokens: ['token-1', 'token-2'],
        webhookUrl: 'https://example.com/webhook',
        locale: 'en-US',
      };

      const result = await service.send(recipient, notification);

      expect(result).toBeDefined();
    });

    it('should handle all notification types', async () => {
      const types: Array<'info' | 'success' | 'warning' | 'error' | 'critical'> = [
        'info',
        'success',
        'warning',
        'error',
        'critical',
      ];

      const recipient: Recipient = { id: 'user-1' };

      for (const type of types) {
        const notification: NotificationPayload = {
          type,
          title: `${type} notification`,
          body: `Testing ${type} type`,
        };

        const result = await service.send(recipient, notification);
        expect(result).toBeDefined();
      }
    });

    it('should handle notification with data payload', async () => {
      const notification: NotificationPayload = {
        type: 'info',
        title: 'Data Payload',
        body: 'With custom data',
        data: {
          actionUrl: 'https://example.com/action',
          buttonText: 'View Now',
          customField: { nested: 'value' },
        },
      };

      const recipient: Recipient = { id: 'user-1' };

      const result = await service.send(recipient, notification);

      expect(result).toBeDefined();
    });

    it('should handle all channel strategies', async () => {
      const strategies: Array<'first-available' | 'all' | 'fallback'> = ['first-available', 'all', 'fallback'];

      const notification: NotificationPayload = {
        type: 'info',
        title: 'Strategy Test',
        body: 'Testing strategies',
      };

      const recipient: Recipient = { id: 'user-1' };

      for (const strategy of strategies) {
        const options: SendOptions = {
          channelStrategy: strategy,
        };

        const result = await service.send(recipient, notification, options);
        expect(result).toBeDefined();
      }
    });
  });
});
