/**
 * Tests for NotificationsHealthIndicator
 */
import { describe, it, expect } from 'vitest';
import { NotificationsHealthIndicator } from '../src/notifications.health.js';
import type {
  MessagingTransport,
  TransportHealth,
  NotificationMessage,
  TransportPublishResult,
  TransportPublishOptions,
  NotificationHandler,
  TransportSubscribeOptions,
  NotificationSubscription,
  TransportMiddleware,
  SubscriptionStats,
} from '../src/transport/transport.interface.js';

describe('NotificationsHealthIndicator', () => {
  describe('check()', () => {
    it('should return healthy status when transport is connected', async () => {
      const mockTransport = createMockTransport({
        status: 'healthy',
        connected: true,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.status).toBe('healthy');
      expect(result.message).toBe('Notifications system is fully operational');
      expect(result.transport.connected).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should return unhealthy when transport is disconnected', async () => {
      const mockTransport = createMockTransport({
        status: 'unhealthy',
        connected: false,
        error: 'Connection lost',
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Connection lost');
      expect(result.transport.connected).toBe(false);
      expect(result.transport.error).toBe('Connection lost');
    });

    it('should return degraded status when transport is degraded', async () => {
      const mockTransport = createMockTransport({
        status: 'degraded',
        connected: true,
        latency: 500,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.status).toBe('degraded');
      expect(result.message).toBe('Notifications system is operational but experiencing issues');
      expect(result.transport.status).toBe('degraded');
      expect(result.transport.latency).toBe(500);
    });

    it('should include transport health info', async () => {
      const mockDetails = { pendingMessages: 5, activeConnections: 3 };
      const mockTransport = createMockTransport({
        status: 'healthy',
        connected: true,
        latency: 10,
        details: mockDetails,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.transport.latency).toBe(10);
      expect(result.transport.details).toEqual(mockDetails);
    });

    it('should measure health check latency', async () => {
      const mockTransport = createMockTransport(
        {
          status: 'healthy',
          connected: true,
          timestamp: Date.now(),
        },
        50 // Simulate 50ms delay
      );
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.latency).toBeGreaterThanOrEqual(50);
      expect(result.latency).toBeLessThan(100); // Some tolerance
    });

    it('should handle transport healthCheck errors gracefully', async () => {
      const mockTransport = createFailingMockTransport(new Error('Transport error'));
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Transport error');
      expect(result.transport.status).toBe('unhealthy');
      expect(result.transport.connected).toBe(false);
      expect(result.transport.error).toBe('Transport error');
    });

    it('should handle non-Error exceptions', async () => {
      const mockTransport = createFailingMockTransport('String error');
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.check();

      expect(result.status).toBe('unhealthy');
      expect(result.message).toBe('Unknown error during health check');
      expect(result.transport.error).toBe('String error');
    });
  });

  describe('isAlive()', () => {
    it('should return true when healthy', async () => {
      const mockTransport = createMockTransport({
        status: 'healthy',
        connected: true,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isAlive();

      expect(result).toBe(true);
    });

    it('should return true when degraded', async () => {
      const mockTransport = createMockTransport({
        status: 'degraded',
        connected: true,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isAlive();

      expect(result).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      const mockTransport = createMockTransport({
        status: 'unhealthy',
        connected: false,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isAlive();

      expect(result).toBe(false);
    });

    it('should return false on check errors', async () => {
      const mockTransport = createFailingMockTransport(new Error('Check failed'));
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isAlive();

      expect(result).toBe(false);
    });
  });

  describe('isReady()', () => {
    it('should return true when healthy and connected', async () => {
      const mockTransport = createMockTransport({
        status: 'healthy',
        connected: true,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isReady();

      expect(result).toBe(true);
    });

    it('should return false when degraded', async () => {
      const mockTransport = createMockTransport({
        status: 'degraded',
        connected: true,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isReady();

      expect(result).toBe(false);
    });

    it('should return false when unhealthy', async () => {
      const mockTransport = createMockTransport({
        status: 'unhealthy',
        connected: false,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isReady();

      expect(result).toBe(false);
    });

    it('should return false when healthy but disconnected', async () => {
      const mockTransport = createMockTransport({
        status: 'healthy',
        connected: false,
        timestamp: Date.now(),
      });
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isReady();

      expect(result).toBe(false);
    });

    it('should return false on check errors', async () => {
      const mockTransport = createFailingMockTransport(new Error('Check failed'));
      const health = new NotificationsHealthIndicator(mockTransport);

      const result = await health.isReady();

      expect(result).toBe(false);
    });
  });
});

/**
 * Create a mock transport with controllable health status
 */
function createMockTransport(healthStatus: TransportHealth, delayMs: number = 0): MessagingTransport {
  return {
    id: 'mock-transport',
    type: 'mock',

    async publish(
      channel: string,
      message: NotificationMessage,
      options?: TransportPublishOptions
    ): Promise<TransportPublishResult> {
      return {
        success: true,
        status: 'published',
        messageIds: ['mock-id'],
        patternCount: 1,
        timestamp: Date.now(),
      };
    },

    async subscribe(
      pattern: string,
      handler: NotificationHandler,
      options?: TransportSubscribeOptions
    ): Promise<NotificationSubscription> {
      return {
        id: 'sub-1',
        pattern,
        group: 'default',
        isPaused: false,
        async unsubscribe() {},
        pause() {},
        resume() {},
        stats(): SubscriptionStats {
          return { messages: 0, retries: 0 };
        },
      };
    },

    async healthCheck(): Promise<TransportHealth> {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return healthStatus;
    },

    async shutdown(): Promise<void> {},

    use(middleware: TransportMiddleware): void {},
  };
}

/**
 * Create a mock transport that throws errors
 */
function createFailingMockTransport(error: unknown): MessagingTransport {
  return {
    id: 'failing-transport',
    type: 'mock',

    async publish(
      channel: string,
      message: NotificationMessage,
      options?: TransportPublishOptions
    ): Promise<TransportPublishResult> {
      throw error;
    },

    async subscribe(
      pattern: string,
      handler: NotificationHandler,
      options?: TransportSubscribeOptions
    ): Promise<NotificationSubscription> {
      throw error;
    },

    async healthCheck(): Promise<TransportHealth> {
      throw error;
    },

    async shutdown(): Promise<void> {
      throw error;
    },

    use(middleware: TransportMiddleware): void {
      throw error;
    },
  };
}
