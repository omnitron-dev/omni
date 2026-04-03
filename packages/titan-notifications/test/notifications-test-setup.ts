/**
 * Notifications Test Setup
 *
 * Provides helper functions for running Notifications tests with Docker Redis
 */

import { DockerTestManager, type DockerContainer } from '@omnitron-dev/testing/docker';
import { NotificationManager } from '../src/rotif/rotif.js';
import { RotifTransport } from '../src/transport/rotif.transport.js';
import { NotificationsService } from '../src/notifications.service.js';
import { NotificationsHealthIndicator } from '../src/notifications.health.js';
import type { MessagingTransport } from '../src/transport/transport.interface.js';
import Redis from 'ioredis';

// Check if Docker tests should be skipped
const SKIP_DOCKER_TESTS = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
const NOTIFICATIONS_TEST_TIMEOUT = 60000;

export interface NotificationsTestFixture {
  container: DockerContainer;
  redisUrl: string;
  redisPort: number;
  redis: Redis;
  manager: NotificationManager;
  transport: RotifTransport;
  service: NotificationsService;
  health: NotificationsHealthIndicator;
  cleanup: () => Promise<void>;
}

/**
 * Creates a complete Notifications test fixture with Docker Redis
 */
export async function createNotificationsTestFixture(): Promise<NotificationsTestFixture> {
  // Create Redis container
  const dockerManager = DockerTestManager.getInstance();

  // Remove existing container if it exists
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('docker', ['rm', '-f', 'test-redis-notifications'], { stdio: 'ignore' });
  } catch {
    // Ignore
  }

  const container = await dockerManager.createContainer({
    name: 'test-redis-notifications',
    image: 'redis:7-alpine',
    ports: { 6379: 'auto' },
    healthcheck: {
      test: ['CMD', 'redis-cli', 'ping'],
      interval: '1s',
      timeout: '3s',
      retries: 10,
      startPeriod: '2s',
    },
    waitFor: {
      healthcheck: true,
      timeout: 30000,
    },
  });

  const redisPort = container.ports.get(6379)!;
  const redisUrl = `redis://localhost:${redisPort}`;

  // Create Redis client
  const redis = new Redis(redisUrl);

  // Wait for Redis to be ready
  await waitForRedis(redis);

  // Create NotificationManager
  const manager = new NotificationManager({
    redis: redisUrl,
    maxRetries: 3,
    deduplicationTTL: 60,
  });

  await manager.waitUntilReady();

  // Create transport
  const transport = new RotifTransport(manager);

  // Create service (without optional dependencies for simplicity)
  const service = new NotificationsService(transport);

  // Create health indicator
  const health = new NotificationsHealthIndicator(transport);

  const cleanup = async () => {
    try {
      await manager.destroy();
    } catch {}
    try {
      redis.disconnect();
    } catch {}
    try {
      await container.cleanup();
    } catch {}
  };

  return {
    container,
    redisUrl,
    redisPort,
    redis,
    manager,
    transport,
    service,
    health,
    cleanup,
  };
}

/**
 * Run a test with Notifications fixture and auto-cleanup
 */
export async function withNotificationsFixture<T>(
  testFn: (fixture: NotificationsTestFixture) => Promise<T>
): Promise<T> {
  const fixture = await createNotificationsTestFixture();
  try {
    return await testFn(fixture);
  } finally {
    await fixture.cleanup();
  }
}

/**
 * Wait for Redis to be ready
 */
async function waitForRedis(redis: Redis, maxRetries = 10): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const pong = await redis.ping();
      if (pong === 'PONG') return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('Redis not ready after retries');
}

/**
 * Check if we should skip Docker tests
 */
export function shouldSkipDockerTests(): boolean {
  return SKIP_DOCKER_TESTS;
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('docker', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper to create a mock transport for unit tests
 */
export function createMockTransport(): MessagingTransport {
  const subscriptions = new Map<string, any>();
  let healthStatus = { status: 'connected' as const, connected: true };

  return {
    id: 'mock-transport',
    type: 'mock',

    async publish(channel, message, options) {
      return {
        success: true,
        status: 'published' as const,
        messageIds: [message.id || 'mock-id'],
        timestamp: Date.now(),
      };
    },

    async subscribe(pattern, handler, options) {
      const id = `sub-${Date.now()}`;
      const subscription = {
        id,
        pattern,
        group: options?.groupName || 'default',
        isPaused: false,
        unsubscribe: async () => {
          subscriptions.delete(id);
        },
        pause: () => {
          subscription.isPaused = true;
        },
        resume: () => {
          subscription.isPaused = false;
        },
        stats: () => ({ messages: 0, retries: 0 }),
      };
      subscriptions.set(id, subscription);
      return subscription;
    },

    async healthCheck() {
      return healthStatus;
    },

    async shutdown() {
      subscriptions.clear();
    },

    use(middleware) {},
  };
}

export { SKIP_DOCKER_TESTS, NOTIFICATIONS_TEST_TIMEOUT };
