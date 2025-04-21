import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';

import { RotifMessage, Subscription } from './types';

/**
 * Creates a Redis pub/sub subscription.
 * Uses Redis pub/sub mechanism instead of streams for message delivery.
 * @param {Redis} redis - Redis client
 * @param {string} pattern - Channel pattern to subscribe to
 * @param {(msg: RotifMessage) => Promise<void>} handler - Message handler
 * @param {Object} logger - Logger implementation
 * @param {Function} logger.info - Info logging function
 * @param {Function} logger.error - Error logging function
 * @param {Function} logger.warn - Warning logging function
 * @param {Function} logger.debug - Debug logging function
 * @returns {Subscription} Subscription instance
 */
export function createPubSubSubscription(
  redis: Redis,
  pattern: string,
  handler: (msg: RotifMessage) => Promise<void>,
  logger: {
    info: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
    warn: (msg: string, meta?: any) => void;
    debug: (msg: string, meta?: any) => void;
  }
): Subscription {
  const subId = uuidv4();
  let isPaused = false;
  let active = true;

  /**
   * Handles incoming messages.
   * @private
   * @param {string} channel - Channel name
   * @param {string} message - Raw message string
   */
  const onMessage = async (channel: string, message: string) => {
    if (!active || isPaused) return;
    try {
      const parsed = JSON.parse(message);
      const rotifMessage: RotifMessage = {
        id: uuidv4(),
        channel,
        payload: parsed.payload,
        timestamp: parsed.timestamp || Date.now(),
        attempt: 1,
        ack: async () => { },
        retry: async () => { },
      };
      await handler(rotifMessage);
    } catch (err) {
      logger.warn(`PubSub handler error for ${channel}`, err);
    }
  };

  redis.psubscribe(pattern, (err, count) => {
    if (err) logger.error('PSUBSCRIBE error', err);
    else logger.info(`Subscribed to pattern ${pattern} (pubsub)`);
  });

  redis.on('pmessage', (_pattern, channel, message) => {
    if (channel.match(pattern.replace('*', '.*'))) {
      onMessage(channel, message);
    }
  });

  return {
    id: subId,
    pattern,
    group: 'pubsub',
    isPaused: false,
    pause: () => { isPaused = true; },
    resume: () => { isPaused = false; },
    unsubscribe: async () => {
      active = false;
      await redis.punsubscribe(pattern);
    },
    stats: () => ({ messages: 0, retries: 0 }),
  };
}
