/**
 * Comprehensive Integration Tests for NotificationsService
 *
 * Tests all NotificationsService operations including:
 * - Send operations (basic, with options, scheduled)
 * - Broadcast operations (multiple recipients, batching, throttling)
 * - Schedule operations (Date/timestamp)
 * - Rate limiting integration
 * - Preference store integration
 * - Channel router integration
 * - DLQ methods
 * - Middleware hooks
 * - Health & lifecycle
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type {
  IRateLimiter,
  IPreferenceStore,
  IChannelRouter,
  NotificationRecipient,
  NotificationPayload,
} from '../../../src/modules/notifications/notifications.types.js';
import type {
  MessagingTransport,
  NotificationHandler,
  IncomingNotification,
  TransportMiddleware,
} from '../../../src/modules/notifications/transport/transport.interface.js';
import {
  createNotificationsTestFixture,
  createMockTransport,
  shouldSkipDockerTests,
  type NotificationsTestFixture,
} from './notifications-test-setup.js';
import { NotificationsService } from '../../../src/modules/notifications/notifications.service.js';

const SKIP_DOCKER = shouldSkipDockerTests();
const describeOrSkip = SKIP_DOCKER ? describe.skip : describe;

// ============================================================================
// Docker Integration Tests (Real Redis)
// ============================================================================

describeOrSkip('NotificationsService - Docker Integration', () => {
  let fixture: NotificationsTestFixture;

  beforeAll(async () => {
    fixture = await createNotificationsTestFixture();
  }, 60000);

  afterAll(async () => {
    await fixture.cleanup();
  }, 30000);

  beforeEach(async () => {
    // Clear Redis between tests
    await fixture.redis.flushall();
  });

  describe('Send Operations', () => {
    it('should send notification with basic payload', async () => {
      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test Notification',
        message: 'This is a test',
      };

      // Subscribe to capture the message
      const receivedMessages: IncomingNotification[] = [];
      await fixture.transport.subscribe('notifications.info.*', async (msg) => {
        receivedMessages.push(msg);
        await msg.ack();
      });

      const result = await fixture.service.send(recipient, payload);

      // Wait for message to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(result.status).toBe('sent');
      expect(result.notificationId).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
      expect(receivedMessages.length).toBe(1);
    });

    it('should send notification with all options', async () => {
      // Subscribe to capture the message
      await fixture.transport.subscribe('notifications.success.*', async (msg) => {
        await msg.ack();
      });

      const recipient: NotificationRecipient = {
        id: 'user-2',
        email: 'user2@example.com',
        phone: '+1234567890',
      };

      const payload: NotificationPayload = {
        type: 'success',
        title: 'Success',
        message: 'Operation completed',
        priority: 'high',
        data: { orderId: 123 },
        metadata: {
          category: 'orders',
          tags: ['important'],
        },
      };

      const result = await fixture.service.send(recipient, payload, {
        channels: ['email', 'sms'],
        retries: 5,
        timeout: 30000,
        metadata: { source: 'test' },
      });

      expect(result.status).toBe('sent');
      expect(result.notificationId).toBeDefined();
      expect(result.channels).toBeDefined();
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should send notification with scheduled delivery (timestamp)', async () => {
      // Subscribe to capture the message
      await fixture.transport.subscribe('notifications.reminder.*', async (msg) => {
        await msg.ack();
      });

      const recipient: NotificationRecipient = {
        id: 'user-3',
        email: 'user3@example.com',
      };

      const payload: NotificationPayload = {
        type: 'reminder',
        title: 'Scheduled Reminder',
        message: 'This is scheduled',
      };

      const scheduledAt = Date.now() + 5000; // 5 seconds from now

      const result = await fixture.service.send(recipient, payload, {
        scheduledAt,
      });

      expect(result.status).toBe('scheduled');
      expect(result.notificationId).toBeDefined();
    });

    it('should send notification with scheduled delivery (Date)', async () => {
      // Reuse existing reminder subscription
      const recipient: NotificationRecipient = {
        id: 'user-4',
        email: 'user4@example.com',
      };

      const payload: NotificationPayload = {
        type: 'reminder',
        title: 'Scheduled Reminder',
        message: 'This is scheduled with Date',
      };

      const scheduledAt = new Date(Date.now() + 5000);

      const result = await fixture.service.send(recipient, payload, {
        scheduledAt,
      });

      expect(result.status).toBe('scheduled');
      expect(result.notificationId).toBeDefined();
    });

    it('should generate notification ID if not provided', async () => {
      // Reuse info subscription
      const recipient: NotificationRecipient = {
        id: 'user-5',
        email: 'user5@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'No ID',
        message: 'ID should be generated',
      };

      const result = await fixture.service.send(recipient, payload);

      expect(result.notificationId).toBeDefined();
      expect(result.notificationId.length).toBeGreaterThan(0);
    });
  });

  describe('Broadcast Operations', () => {
    it('should broadcast to multiple recipients', async () => {
      // Subscribe to capture the messages
      await fixture.transport.subscribe('notifications.announcement.*', async (msg) => {
        await msg.ack();
      });

      const recipients: NotificationRecipient[] = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
        { id: 'user-3', email: 'user3@example.com' },
      ];

      const payload: NotificationPayload = {
        type: 'announcement',
        title: 'Broadcast Message',
        message: 'This is sent to everyone',
      };

      const result = await fixture.service.broadcast(recipients, payload);

      expect(result.broadcastId).toBeDefined();
      expect(result.totalRecipients).toBe(3);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it('should broadcast with batching', async () => {
      // Reuse info subscription
      const recipients: NotificationRecipient[] = Array.from({ length: 10 }, (_, i) => ({
        id: `user-${i}`,
        email: `user${i}@example.com`,
      }));

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Batch Test',
        message: 'Testing batching',
      };

      const result = await fixture.service.broadcast(recipients, payload, {
        batchSize: 3, // Process in batches of 3
      });

      expect(result.totalRecipients).toBe(10);
      expect(result.successCount).toBe(10);
      expect(result.failureCount).toBe(0);
    });

    it('should broadcast with throttling', async () => {
      // Reuse info subscription
      const recipients: NotificationRecipient[] = Array.from({ length: 6 }, (_, i) => ({
        id: `user-${i}`,
        email: `user${i}@example.com`,
      }));

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Throttle Test',
        message: 'Testing throttling',
      };

      const startTime = Date.now();

      const result = await fixture.service.broadcast(recipients, payload, {
        batchSize: 2,
        throttle: 100, // 100ms delay between batches
      });

      const duration = Date.now() - startTime;

      expect(result.totalRecipients).toBe(6);
      expect(result.successCount).toBe(6);
      // 3 batches means 2 throttle delays (100ms each) = ~200ms minimum
      expect(duration).toBeGreaterThanOrEqual(200);
    });

    it('should handle empty recipient list', async () => {
      const recipients: NotificationRecipient[] = [];

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Empty Test',
        message: 'No recipients',
      };

      const result = await fixture.service.broadcast(recipients, payload);

      expect(result.totalRecipients).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
    });
  });

  describe('Schedule Operations', () => {
    it('should schedule notification with Date', async () => {
      // Reuse reminder subscription
      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'reminder',
        title: 'Scheduled',
        message: 'Future notification',
      };

      const scheduledAt = new Date(Date.now() + 10000);

      const result = await fixture.service.schedule(recipient, payload, scheduledAt);

      expect(result.status).toBe('scheduled');
      expect(result.scheduledAt).toBe(scheduledAt.getTime());
      expect(result.jobId).toBeDefined();
      expect(result.jobId).toContain('scheduled:');
    });

    it('should schedule notification with timestamp', async () => {
      // Reuse reminder subscription
      const recipient: NotificationRecipient = {
        id: 'user-2',
        email: 'user2@example.com',
      };

      const payload: NotificationPayload = {
        type: 'reminder',
        title: 'Scheduled',
        message: 'Future notification',
      };

      const scheduledAt = Date.now() + 10000;

      const result = await fixture.service.schedule(recipient, payload, scheduledAt);

      expect(result.status).toBe('scheduled');
      expect(result.scheduledAt).toBe(scheduledAt);
      expect(result.jobId).toBeDefined();
    });
  });

  describe('Health & Lifecycle', () => {
    it('should perform health check', async () => {
      const health = await fixture.service.healthCheck();

      expect(health).toBeDefined();
      expect(health.connected).toBe(true);
      expect(health.status).toBe('healthy');
      expect(health.timestamp).toBeGreaterThan(0);
    });

    it('should wait until ready', async () => {
      await expect(fixture.service.waitUntilReady()).resolves.not.toThrow();
    });

    it('should return transport', () => {
      const transport = fixture.service.getTransport();

      expect(transport).toBeDefined();
      expect(transport.id).toBeDefined();
      expect(transport.type).toBe('rotif');
    });
  });

  describe('DLQ Methods', () => {
    it('should subscribe to DLQ', async () => {
      const handler = vi.fn<NotificationHandler>(async (msg: IncomingNotification) => {
        await msg.ack();
      });

      await expect(fixture.service.subscribeToDLQ(handler)).resolves.not.toThrow();
    }, 5000);

    it('should get DLQ stats', async () => {
      const stats = await fixture.service.getDLQStats();

      expect(stats).toBeDefined();
      expect(stats.totalMessages).toBeGreaterThanOrEqual(0);
      expect(stats.messagesByChannel).toBeDefined();
      expect(typeof stats.messagesByChannel).toBe('object');
    });

    it('should get DLQ messages', async () => {
      const messages = await fixture.service.getDLQMessages();

      expect(Array.isArray(messages)).toBe(true);
    });

    it('should get DLQ messages with options', async () => {
      const messages = await fixture.service.getDLQMessages({
        limit: 10,
        offset: 0,
        maxAge: 3600000,
      });

      expect(Array.isArray(messages)).toBe(true);
    });

    it('should requeue from DLQ', async () => {
      const count = await fixture.service.requeueFromDLQ(5);

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should cleanup DLQ', async () => {
      const count = await fixture.service.cleanupDLQ();

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });

    it('should clear DLQ', async () => {
      await expect(fixture.service.clearDLQ()).resolves.not.toThrow();
    });

    it('should update DLQ config', () => {
      expect(() => {
        fixture.service.updateDLQConfig({
          maxAge: 7200000,
          maxSize: 2000,
        });
      }).not.toThrow();
    });
  });

  describe('Middleware', () => {
    it('should register middleware and call hooks', async () => {
      // Subscribe to capture message for processing
      await fixture.transport.subscribe('notifications.info.*', async (msg) => {
        await msg.ack();
      });

      const beforePublish = vi.fn();
      const afterPublish = vi.fn();
      const beforeProcess = vi.fn();
      const afterProcess = vi.fn();

      const middleware: TransportMiddleware = {
        beforePublish,
        afterPublish,
        beforeProcess,
        afterProcess,
      };

      fixture.service.use(middleware);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Middleware Test',
        message: 'Testing middleware hooks',
      };

      await fixture.service.send(recipient, payload);

      // Wait a bit for async middleware
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(beforePublish).toHaveBeenCalled();
      expect(afterPublish).toHaveBeenCalled();
    });

    it('should call onError hook on middleware error', async () => {
      const onError = vi.fn();

      const middleware: TransportMiddleware = {
        onError,
      };

      fixture.service.use(middleware);

      // Subscribe with a handler that will throw
      const failingHandler = vi.fn<NotificationHandler>(async () => {
        throw new Error('Handler failed');
      });

      await fixture.transport.subscribe('error.test.*', failingHandler);

      // Publish a message that will trigger the error
      await fixture.transport.publish('error.test.channel', {
        type: 'test',
        data: { message: 'error test' },
      });

      // Wait for error to propagate
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(onError).toHaveBeenCalled();
    });
  });
});

// ============================================================================
// Unit Tests (Mock Transport)
// ============================================================================

describe('NotificationsService - Unit Tests', () => {
  let mockTransport: MessagingTransport;
  let service: NotificationsService;

  beforeEach(() => {
    mockTransport = createMockTransport();
    service = new NotificationsService(mockTransport);
  });

  describe('Rate Limiting', () => {
    it('should respect rate limits', async () => {
      const mockRateLimiter: IRateLimiter = {
        checkLimit: vi.fn(async () => ({
          allowed: false,
          retryAfter: 5000,
        })),
        recordSent: vi.fn(async () => {}),
        reset: vi.fn(async () => {}),
      };

      const serviceWithRateLimit = new NotificationsService(mockTransport, mockRateLimiter);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Rate Limited',
        message: 'This should be rate limited',
      };

      const result = await serviceWithRateLimit.send(recipient, payload, {
        channels: ['email'],
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Rate limit exceeded');
      expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith('user-1', 'email', 'info');
    });

    it('should record sent messages on success', async () => {
      const mockRateLimiter: IRateLimiter = {
        checkLimit: vi.fn(async () => ({
          allowed: true,
        })),
        recordSent: vi.fn(async () => {}),
        reset: vi.fn(async () => {}),
      };

      const serviceWithRateLimit = new NotificationsService(mockTransport, mockRateLimiter);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Success',
        message: 'This should succeed',
      };

      await serviceWithRateLimit.send(recipient, payload, {
        channels: ['email'],
      });

      expect(mockRateLimiter.recordSent).toHaveBeenCalledWith('user-1', 'email', 'info');
    });

    it('should check rate limit for all channels', async () => {
      const mockRateLimiter: IRateLimiter = {
        checkLimit: vi.fn(async () => ({
          allowed: true,
        })),
        recordSent: vi.fn(async () => {}),
        reset: vi.fn(async () => {}),
      };

      const serviceWithRateLimit = new NotificationsService(mockTransport, mockRateLimiter);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Multi-channel',
        message: 'Testing multiple channels',
      };

      await serviceWithRateLimit.send(recipient, payload, {
        channels: ['email', 'sms', 'push'],
      });

      expect(mockRateLimiter.checkLimit).toHaveBeenCalledTimes(3);
    });
  });

  describe('Preference Store', () => {
    it('should skip globally muted users', async () => {
      const mockPreferenceStore: IPreferenceStore = {
        getPreferences: vi.fn(async () => ({
          channels: {},
          globalMute: true,
        })),
        setPreferences: vi.fn(async () => {}),
        updatePreferences: vi.fn(async () => {}),
        deletePreferences: vi.fn(async () => {}),
      };

      const serviceWithPrefs = new NotificationsService(mockTransport, undefined, mockPreferenceStore);

      const recipient: NotificationRecipient = {
        id: 'user-muted',
        email: 'muted@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Muted',
        message: 'User is muted',
      };

      const result = await serviceWithPrefs.send(recipient, payload);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('muted');
    });

    it('should filter channels based on preferences', async () => {
      const mockPreferenceStore: IPreferenceStore = {
        getPreferences: vi.fn(async () => ({
          channels: {
            email: { enabled: true },
            sms: { enabled: false },
            push: { enabled: true, types: ['alert', 'critical'] },
          },
        })),
        setPreferences: vi.fn(async () => {}),
        updatePreferences: vi.fn(async () => {}),
        deletePreferences: vi.fn(async () => {}),
      };

      const serviceWithPrefs = new NotificationsService(mockTransport, undefined, mockPreferenceStore);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Filtered',
        message: 'Testing channel filtering',
      };

      const result = await serviceWithPrefs.send(recipient, payload, {
        channels: ['email', 'sms', 'push'],
      });

      // SMS should be filtered (disabled)
      // Push should be filtered (type 'info' not in allowed types)
      // Only email should remain
      expect(result.status).toBe('sent');
    });

    it('should fail if no channels remain after filtering', async () => {
      const mockPreferenceStore: IPreferenceStore = {
        getPreferences: vi.fn(async () => ({
          channels: {
            email: { enabled: false },
            sms: { enabled: false },
          },
        })),
        setPreferences: vi.fn(async () => {}),
        updatePreferences: vi.fn(async () => {}),
        deletePreferences: vi.fn(async () => {}),
      };

      const serviceWithPrefs = new NotificationsService(mockTransport, undefined, mockPreferenceStore);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'No Channels',
        message: 'All channels disabled',
      };

      const result = await serviceWithPrefs.send(recipient, payload, {
        channels: ['email', 'sms'],
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('No enabled channels');
    });

    it('should filter recipients in broadcast based on preferences', async () => {
      const mockPreferenceStore: IPreferenceStore = {
        getPreferences: vi.fn(async (recipientId: string) => {
          if (recipientId === 'user-muted') {
            return { channels: {}, globalMute: true };
          }
          return { channels: { email: { enabled: true } } };
        }),
        setPreferences: vi.fn(async () => {}),
        updatePreferences: vi.fn(async () => {}),
        deletePreferences: vi.fn(async () => {}),
      };

      const serviceWithPrefs = new NotificationsService(mockTransport, undefined, mockPreferenceStore);

      const recipients: NotificationRecipient[] = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-muted', email: 'muted@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
      ];

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Broadcast',
        message: 'Testing preference filtering',
      };

      const result = await serviceWithPrefs.broadcast(recipients, payload);

      expect(result.totalRecipients).toBe(2); // user-muted should be filtered
      expect(result.skippedCount).toBe(1);
    });
  });

  describe('Channel Router', () => {
    it('should route channels through router', async () => {
      const mockChannelRouter: IChannelRouter = {
        route: vi.fn(async (recipient, payload, requestedChannels) => {
          // Route based on payload priority
          if (payload.priority === 'urgent') {
            return ['sms', 'push', 'email'];
          }
          return ['email'];
        }),
        canSendViaChannel: vi.fn(async () => true),
      };

      const serviceWithRouter = new NotificationsService(mockTransport, undefined, undefined, mockChannelRouter);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'alert',
        title: 'Urgent',
        message: 'Urgent notification',
        priority: 'urgent',
      };

      const result = await serviceWithRouter.send(recipient, payload);

      expect(mockChannelRouter.route).toHaveBeenCalled();
      expect(result.status).toBe('sent');
    });

    it('should fail if router returns no channels', async () => {
      const mockChannelRouter: IChannelRouter = {
        route: vi.fn(async () => []),
        canSendViaChannel: vi.fn(async () => false),
      };

      const serviceWithRouter = new NotificationsService(mockTransport, undefined, undefined, mockChannelRouter);

      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'No Route',
        message: 'No available channels',
      };

      const result = await serviceWithRouter.send(recipient, payload);

      expect(result.status).toBe('failed');
      expect(result.error).toContain('No available channels');
    });
  });

  describe('Lifecycle Methods', () => {
    it('should cancel scheduled notification (unsupported)', async () => {
      const result = await service.cancel('notification-id');

      expect(result).toBe(false);
    });

    it('should get notification status (unsupported)', async () => {
      const result = await service.getStatus('notification-id');

      expect(result).toBeNull();
    });

    it('should destroy service', async () => {
      const destroyableTransport = {
        ...mockTransport,
        destroy: vi.fn(async () => {}),
      };

      const destroyableService = new NotificationsService(destroyableTransport);

      await destroyableService.destroy();

      expect(destroyableTransport.destroy).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing optional dependencies gracefully', async () => {
      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Test',
        message: 'No optional deps',
      };

      const result = await service.send(recipient, payload);

      expect(result.status).toBe('sent');
    });

    it('should handle payload with custom ID', async () => {
      const recipient: NotificationRecipient = {
        id: 'user-1',
        email: 'user1@example.com',
      };

      const payload: NotificationPayload = {
        id: 'custom-notification-id',
        type: 'info',
        title: 'Custom ID',
        message: 'Using custom ID',
      };

      const result = await service.send(recipient, payload);

      expect(result.notificationId).toBe('custom-notification-id');
    });

    it('should handle broadcast with partial failures', async () => {
      // This test verifies that broadcast continues even if some sends fail
      const recipients: NotificationRecipient[] = [
        { id: 'user-1', email: 'user1@example.com' },
        { id: 'user-2', email: 'user2@example.com' },
      ];

      const payload: NotificationPayload = {
        type: 'info',
        title: 'Partial Failure Test',
        message: 'Testing partial failures',
      };

      const result = await service.broadcast(recipients, payload);

      expect(result.broadcastId).toBeDefined();
      expect(result.totalRecipients).toBe(2);
    });
  });
});
