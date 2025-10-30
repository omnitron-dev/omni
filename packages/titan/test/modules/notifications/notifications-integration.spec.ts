import 'reflect-metadata';
import { Redis } from 'ioredis';
import { Container } from '../../../src/nexus/index.js';
import { TitanNotificationsModule } from '../../../src/modules/notifications/notifications.module.js';
import {
  NOTIFICATION_SERVICE,
  PREFERENCE_MANAGER,
  RATE_LIMITER,
  CHANNEL_MANAGER,
} from '../../../src/modules/notifications/constants.js';
import type { PreferenceManager } from '../../../src/modules/notifications/preference-manager.js';
import type { RateLimiter } from '../../../src/modules/notifications/rate-limiter.js';
import type { ChannelManager } from '../../../src/modules/notifications/channel-manager.js';
import { InAppChannel, EmailChannel } from '../../../src/modules/notifications/channel-manager.js';
import { getTestRedisConfig } from '../../utils/redis-test-utils.js';

describe('Notifications Module Integration', () => {
  let redis: Redis;
  let container: Container;

  beforeAll(async () => {
    // Setup Redis connection with dynamic port
    const redisConfig = getTestRedisConfig(1);
    redis = new Redis({
      host: redisConfig.host,
      port: redisConfig.port,
      db: redisConfig.db,
    });

    // Clean Redis
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis.quit();
  });

  describe('Module Initialization', () => {
    it('should create module with default configuration', () => {
      const redisConfig = getTestRedisConfig(1);
      const module = TitanNotificationsModule.forRoot({
        redis: {
          host: redisConfig.host,
          port: redisConfig.port,
          db: redisConfig.db,
        },
      });

      expect(module).toBeDefined();
      expect(module.module).toBe(TitanNotificationsModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toBeDefined();
    });

    it('should create module with async configuration', () => {
      const redisConfig = getTestRedisConfig(1);
      const module = TitanNotificationsModule.forRootAsync({
        useFactory: () => ({
          redis: {
            host: redisConfig.host,
            port: redisConfig.port,
            db: redisConfig.db,
          },
        }),
      });

      expect(module).toBeDefined();
      expect(module.module).toBe(TitanNotificationsModule);
    });

    it('should export correct providers', () => {
      const module = TitanNotificationsModule.forRoot();

      const exports = module.exports || [];
      expect(exports).toContain(NOTIFICATION_SERVICE);
      expect(exports).toContain(CHANNEL_MANAGER);
      expect(exports).toContain(PREFERENCE_MANAGER);
      expect(exports).toContain(RATE_LIMITER);
    });
  });

  describe('Service Functionality', () => {
    let preferenceManager: PreferenceManager;
    let rateLimiter: RateLimiter;
    let channelManager: ChannelManager;

    beforeEach(async () => {
      await redis.flushdb();

      // Create services directly for testing
      const { PreferenceManager } = await import('../../../src/modules/notifications/preference-manager.js');
      const { RateLimiter } = await import('../../../src/modules/notifications/rate-limiter.js');
      const { ChannelManager } = await import('../../../src/modules/notifications/channel-manager.js');

      preferenceManager = new PreferenceManager(redis);
      rateLimiter = new RateLimiter(redis);
      channelManager = new ChannelManager();
    });

    describe('PreferenceManager', () => {
      it('should get default preferences', async () => {
        const prefs = await preferenceManager.getPreferences('user-1');

        expect(prefs).toBeDefined();
        expect(prefs.enabled).toBe(true);
        expect(prefs.channels).toBeDefined();
      });

      it('should update user preferences', async () => {
        const updated = await preferenceManager.updatePreferences('user-1', {
          enabled: false,
          channels: {
            email: { enabled: false },
          },
        });

        expect(updated.enabled).toBe(false);
        expect(updated.channels.email?.enabled).toBe(false);

        // Verify persistence
        const retrieved = await preferenceManager.getPreferences('user-1');
        expect(retrieved.enabled).toBe(false);
      });

      it('should check if notification should be sent', async () => {
        // Disable notifications for user
        await preferenceManager.updatePreferences('user-2', {
          enabled: false,
        });

        const shouldSend = await preferenceManager.shouldSendNotification(
          'user-2',
          {
            type: 'info',
            title: 'Test',
            body: 'Message',
          },
          'email'
        );

        expect(shouldSend).toBe(false);
      });

      it('should respect quiet hours', async () => {
        const now = new Date();
        const startHour = (now.getHours() - 1 + 24) % 24;
        const endHour = (now.getHours() + 1) % 24;

        await preferenceManager.updatePreferences('user-3', {
          quietHours: {
            enabled: true,
            start: `${startHour.toString().padStart(2, '0')}:00`,
            end: `${endHour.toString().padStart(2, '0')}:00`,
            timezone: 'UTC',
          },
        });

        const shouldSend = await preferenceManager.shouldSendNotification(
          'user-3',
          {
            type: 'info',
            title: 'Test',
            body: 'Non-urgent message',
          },
          'email'
        );

        expect(shouldSend).toBe(false);

        // Urgent messages should go through
        const shouldSendUrgent = await preferenceManager.shouldSendNotification(
          'user-3',
          {
            type: 'critical',
            title: 'Urgent',
            body: 'Urgent message',
            metadata: {
              priority: 'urgent',
            },
          },
          'email'
        );

        expect(shouldSendUrgent).toBe(true);
      });
    });

    describe('RateLimiter', () => {
      it('should allow requests within limits', async () => {
        const allowed = await rateLimiter.checkLimit('user-1', 'test');
        expect(allowed).toBe(true);
      });

      it('should enforce rate limits', async () => {
        const customLimits = {
          perMinute: 3,
          burstLimit: 2,
        };

        let allowedCount = 0;
        for (let i = 0; i < 5; i++) {
          const allowed = await rateLimiter.checkLimit('user-2', 'test', customLimits);
          if (allowed) allowedCount++;
        }

        expect(allowedCount).toBeLessThanOrEqual(3);
      });

      it('should get rate limit status', async () => {
        const status = await rateLimiter.getStatus('user-3', 'test');

        expect(status).toBeDefined();
        expect(status.minute).toBeDefined();
        expect(status.minute?.allowed).toBe(true);
        expect(status.minute?.remaining).toBeGreaterThan(0);
      });

      it('should reset rate limits', async () => {
        // Hit the limit
        const customLimits = { perMinute: 1 };
        await rateLimiter.checkLimit('user-4', 'test', customLimits);
        const secondAttempt = await rateLimiter.checkLimit('user-4', 'test', customLimits);
        expect(secondAttempt).toBe(false);

        // Reset
        await rateLimiter.reset('user-4', 'test');

        // Should be allowed again
        const afterReset = await rateLimiter.checkLimit('user-4', 'test', customLimits);
        expect(afterReset).toBe(true);
      });
    });

    describe('ChannelManager', () => {
      it('should have default channels registered', () => {
        // Channel manager should have at least InApp channel by default
        const channels = channelManager['channels'];
        expect(channels.size).toBeGreaterThan(0);
        expect(channels.has('inApp')).toBe(true);
      });

      it('should plan delivery for recipients', async () => {
        const recipients = [
          { id: 'user-1', email: 'user1@example.com' },
          { id: 'user-2', email: 'user2@example.com' },
        ];

        const notification = {
          type: 'info' as const,
          title: 'Test',
          body: 'Message',
        };

        const plan = await channelManager.planDelivery(recipients, notification, {});

        expect(plan).toBeDefined();
        expect(plan.size).toBeGreaterThan(0);
      });

      it('should validate recipients for channels', () => {
        const emailChannel = new EmailChannel();

        expect(emailChannel.validateRecipient({ id: 'user-1', email: 'valid@email.com' })).toBe(true);
        expect(emailChannel.validateRecipient({ id: 'user-2', email: 'invalid-email' })).toBe(false);
        expect(emailChannel.validateRecipient({ id: 'user-3' })).toBe(false);
      });

      it('should format content for channels', () => {
        const inAppChannel = new InAppChannel();

        const content = inAppChannel.formatContent({
          type: 'info',
          title: 'Test Title',
          body: 'Test Body',
          data: { custom: 'data' },
        });

        expect(content.subject).toBe('Test Title');
        expect(content.text).toBe('Test Body');
        expect(content.data).toEqual({ custom: 'data' });
      });
    });
  });
});
