import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import Redis from 'ioredis';
import { Container } from '../../../src/nexus/index.js';
import { NotificationService, NotificationPayload, Recipient } from '../../../src/modules/notifications/index.js';
import { NotificationManager } from '../../../src/rotif/rotif.js';
import {
  ChannelManager,
  EmailChannel,
  SMSChannel,
  InAppChannel,
  ChannelType,
} from '../../../src/modules/notifications/channel-manager.js';
import { PreferenceManager } from '../../../src/modules/notifications/preference-manager.js';
import { RateLimiter } from '../../../src/modules/notifications/rate-limiter.js';
import { TemplateEngine } from '../../../src/modules/notifications/template-engine.js';
import { WorkflowEngine } from '../../../src/modules/notifications/workflow-engine.js';
import { NotificationAnalytics } from '../../../src/modules/notifications/analytics.js';
import { getTestRedisConfig } from '../../utils/redis-test-utils.js';

// Only run these tests if INTEGRATION_TESTS env var is set
const runIntegrationTests = process.env.INTEGRATION_TESTS === 'true' || process.env.CI === 'true';

const testDescribe = runIntegrationTests ? describe : describe.skip;

testDescribe('Notifications Integration Tests', () => {
  let redis: Redis;
  let container: Container;
  let notificationService: NotificationService;
  let channelManager: ChannelManager;
  let preferenceManager: PreferenceManager;
  let rateLimiter: RateLimiter;
  let templateEngine: TemplateEngine;
  let workflowEngine: WorkflowEngine;
  let analytics: NotificationAnalytics;
  let rotifManager: NotificationManager;

  const TEST_PREFIX = 'test:notifications:';

  beforeAll(async () => {
    // Connect to Redis with dynamic port
    const redisConfig = getTestRedisConfig(15);
    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db,
      retryStrategy: () => null, // Don't retry on connection failure
    });

    await redis.ping();
    console.log('Connected to Redis for integration tests');
  });

  afterAll(async () => {
    if (redis) {
      await redis.quit();
    }
  });

  beforeEach(async () => {
    container = new Container();

    // Clean up test data
    const keys = await redis.keys(`${TEST_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    // Initialize real services
    rotifManager = new NotificationManager({
      redis,
      prefix: TEST_PREFIX,
    });

    channelManager = new ChannelManager();
    channelManager.addChannel(new InAppChannel());
    channelManager.addChannel(
      new EmailChannel({
        transport: {
          send: async (options: any) => {
            // Mock email sending for tests
            console.log('Mock email sent:', options);
            return { messageId: 'test-msg-id' };
          },
        },
      })
    );
    channelManager.addChannel(
      new SMSChannel({
        client: {
          messages: {
            create: async (options: any) => {
              // Mock SMS sending for tests
              console.log('Mock SMS sent:', options);
              return { sid: 'test-sms-id' };
            },
          },
        },
      })
    );

    preferenceManager = new PreferenceManager({ redis, keyPrefix: TEST_PREFIX });
    rateLimiter = new RateLimiter({ redis, keyPrefix: TEST_PREFIX });
    templateEngine = new TemplateEngine();
    workflowEngine = new WorkflowEngine({ redis, keyPrefix: TEST_PREFIX });
    analytics = new NotificationAnalytics({ redis, keyPrefix: TEST_PREFIX });

    notificationService = new NotificationService(rotifManager, channelManager, preferenceManager, rateLimiter);

    // Register container services
    container.register('redis', { useValue: redis });
    container.register('notificationService', { useValue: notificationService });
    container.register('channelManager', { useValue: channelManager });
    container.register('preferenceManager', { useValue: preferenceManager });
    container.register('rateLimiter', { useValue: rateLimiter });
    container.register('templateEngine', { useValue: templateEngine });
    container.register('workflowEngine', { useValue: workflowEngine });
    container.register('analytics', { useValue: analytics });
  });

  afterEach(async () => {
    // Clean up test data
    const keys = await redis.keys(`${TEST_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  describe('NotificationService with Real Redis', () => {
    it('should send notification and track in Redis', async () => {
      const payload: NotificationPayload = {
        id: 'test-notif-1',
        type: 'info',
        title: 'Integration Test',
        body: 'Testing with real Redis',
        metadata: {
          category: 'test',
          tags: ['integration', 'redis'],
        },
      };

      const recipient: Recipient = {
        id: 'test-user-1',
        email: 'test@example.com',
      };

      const result = await notificationService.send(payload, recipient);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.sent).toBeGreaterThan(0);

      // Verify notification was stored in Redis
      const storedKey = `${TEST_PREFIX}notification:${result.id}`;
      const stored = await redis.get(storedKey);
      expect(stored).toBeDefined();
    });

    it('should handle deduplication using Redis', async () => {
      const payload: NotificationPayload = {
        type: 'warning',
        title: 'Dedupe Test',
        body: 'Should only send once',
        metadata: {
          deduplicationKey: 'dedupe-test-123',
        },
      };

      const recipient: Recipient = {
        id: 'test-user-2',
        email: 'test2@example.com',
      };

      const options = {
        exactlyOnce: true,
        deduplicationTTL: 5000, // 5 seconds
      };

      // First send
      const result1 = await notificationService.send(payload, recipient, options);
      expect(result1.sent).toBeGreaterThan(0);

      // Duplicate send - should be filtered
      const result2 = await notificationService.send(payload, recipient, options);
      expect(result2.filtered).toBeGreaterThan(0);
      expect(result2.sent).toBe(0);

      // Wait for TTL and send again
      await new Promise((resolve) => setTimeout(resolve, 5100));
      const result3 = await notificationService.send(payload, recipient, options);
      expect(result3.sent).toBeGreaterThan(0);
    }, 10000); // Increase timeout for this test
  });

  describe('PreferenceManager with Real Redis', () => {
    it('should store and retrieve user preferences', async () => {
      const userId = 'test-user-3';
      const preferences = {
        userId,
        channels: {
          email: { enabled: true, frequency: 'immediate' },
          sms: { enabled: false },
          'in-app': { enabled: true, frequency: 'daily' },
        },
        categories: {
          marketing: { enabled: false },
          system: { enabled: true },
          security: { enabled: true },
        },
        quietHours: {
          enabled: true,
          start: '22:00',
          end: '08:00',
          timezone: 'America/New_York',
        },
      };

      await preferenceManager.setUserPreferences(userId, preferences);
      const retrieved = await preferenceManager.getUserPreferences(userId);

      expect(retrieved).toMatchObject(preferences);
    });

    it('should check if notification can be sent based on preferences', async () => {
      const userId = 'test-user-4';
      await preferenceManager.setUserPreferences(userId, {
        userId,
        channels: {
          email: { enabled: true },
          sms: { enabled: false },
        },
        categories: {
          marketing: { enabled: false },
          updates: { enabled: true },
        },
      });

      // Should allow email for updates category
      const canSendEmail = await preferenceManager.canSend(userId, 'email', 'updates');
      expect(canSendEmail).toBe(true);

      // Should not allow SMS
      const canSendSMS = await preferenceManager.canSend(userId, 'sms', 'updates');
      expect(canSendSMS).toBe(false);

      // Should not allow marketing
      const canSendMarketing = await preferenceManager.canSend(userId, 'email', 'marketing');
      expect(canSendMarketing).toBe(false);
    });
  });

  describe('RateLimiter with Real Redis', () => {
    it('should enforce rate limits', async () => {
      const key = 'test-user-5';
      const config = {
        maxRequests: 3,
        windowMs: 1000, // 1 second
      };

      // Should allow first 3 requests
      for (let i = 0; i < 3; i++) {
        const result = await rateLimiter.checkLimit(key, config);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(2 - i);
      }

      // Should deny 4th request
      const result = await rateLimiter.checkLimit(key, config);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetAt).toBeGreaterThan(Date.now());

      // Wait for window to reset
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Should allow again after reset
      const resultAfterReset = await rateLimiter.checkLimit(key, config);
      expect(resultAfterReset.allowed).toBe(true);
    }, 5000);

    it('should track different limits per key', async () => {
      const config = {
        maxRequests: 2,
        windowMs: 1000,
      };

      const result1 = await rateLimiter.checkLimit('user-a', config);
      const result2 = await rateLimiter.checkLimit('user-b', config);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);

      // Use up user-a's limit
      await rateLimiter.checkLimit('user-a', config);
      const result3 = await rateLimiter.checkLimit('user-a', config);
      expect(result3.allowed).toBe(false);

      // user-b should still have capacity
      const result4 = await rateLimiter.checkLimit('user-b', config);
      expect(result4.allowed).toBe(true);
    });
  });

  describe('NotificationAnalytics with Real Redis', () => {
    it('should track notification events', async () => {
      const notificationId = 'test-notif-analytics-1';

      // Track sent event
      await analytics.trackEvent({
        notificationId,
        recipientId: 'test-user-6',
        event: 'sent',
        channel: 'email',
        timestamp: Date.now(),
      });

      // Track delivered event
      await analytics.trackEvent({
        notificationId,
        recipientId: 'test-user-6',
        event: 'delivered',
        channel: 'email',
        timestamp: Date.now() + 1000,
      });

      // Track opened event
      await analytics.trackEvent({
        notificationId,
        recipientId: 'test-user-6',
        event: 'opened',
        channel: 'email',
        timestamp: Date.now() + 5000,
      });

      // Get statistics
      const stats = await analytics.getStatistics({
        startDate: new Date(Date.now() - 10000),
        endDate: new Date(),
      });

      expect(stats.totalSent).toBeGreaterThan(0);
      expect(stats.totalDelivered).toBeGreaterThan(0);
      expect(stats.totalOpened).toBeGreaterThan(0);
    });

    it('should generate reports', async () => {
      // Track multiple events
      const events = [
        { notificationId: 'n1', event: 'sent', channel: 'email' },
        { notificationId: 'n1', event: 'delivered', channel: 'email' },
        { notificationId: 'n2', event: 'sent', channel: 'sms' },
        { notificationId: 'n2', event: 'failed', channel: 'sms' },
        { notificationId: 'n3', event: 'sent', channel: 'push' },
        { notificationId: 'n3', event: 'delivered', channel: 'push' },
        { notificationId: 'n3', event: 'opened', channel: 'push' },
      ];

      for (const event of events) {
        await analytics.trackEvent({
          ...event,
          recipientId: 'test-user-7',
          timestamp: Date.now(),
        });
      }

      const report = await analytics.generateReport({
        period: 'day',
        startDate: new Date(Date.now() - 86400000),
        endDate: new Date(),
      });

      expect(report).toBeDefined();
      expect(report.summary.totalSent).toBe(3);
      expect(report.summary.totalDelivered).toBe(2);
      expect(report.summary.totalFailed).toBe(1);
      expect(report.summary.totalOpened).toBe(1);
      expect(report.channelBreakdown).toBeDefined();
    });
  });

  describe('WorkflowEngine with Real Redis', () => {
    it('should execute notification workflow', async () => {
      const workflow = {
        id: 'welcome-workflow',
        name: 'Welcome Email Workflow',
        triggers: [
          {
            type: 'event' as const,
            event: 'user.signup',
          },
        ],
        steps: [
          {
            id: 'step1',
            name: 'Send Welcome Email',
            type: 'notification' as const,
            notification: {
              type: 'info' as const,
              title: 'Welcome!',
              body: 'Welcome to our platform!',
            },
            channels: ['email'],
          },
          {
            id: 'step2',
            name: 'Wait 1 Day',
            type: 'delay' as const,
            delay: 86400000, // 1 day in ms
          },
          {
            id: 'step3',
            name: 'Send Follow-up',
            type: 'notification' as const,
            notification: {
              type: 'info' as const,
              title: 'How are you doing?',
              body: "We hope you're enjoying the platform!",
            },
            channels: ['email'],
          },
        ],
      };

      await workflowEngine.registerWorkflow(workflow);

      const instance = await workflowEngine.startWorkflow(workflow.id, {
        userId: 'test-user-8',
        email: 'newuser@example.com',
      });

      expect(instance).toBeDefined();
      expect(instance.workflowId).toBe(workflow.id);
      expect(instance.status).toBe('running');
      expect(instance.currentStep).toBe(0);

      // Verify workflow is stored in Redis
      const storedInstance = await workflowEngine.getWorkflowInstance(instance.id);
      expect(storedInstance).toBeDefined();
      expect(storedInstance.workflowId).toBe(workflow.id);
    });

    it('should handle conditional workflow steps', async () => {
      const workflow = {
        id: 'conditional-workflow',
        name: 'Conditional Notification',
        triggers: [
          {
            type: 'manual' as const,
          },
        ],
        steps: [
          {
            id: 'check-premium',
            name: 'Check Premium Status',
            type: 'condition' as const,
            condition: {
              type: 'expression' as const,
              expression: 'context.isPremium === true',
            },
            onTrue: 'premium-notification',
            onFalse: 'regular-notification',
          },
          {
            id: 'premium-notification',
            name: 'Premium Notification',
            type: 'notification' as const,
            notification: {
              type: 'info' as const,
              title: 'Premium Feature',
              body: 'Exclusive content for premium users!',
            },
            channels: ['email', 'push'],
          },
          {
            id: 'regular-notification',
            name: 'Regular Notification',
            type: 'notification' as const,
            notification: {
              type: 'info' as const,
              title: 'Upgrade to Premium',
              body: 'Unlock exclusive features!',
            },
            channels: ['email'],
          },
        ],
      };

      await workflowEngine.registerWorkflow(workflow);

      // Test with premium user
      const premiumInstance = await workflowEngine.startWorkflow(workflow.id, {
        userId: 'premium-user',
        isPremium: true,
      });

      expect(premiumInstance.currentStep).toBeDefined();

      // Test with regular user
      const regularInstance = await workflowEngine.startWorkflow(workflow.id, {
        userId: 'regular-user',
        isPremium: false,
      });

      expect(regularInstance.currentStep).toBeDefined();
    });
  });

  describe('Full Integration Flow', () => {
    it('should handle complete notification flow with all components', async () => {
      // Set user preferences
      const userId = 'integration-test-user';
      await preferenceManager.setUserPreferences(userId, {
        userId,
        channels: {
          email: { enabled: true },
          sms: { enabled: true },
          'in-app': { enabled: true },
        },
        categories: {
          updates: { enabled: true },
        },
      });

      // Create template
      await templateEngine.registerTemplate({
        id: 'update-template',
        name: 'Product Update',
        subject: 'New features in {{product}}',
        body: 'Hi {{userName}}, check out the new features in {{product}}!',
        channels: ['email', 'in-app'],
        variables: [
          { name: 'userName', type: 'string', required: true },
          { name: 'product', type: 'string', required: true },
        ],
      });

      // Send notification using template
      const payload: NotificationPayload = {
        type: 'info',
        title: 'Product Update',
        body: 'Check out our new features!',
        metadata: {
          category: 'updates',
        },
        data: {
          userName: 'John Doe',
          product: 'Titan Framework',
        },
      };

      const recipient: Recipient = {
        id: userId,
        email: 'john@example.com',
        phone: '+1234567890',
      };

      const result = await notificationService.send(payload, recipient, {
        channels: [ChannelType.EMAIL, ChannelType.IN_APP],
        templateId: 'update-template',
      });

      expect(result.sent).toBeGreaterThan(0);
      expect(result.failed).toBe(0);

      // Track analytics
      await analytics.trackEvent({
        notificationId: result.id,
        recipientId: userId,
        event: 'sent',
        channel: 'email',
        timestamp: Date.now(),
      });

      // Verify rate limiting is working
      const rateLimitCheck = await rateLimiter.checkLimit(userId, {
        maxRequests: 10,
        windowMs: 60000,
      });
      expect(rateLimitCheck.allowed).toBe(true);
      expect(rateLimitCheck.remaining).toBeLessThan(10);
    });
  });
});
