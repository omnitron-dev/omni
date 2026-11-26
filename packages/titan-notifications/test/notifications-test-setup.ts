import { NotificationManager } from '../src/rotif/rotif.js';
import { RotifTransport } from '../src/transport/rotif.transport.js';
import { NotificationsService } from '../src/notifications.service.js';
import type { MessagingTransport } from '../src/transport/transport.interface.js';
import { getTestRedisUrl } from './rotif/helpers/test-utils.js';

export async function createNotificationsTestFixture() {
  const manager = new NotificationManager({ redis: getTestRedisUrl(0), maxRetries: 3,
    deduplicationTTL: 60, blockInterval: 50, checkDelayInterval: 50 });
  try {
    await manager.waitUntilReady();
    const transport = new RotifTransport(manager);
    const service = new NotificationsService(transport);
    return { service, transport };
  } catch (error) {
    await manager.destroy();
    throw error;
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
