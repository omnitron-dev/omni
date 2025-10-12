import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { Container } from '../../../src/nexus/index.js';
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
  let container: Container;
  let service: NotificationService;
  let rotifManager: NotificationManager;
  let channelManager: ChannelManager;
  let preferenceManager: PreferenceManager;
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    container = new Container();

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
      getChannels: jest.fn().mockReturnValue(['in-app', 'email']),
      planDelivery: jest.fn().mockResolvedValue(new Map([['in-app', { recipients: [{ id: 'user-1' }] }]])),
    } as any;

    preferenceManager = {
      getUserPreferences: jest.fn().mockResolvedValue({
        userId: 'user-1',
        channels: {
          'in-app': { enabled: true },
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
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test Notification',
        body: 'This is a test notification',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(payload, recipient);

      expect(result).toBeDefined();
      expect(result.sent).toBeGreaterThan(0);
      expect(result.failed).toBe(0);
      expect(preferenceManager.shouldSendNotification).toHaveBeenCalled();
      expect(rotifManager.publish).toHaveBeenCalled();
    });

    it('should send notifications to multiple recipients', async () => {
      const payload: NotificationPayload = {
        type: 'success',
        title: 'Batch Notification',
        body: 'Notification to multiple users',
      };

      const recipients: Recipient[] = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
        { id: 'user-3', email: 'user3@example.com' },
      ];

      const result = await service.send(payload, recipients);

      expect(result.sent).toBeGreaterThan(0);
      expect(rotifManager.publish).toHaveBeenCalled();
    });

    it('should respect user preferences', async () => {
      preferenceManager.shouldSendNotification = jest.fn().mockResolvedValue(false);
      channelManager.planDelivery = jest.fn().mockResolvedValue(new Map());

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test body',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(payload, recipient);

      expect(result.filtered).toBeGreaterThan(0);
      expect(result.sent).toBe(0);
      expect(rotifManager.publish).not.toHaveBeenCalled();
    });

    it('should respect rate limits', async () => {
      rateLimiter.checkLimit = jest.fn().mockResolvedValue(false);
      channelManager.planDelivery = jest.fn().mockResolvedValue(new Map());

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test body',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(payload, recipient);

      expect(result.filtered).toBeGreaterThan(0);
      expect(result.sent).toBe(0);
      expect(rotifManager.publish).not.toHaveBeenCalled();
    });

    it('should handle channel selection', async () => {
      const payload: NotificationPayload = {
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
        channels: [ChannelType.EMAIL, ChannelType.SMS],
      };

      const result = await service.send(payload, recipient, options);

      expect(result).toBeDefined();
      expect(channelManager.planDelivery).toHaveBeenCalled();
      expect(rotifManager.publish).toHaveBeenCalled();
    });

    it('should handle deduplication', async () => {
      const payload: NotificationPayload = {
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

      // First send
      const result1 = await service.send(recipient, payload, options);
      expect(result1.sent).toBeGreaterThan(0);

      // Second send with same deduplication key
      // Reset the mock's state from the previous call
      rotifManager.publish = jest.fn().mockResolvedValue({ id: 'msg-124' });

      const result2 = await service.send(recipient, payload, options);
      expect(result2.filtered).toBe(1);
      expect(result2.sent).toBe(0);
    });

    it('should handle scheduled notifications', async () => {
      const payload: NotificationPayload = {
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

      const result = await service.send(payload, recipient, options);

      expect(result).toBeDefined();
      expect(rotifManager.publish).toHaveBeenCalled();
    });

    it('should handle notification with metadata', async () => {
      const payload: NotificationPayload = {
        type: 'critical',
        title: 'Critical Alert',
        body: 'System critical error',
        metadata: {
          priority: 'urgent',
          category: 'system-alerts',
          tags: ['critical', 'system', 'urgent'],
          ttl: 3600,
        },
      };

      const recipient: Recipient = {
        id: 'admin-1',
        email: 'admin@example.com',
      };

      const result = await service.send(payload, recipient);

      expect(result.sent).toBeGreaterThan(0);
      expect(rotifManager.publish).toHaveBeenCalled();
    });

    it('should handle failed delivery gracefully', async () => {
      rotifManager.publish = jest.fn().mockRejectedValue(new Error('Network error'));

      const payload: NotificationPayload = {
        type: 'error',
        title: 'Test',
        body: 'Test body',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const result = await service.send(payload, recipient);

      expect(result.failed).toBeGreaterThan(0);
      expect(result.sent).toBe(0);
    });

    it('should handle multiple channels', async () => {
      const payload: NotificationPayload = {
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
        channels: [ChannelType.PUSH, ChannelType.SMS, ChannelType.EMAIL],
      };

      // Mock planning for multiple channels
      channelManager.planDelivery = jest.fn().mockResolvedValue(
        new Map([
          ['push', { recipients: [recipient] }],
          ['sms', { recipients: [recipient] }],
          ['email', { recipients: [recipient] }],
        ])
      );

      const result = await service.send(payload, recipient, options);

      expect(channelManager.planDelivery).toHaveBeenCalled();
      expect(result.sent).toBeGreaterThan(0);
    });
  });

  describe('broadcast', () => {
    it('should broadcast to a segment', async () => {
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Broadcast',
        body: 'Broadcast message',
      };

      const target: any = {
        segment: 'premium-users',
      };

      const result = await service.broadcast(target, payload);

      expect(result).toBeDefined();
      expect(result.recipients).toBeGreaterThanOrEqual(0);
    });

    it('should broadcast to specific user IDs', async () => {
      const payload: NotificationPayload = {
        type: 'success',
        title: 'Update',
        body: 'New feature available',
      };

      const target: any = {
        userIds: ['user-1', 'user-2', 'user-3'],
      };

      const options = {
        batchSize: 2,
      };

      const result = await service.broadcast(target, payload, options);

      expect(result.recipients).toBe(3);
      expect(result.batches).toBeGreaterThanOrEqual(2);
    });
  });

  describe('schedule', () => {
    it('should schedule a notification', async () => {
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Reminder',
        body: "Don't forget!",
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const deliveryTime = new Date(Date.now() + 86400000); // Tomorrow

      const result = await service.schedule(recipient, payload, deliveryTime);

      expect(result.scheduled).toBe(true);
      expect(result.scheduleId).toBeDefined();
      expect(result.deliveryTime).toBeGreaterThan(Date.now());
    });

    it('should schedule recurring notifications', async () => {
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Weekly Report',
        body: 'Your weekly summary',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const deliveryTime = new Date();
      const options: any = {
        recurrence: {
          pattern: '0 9 * * MON', // Every Monday at 9 AM
          endDate: new Date(Date.now() + 30 * 86400000), // 30 days
        },
      };

      const result = await service.schedule(recipient, payload, deliveryTime, options);

      expect(result.scheduled).toBe(true);
      expect(result.scheduleId).toBeDefined();
    });
  });

  describe('cancelScheduled', () => {
    it('should cancel a scheduled notification', async () => {
      // First schedule
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test',
        body: 'Test',
      };

      const recipient: Recipient = {
        id: 'user-1',
        email: 'user@example.com',
      };

      const scheduleResult = await service.schedule(recipient, payload, new Date(Date.now() + 3600000));

      // Then cancel
      const cancelResult = await service.cancelScheduled(scheduleResult.scheduleId);

      expect(cancelResult).toBe(true);
    });
  });
});
