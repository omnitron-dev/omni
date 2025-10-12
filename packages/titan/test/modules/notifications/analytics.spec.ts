/**
 * Comprehensive Tests for NotificationAnalytics
 * Tests metrics collection, statistics, and reporting
 */

import Redis from 'ioredis';
import { NotificationAnalytics } from '../../../src/modules/notifications/analytics.js';
import { RedisDockerTestHelper } from './test-redis-docker.js';
import type {
  NotificationEvent,
  NotificationStatistics,
  ReportPeriod,
} from '../../../src/modules/notifications/analytics.js';

describe('NotificationAnalytics', () => {
  let redis: Redis;
  let analytics: NotificationAnalytics;
  const TEST_PREFIX = `test:analytics:${Date.now()}`;

  beforeAll(async () => {
    // Start Redis container
    await RedisDockerTestHelper.startRedis();
    const clients = RedisDockerTestHelper.createClients();
    redis = clients.redis;

    // Clear test data
    await RedisDockerTestHelper.cleanup(redis, `notifications:analytics:*`);

    // Initialize analytics
    analytics = new NotificationAnalytics(redis, {
      enabled: true,
      storage: 'redis',
      retention: 30,
      realtime: true,
    });
  }, 30000);

  afterAll(async () => {
    try {
      await RedisDockerTestHelper.cleanup(redis, `notifications:analytics:*`);
      if (redis) await redis.quit();
    } finally {
      await RedisDockerTestHelper.stopRedis();
    }
  }, 30000);

  describe('Event Tracking', () => {
    it('should track notification sent event', async () => {
      const event: NotificationEvent = {
        id: 'event-1',
        type: 'sent',
        notificationId: 'notif-1',
        recipientId: 'user-1',
        channel: 'email',
        category: 'transactional',
        timestamp: Date.now(),
        metadata: {
          subject: 'Test Email',
        },
      };

      await analytics.track(event);

      // Query the event
      const events = await analytics.queryEvents({
        notificationId: 'notif-1',
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: 'event-1',
        type: 'sent',
        notificationId: 'notif-1',
      });
    });

    it('should track multiple event types', async () => {
      const notificationId = 'notif-2';
      const recipientId = 'user-2';
      const baseTime = Date.now();

      // Simulate notification lifecycle
      const events: NotificationEvent[] = [
        {
          id: 'evt-1',
          type: 'sent',
          notificationId,
          recipientId,
          channel: 'email',
          timestamp: baseTime,
        },
        {
          id: 'evt-2',
          type: 'delivered',
          notificationId,
          recipientId,
          channel: 'email',
          timestamp: baseTime + 1000,
        },
        {
          id: 'evt-3',
          type: 'opened',
          notificationId,
          recipientId,
          channel: 'email',
          timestamp: baseTime + 5000,
        },
        {
          id: 'evt-4',
          type: 'clicked',
          notificationId,
          recipientId,
          channel: 'email',
          timestamp: baseTime + 10000,
        },
      ];

      // Track all events
      for (const event of events) {
        await analytics.track(event);
      }

      // Query events
      const queriedEvents = await analytics.queryEvents({
        notificationId,
      });

      expect(queriedEvents).toHaveLength(4);
      expect(queriedEvents.map((e) => e.type)).toEqual(['sent', 'delivered', 'opened', 'clicked']);
    });

    it('should track events across multiple channels', async () => {
      const baseTime = Date.now();
      const channels = ['email', 'sms', 'push', 'inApp'];

      for (const channel of channels) {
        await analytics.track({
          id: `evt-${channel}`,
          type: 'sent',
          notificationId: `notif-${channel}`,
          recipientId: 'user-multi',
          channel,
          timestamp: baseTime,
        });
      }

      // Query by channel
      const emailEvents = await analytics.queryEvents({
        channel: 'email',
      });

      expect(emailEvents).toHaveLength(1);
      expect(emailEvents[0].channel).toBe('email');
    });

    it('should handle event metadata', async () => {
      const event: NotificationEvent = {
        id: 'meta-event',
        type: 'clicked',
        notificationId: 'meta-notif',
        recipientId: 'meta-user',
        channel: 'email',
        timestamp: Date.now(),
        metadata: {
          linkUrl: 'https://example.com/promo',
          buttonText: 'Learn More',
          campaignId: 'summer-2024',
        },
      };

      await analytics.track(event);

      const events = await analytics.queryEvents({
        notificationId: 'meta-notif',
      });

      expect(events[0].metadata).toEqual(event.metadata);
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Clear analytics data
      await RedisDockerTestHelper.cleanup(redis, `notifications:analytics:*`);
    });

    it('should query events by date range', async () => {
      const now = Date.now();
      const yesterday = now - 86400000;
      const tomorrow = now + 86400000;

      // Track events at different times
      await analytics.track({
        id: 'past-event',
        type: 'sent',
        notificationId: 'past-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: yesterday,
      });

      await analytics.track({
        id: 'current-event',
        type: 'sent',
        notificationId: 'current-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: now,
      });

      // Query events for today only
      const todayEvents = await analytics.queryEvents({
        startDate: now - 3600000, // Last hour
        endDate: tomorrow,
      });

      expect(todayEvents).toHaveLength(1);
      expect(todayEvents[0].id).toBe('current-event');
    });

    it('should query events by recipient', async () => {
      const recipients = ['user-1', 'user-2', 'user-3'];

      for (const recipientId of recipients) {
        await analytics.track({
          id: `evt-${recipientId}`,
          type: 'sent',
          notificationId: 'broadcast',
          recipientId,
          channel: 'email',
          timestamp: Date.now(),
        });
      }

      const user2Events = await analytics.queryEvents({
        recipientId: 'user-2',
      });

      expect(user2Events).toHaveLength(1);
      expect(user2Events[0].recipientId).toBe('user-2');
    });

    it('should query events by category', async () => {
      const categories = ['transactional', 'marketing', 'system'];

      for (const category of categories) {
        await analytics.track({
          id: `evt-${category}`,
          type: 'sent',
          notificationId: `notif-${category}`,
          recipientId: 'user',
          channel: 'email',
          category,
          timestamp: Date.now(),
        });
      }

      const marketingEvents = await analytics.queryEvents({
        category: 'marketing',
      });

      expect(marketingEvents).toHaveLength(1);
      expect(marketingEvents[0].category).toBe('marketing');
    });

    it('should apply query limit', async () => {
      // Track many events
      for (let i = 0; i < 20; i++) {
        await analytics.track({
          id: `evt-${i}`,
          type: 'sent',
          notificationId: `notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: Date.now() + i,
        });
      }

      const limitedEvents = await analytics.queryEvents({
        limit: 5,
      });

      expect(limitedEvents.length).toBeLessThanOrEqual(5);
    });
  });

  describe('Statistics Calculation', () => {
    beforeEach(async () => {
      await RedisDockerTestHelper.cleanup(redis, `notifications:analytics:*`);
    });

    it('should calculate basic statistics', async () => {
      const notificationId = 'stats-notif';
      const baseTime = Date.now();

      // Create a complete notification lifecycle
      await analytics.track({
        id: 'stat-1',
        type: 'sent',
        notificationId,
        recipientId: 'user-1',
        channel: 'email',
        timestamp: baseTime,
      });

      await analytics.track({
        id: 'stat-2',
        type: 'delivered',
        notificationId,
        recipientId: 'user-1',
        channel: 'email',
        timestamp: baseTime + 1000,
      });

      await analytics.track({
        id: 'stat-3',
        type: 'opened',
        notificationId,
        recipientId: 'user-1',
        channel: 'email',
        timestamp: baseTime + 5000,
      });

      const stats = await analytics.getStatistics({
        notificationId,
      });

      expect(stats.sent).toBe(1);
      expect(stats.delivered).toBe(1);
      expect(stats.opened).toBe(1);
      expect(stats.openRate).toBe(100); // 1 opened / 1 delivered
    });

    it('should calculate channel-specific statistics', async () => {
      const channels = [
        { name: 'email', sent: 10, delivered: 9, opened: 5, clicked: 2 },
        { name: 'sms', sent: 5, delivered: 5, opened: 0, clicked: 0 },
        { name: 'push', sent: 8, delivered: 7, opened: 4, clicked: 1 },
      ];

      // Track events for each channel
      for (const channel of channels) {
        for (let i = 0; i < channel.sent; i++) {
          await analytics.track({
            id: `${channel.name}-sent-${i}`,
            type: 'sent',
            notificationId: `notif-${i}`,
            recipientId: `user-${i}`,
            channel: channel.name,
            timestamp: Date.now(),
          });
        }

        for (let i = 0; i < channel.delivered; i++) {
          await analytics.track({
            id: `${channel.name}-delivered-${i}`,
            type: 'delivered',
            notificationId: `notif-${i}`,
            recipientId: `user-${i}`,
            channel: channel.name,
            timestamp: Date.now() + 1000,
          });
        }

        for (let i = 0; i < channel.opened; i++) {
          await analytics.track({
            id: `${channel.name}-opened-${i}`,
            type: 'opened',
            notificationId: `notif-${i}`,
            recipientId: `user-${i}`,
            channel: channel.name,
            timestamp: Date.now() + 5000,
          });
        }

        for (let i = 0; i < channel.clicked; i++) {
          await analytics.track({
            id: `${channel.name}-clicked-${i}`,
            type: 'clicked',
            notificationId: `notif-${i}`,
            recipientId: `user-${i}`,
            channel: channel.name,
            timestamp: Date.now() + 10000,
          });
        }
      }

      const stats = await analytics.getStatistics({});

      expect(stats.byChannel.size).toBe(3);

      const emailStats = stats.byChannel.get('email');
      expect(emailStats).toBeDefined();
      expect(emailStats?.sent).toBe(10);
      expect(emailStats?.delivered).toBe(9);
      expect(emailStats?.opened).toBe(5);
      expect(emailStats?.clicked).toBe(2);
    });

    it('should calculate time series data', async () => {
      const now = Date.now();
      const hourAgo = now - 3600000;
      const twoHoursAgo = now - 7200000;

      // Track events at different times
      await analytics.track({
        id: 'ts-1',
        type: 'sent',
        notificationId: 'ts-notif-1',
        recipientId: 'user',
        channel: 'email',
        timestamp: twoHoursAgo,
      });

      await analytics.track({
        id: 'ts-2',
        type: 'sent',
        notificationId: 'ts-notif-2',
        recipientId: 'user',
        channel: 'email',
        timestamp: hourAgo,
      });

      await analytics.track({
        id: 'ts-3',
        type: 'sent',
        notificationId: 'ts-notif-3',
        recipientId: 'user',
        channel: 'email',
        timestamp: now,
      });

      const stats = await analytics.getStatistics({
        startDate: twoHoursAgo,
        endDate: now,
      });

      expect(stats.timeSeries).toBeDefined();
      expect(stats.timeSeries?.length).toBeGreaterThan(0);
    });

    it('should handle empty statistics', async () => {
      const stats = await analytics.getStatistics({
        notificationId: 'non-existent',
      });

      expect(stats.sent).toBe(0);
      expect(stats.delivered).toBe(0);
      expect(stats.opened).toBe(0);
      expect(stats.openRate).toBe(0);
      expect(stats.clickRate).toBe(0);
    });
  });

  describe('Reporting', () => {
    beforeEach(async () => {
      await RedisDockerTestHelper.cleanup(redis, `notifications:analytics:*`);
    });

    it('should generate daily report', async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Track events for today
      for (let i = 0; i < 10; i++) {
        await analytics.track({
          id: `daily-${i}`,
          type: 'sent',
          notificationId: `notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: today.getTime() + i * 1000,
        });
      }

      for (let i = 0; i < 7; i++) {
        await analytics.track({
          id: `daily-del-${i}`,
          type: 'delivered',
          notificationId: `notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: today.getTime() + i * 2000,
        });
      }

      const period: ReportPeriod = {
        start: today,
        end: tomorrow,
        type: 'daily',
      };

      const report = await analytics.generateReport(period);

      expect(report.period).toEqual(period);
      expect(report.statistics.sent).toBe(10);
      expect(report.statistics.delivered).toBe(7);
      expect(report.statistics.successRate).toBe(70); // 7/10
    });

    it('should identify top performers', async () => {
      const notifications = [
        { id: 'top-1', sent: 100, opened: 80, clicked: 50 },
        { id: 'top-2', sent: 150, opened: 90, clicked: 30 },
        { id: 'top-3', sent: 50, opened: 10, clicked: 2 },
      ];

      for (const notif of notifications) {
        // Track sent events
        for (let i = 0; i < notif.sent; i++) {
          await analytics.track({
            id: `${notif.id}-sent-${i}`,
            type: 'sent',
            notificationId: notif.id,
            recipientId: `user-${i}`,
            channel: 'email',
            timestamp: Date.now(),
          });
        }

        // Track opened events
        for (let i = 0; i < notif.opened; i++) {
          await analytics.track({
            id: `${notif.id}-opened-${i}`,
            type: 'opened',
            notificationId: notif.id,
            recipientId: `user-${i}`,
            channel: 'email',
            timestamp: Date.now() + 1000,
          });
        }

        // Track clicked events
        for (let i = 0; i < notif.clicked; i++) {
          await analytics.track({
            id: `${notif.id}-clicked-${i}`,
            type: 'clicked',
            notificationId: notif.id,
            recipientId: `user-${i}`,
            channel: 'email',
            timestamp: Date.now() + 2000,
          });
        }
      }

      const report = await analytics.generateReport({
        start: new Date(Date.now() - 86400000),
        end: new Date(),
        type: 'daily',
      });

      expect(report.topPerformers).toBeDefined();
      expect(report.topPerformers?.length).toBeGreaterThan(0);

      // Check that top performer has highest open rate
      const topPerformer = report.topPerformers?.[0];
      expect(topPerformer?.notificationId).toBe('top-1'); // 80% open rate
    });

    it('should identify issues', async () => {
      // Create high bounce rate scenario
      for (let i = 0; i < 10; i++) {
        await analytics.track({
          id: `bounce-${i}`,
          type: 'sent',
          notificationId: `bounce-notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: Date.now(),
        });

        await analytics.track({
          id: `bounce-fail-${i}`,
          type: 'bounced',
          notificationId: `bounce-notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: Date.now() + 1000,
        });
      }

      const report = await analytics.generateReport({
        start: new Date(Date.now() - 86400000),
        end: new Date(),
        type: 'daily',
      });

      expect(report.issues).toBeDefined();
      expect(report.issues?.length).toBeGreaterThan(0);

      const bounceIssue = report.issues?.find((i) => i.type === 'high_bounce');
      expect(bounceIssue).toBeDefined();
    });

    it('should generate period comparison', async () => {
      const now = Date.now();
      const lastWeek = now - 7 * 86400000;
      const twoWeeksAgo = now - 14 * 86400000;

      // Track events for last week
      for (let i = 0; i < 100; i++) {
        await analytics.track({
          id: `last-week-${i}`,
          type: 'sent',
          notificationId: `notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: lastWeek + i * 1000,
        });
      }

      // Track events for two weeks ago
      for (let i = 0; i < 80; i++) {
        await analytics.track({
          id: `two-weeks-${i}`,
          type: 'sent',
          notificationId: `old-notif-${i}`,
          recipientId: 'user',
          channel: 'email',
          timestamp: twoWeeksAgo + i * 1000,
        });
      }

      const report = await analytics.generateReport(
        {
          start: new Date(lastWeek),
          end: new Date(now),
          type: 'weekly',
        },
        {
          comparison: true,
        }
      );

      expect(report.comparison).toBeDefined();
      expect(report.comparison?.current.sent).toBe(100);
      expect(report.comparison?.previous.sent).toBe(80);
      expect(report.comparison?.changes.sent).toBe(25); // 25% increase
    });
  });

  describe('Real-time Analytics', () => {
    it('should provide real-time event stream', async () => {
      const events: NotificationEvent[] = [];

      // Subscribe to real-time events
      const unsubscribe = await analytics.subscribeToEvents((event) => {
        events.push(event);
      });

      // Track some events
      await analytics.track({
        id: 'realtime-1',
        type: 'sent',
        notificationId: 'rt-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: Date.now(),
      });

      await analytics.track({
        id: 'realtime-2',
        type: 'delivered',
        notificationId: 'rt-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: Date.now() + 1000,
      });

      // Wait for events to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(events).toHaveLength(2);
      expect(events[0].id).toBe('realtime-1');
      expect(events[1].id).toBe('realtime-2');

      // Cleanup
      unsubscribe();
    });

    it('should provide real-time statistics updates', async () => {
      let latestStats: NotificationStatistics | null = null;

      // Subscribe to stats updates
      const unsubscribe = await analytics.subscribeToStats((stats) => {
        latestStats = stats;
      });

      // Track events
      await analytics.track({
        id: 'rt-stat-1',
        type: 'sent',
        notificationId: 'rt-stat-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: Date.now(),
      });

      // Wait for stats update
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(latestStats).toBeDefined();
      expect(latestStats?.sent).toBeGreaterThan(0);

      // Cleanup
      unsubscribe();
    });
  });

  describe('Data Retention', () => {
    it('should respect retention policy', async () => {
      const oldTimestamp = Date.now() - 100 * 86400000; // 100 days ago

      // Track old event
      await analytics.track({
        id: 'old-event',
        type: 'sent',
        notificationId: 'old-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: oldTimestamp,
      });

      // Trigger cleanup
      await analytics.cleanup();

      // Try to query old event
      const events = await analytics.queryEvents({
        startDate: oldTimestamp - 86400000,
        endDate: oldTimestamp + 86400000,
      });

      expect(events).toHaveLength(0); // Should be deleted
    });

    it('should keep recent data', async () => {
      const recentTimestamp = Date.now() - 5 * 86400000; // 5 days ago

      // Track recent event
      await analytics.track({
        id: 'recent-event',
        type: 'sent',
        notificationId: 'recent-notif',
        recipientId: 'user',
        channel: 'email',
        timestamp: recentTimestamp,
      });

      // Trigger cleanup
      await analytics.cleanup();

      // Query recent event
      const events = await analytics.queryEvents({
        startDate: recentTimestamp - 86400000,
        endDate: Date.now(),
      });

      expect(events).toHaveLength(1); // Should still exist
      expect(events[0].id).toBe('recent-event');
    });
  });
});
