import { v4 as uuidv4 } from 'uuid';
import { Redis, RedisOptions } from 'ioredis';
import { delay as delayMs } from '@devgrid/common';

import { StatsTracker } from './stats';
import { parseFields } from './utils/common';
import { defaultLogger } from './utils/logger';
import { createPubSubSubscription } from './pubsub';
import { DedupStore, RedisDedupStore } from './exactly-once';
import { Middleware, MiddlewareManager } from './middleware';
import { defaultGroupName, defaultConsumerName } from './options';
import { trimStream, getStreamKey, ensureStreamGroup } from './stream-utils';
import { RotifConfig, RotifLogger, RotifMessage, Subscription, PublishOptions, SubscribeOptions } from './types';

/**
 * Main class for managing message queues and subscriptions.
 * Provides functionality for publishing messages, subscribing to channels,
 * managing delayed messages, and handling message processing.
 * @class NotificationManager
 */
export class NotificationManager {
  /** Redis client instance */
  public redis: Redis;
  /** Configuration options */
  public config: RotifConfig;
  /** Logger instance */
  private logger: RotifLogger;
  /** Middleware manager */
  private middleware = new MiddlewareManager();
  /** Active subscriptions */
  private subscriptions: Map<string, Subscription> = new Map();
  /** Whether the manager is active */
  private active: boolean = true;
  /** Deduplication store for exactly-once processing */
  private dedupStore?: DedupStore;
  /** Timeout ID for delayed message scheduler */
  private delayTimeoutId?: NodeJS.Timeout;
  /** Set of active operations for graceful shutdown */
  private activeOperations: Set<Promise<any>> = new Set();

  /**
   * Creates a new NotificationManager instance.
   * @param {RotifConfig} config - Configuration options
   */
  constructor(config: RotifConfig) {
    this.config = config;
    this.logger = config.logger || defaultLogger;
    this.redis = new Redis(config.redis as RedisOptions);

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error', err);
    });
    if (this.config.enableDelayed !== false) {
      setImmediate(() => this.startDelayScheduler());
    }
  }

  /**
   * Tracks an operation for graceful shutdown.
   * @private
   * @param {Promise<T>} promise - Promise to track
   * @returns {Promise<T>} The original promise
   */
  private async trackOperation<T>(promise: Promise<T>): Promise<T> {
    this.activeOperations.add(promise);
    try {
      return await promise;
    } finally {
      this.activeOperations.delete(promise);
    }
  }

  /**
   * Adds middleware to the manager.
   * @param {Middleware} mw - Middleware to add
   */
  use(mw: Middleware) {
    this.middleware.use(mw);
  }

  /**
   * Publishes a message to a channel.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {PublishOptions} [options] - Publishing options
   * @returns {Promise<string>} Message ID
   */
  async publish(channel: string, payload: any, options?: PublishOptions): Promise<string> {
    return this.trackOperation(this._publish(channel, payload, options));
  }

  /**
   * Internal publish implementation.
   * @private
   */
  private async _publish(channel: string, payload: any, options?: PublishOptions): Promise<string> {
    await this.middleware.runBeforePublish(channel, payload, options);

    const streamKey = getStreamKey(channel);
    const message = {
      channel,
      payload: JSON.stringify(payload),
      timestamp: Date.now().toString(),
      attempt: String(options?.attempt ?? 1),
    };

    if (options?.delayMs || options?.deliverAt) {
      const score = options.deliverAt ? new Date(options.deliverAt).getTime() : Date.now() + (options.delayMs || 0);
      const scheduled = {
        ...message,
        due: score.toString(),
      };
      await this.redis.zadd('rotif:scheduled', score, JSON.stringify(scheduled));
      this.logger.debug('Scheduled message', scheduled);
      await this.middleware.runAfterPublish(channel, payload, 'SCHEDULED', options);
      return 'SCHEDULED';
    }

    const id = await this.redis.xadd(
      streamKey,
      '*',
      'channel', message.channel,
      'payload', message.payload,
      'timestamp', message.timestamp,
      'attempt', message.attempt
    );
    if (!id) throw new Error('XADD failed: no ID returned');
    await trimStream(this.redis, streamKey, this.config.maxStreamLength, this.config.minStreamId);
    this.logger.debug('Published message', { id, ...message });
    await this.middleware.runAfterPublish(channel, payload, id, options);
    return id;
  }

  /**
   * Subscribes to messages on a channel pattern.
   * @param {string} pattern - Channel pattern
   * @param {(msg: RotifMessage) => Promise<void>} handler - Message handler
   * @param {SubscribeOptions} [options] - Subscription options
   * @returns {Promise<Subscription>} Subscription instance
   */
  async subscribe(pattern: string, handler: (msg: RotifMessage) => Promise<void>, options?: SubscribeOptions): Promise<Subscription> {
    return this.trackOperation(this._subscribe(pattern, handler, options));
  }

  /**
   * Internal subscribe implementation.
   * @private
   */
  private async _subscribe(pattern: string, handler: (msg: RotifMessage) => Promise<void>, options?: SubscribeOptions): Promise<Subscription> {
    if (options?.usePubSub) {
      const sub = createPubSubSubscription(this.redis, pattern, handler, this.logger);
      this.subscriptions.set(sub.id, sub);
      return sub;
    }

    const streamKey = getStreamKey(pattern.replace('*', ''));
    const group = options?.groupName || this.config.groupNameFn?.(pattern) || defaultGroupName(pattern);
    const consumer = options?.consumerName || this.config.consumerNameFn?.() || defaultConsumerName();

    await ensureStreamGroup(this.redis, streamKey, group, options?.startFrom || '$');

    const stats = new StatsTracker();
    const subId = uuidv4();
    const sub: Subscription = {
      id: subId,
      pattern,
      group,
      unsubscribe: async () => {
        this.subscriptions.delete(subId);
      },
      pause: () => {
        (sub as any).paused = true;
      },
      resume: () => {
        (sub as any).paused = false;
      },
      isPaused: false,
      stats: () => stats.getStats(),
    };

    (sub as any).paused = false;

    this.subscriptions.set(subId, sub);
    if (options?.exactlyOnce && !this.dedupStore) {
      this.dedupStore = new RedisDedupStore(this.redis);
    }
    this.processStream(streamKey, group, consumer, async (msg) => {
      if (options?.exactlyOnce && this.dedupStore) {
        const isDup = await this.dedupStore.isDuplicate(msg.id, msg.channel);
        if (isDup) {
          this.logger.debug(`Skipping duplicate message ${msg.id} on ${msg.channel}`);
          await msg.ack();
          return;
        }
        await handler(msg);
        await this.dedupStore.markProcessed(msg.id, msg.channel);
      } else {
        await handler(msg);
      }
    }, sub, options, stats);
    return sub;
  }

  /**
   * Processes messages from a stream.
   * @private
   */
  private async processStream(
    streamKey: string,
    group: string,
    consumer: string,
    handler: (msg: RotifMessage) => Promise<void>,
    sub: Subscription,
    options?: SubscribeOptions,
    stats?: StatsTracker
  ) {
    while (this.active) {
      if ((sub as any).paused) {
        await delayMs(1000);
        continue;
      }

      const entries = await this.trackOperation(this.redis.xreadgroup(
        'GROUP', group, consumer,
        'COUNT', 10,
        'BLOCK', this.config.blockInterval || 5000,
        'STREAMS', streamKey, '>'
      ) as Promise<[string, [string, string[]][]][] | null>);

      if (!entries) continue;

      for (const [, records] of entries) {
        for (const [id, rawFields] of records) {
          const fields = parseFields(rawFields);

          const channel = fields['channel'] ?? '';
          const payloadStr = fields['payload'] ?? '{}';
          const timestampStr = fields['timestamp'] ?? '0';
          const attemptStr = fields['attempt'] ?? '1';

          const attempt = parseInt(attemptStr, 10);

          const msg: RotifMessage = {
            id,
            channel,
            payload: JSON.parse(payloadStr),
            timestamp: parseInt(timestampStr, 10),
            attempt,
            ack: async () => {
              await this.trackOperation(this.redis.xack(streamKey, group, id));
            },
            retry: async () => {
              await this.trackOperation(this.redis.xack(streamKey, group, id));
              if (!this.active) return;
              const delay = typeof options?.retryDelay === 'function'
                ? options.retryDelay(attempt, msg)
                : options?.retryDelay || 1000;
              await this.trackOperation(this.redis.zadd(
                'rotif:scheduled',
                Date.now() + delay,
                JSON.stringify({
                  channel,
                  payload: payloadStr,
                  timestamp: timestampStr,
                  attempt: (attempt + 1).toString(),
                })
              ));
            }
          };

          try {
            await this.middleware.runBeforeProcess(msg);
            await handler(msg);
            stats?.recordMessage();
            await msg.ack();
            await this.middleware.runAfterProcess(msg);
          } catch (err) {
            this.logger.warn(`Handler error on message ${id}`, err);
            stats?.recordRetry();
            await this.middleware.runOnError(msg, err as Error);
            if (attempt >= (options?.maxRetries || this.config.maxRetries || 5)) {
              await this.trackOperation(this.redis.xack(streamKey, group, id));
              console.log('moving to DLQ', channel, payloadStr);
              await this.trackOperation(this.redis.xadd(
                'rotif:dlq',
                '*',
                'channel', channel,
                'payload', payloadStr,
                'error', (err as Error).message || 'unknown'
              ));
              this.logger.error(`Message ${id} moved to DLQ`);
              stats?.recordFailure();
            } else {
              await msg.retry();
            }
          }
        }
      }
    }
  }

  /**
   * Starts the delayed message scheduler.
   * @private
   */
  private async startDelayScheduler() {
    const scheduler = async () => {
      if (!this.active) return;
      const startTime = Date.now();
      try {
        const messages = await this.trackOperation(this.redis.zrangebyscore('rotif:scheduled', 0, startTime, 'LIMIT', 0, 10));
        for (const msg of messages) {
          const parsed = JSON.parse(msg);
          await this.publish(parsed.channel, JSON.parse(parsed.payload), {
            attempt: parseInt(parsed.attempt || '1', 10),
          });
          await this.trackOperation(this.redis.zrem('rotif:scheduled', msg));
          await this.redis.zrem('rotif:scheduled', msg);
        }
      } catch (err) {
        this.logger.error('DelayScheduler error', err);
      } finally {
        const executionTime = Date.now() - startTime;
        const nextDelay = Math.max(10, (this.config.checkDelayInterval || 1000) - executionTime);
        this.delayTimeoutId = setTimeout(scheduler, nextDelay);
      }
    };
    this.delayTimeoutId = setTimeout(scheduler, this.config.checkDelayInterval || 1000);
  }

  /**
   * Stops all subscriptions and cleans up resources.
   */
  async stopAll() {
    this.logger.info('Stopping all subscriptions');
    this.active = false;
    for (const sub of this.subscriptions.values()) {
      await sub.unsubscribe();
    }
    if (this.delayTimeoutId) {
      clearTimeout(this.delayTimeoutId);
    }

    while (this.activeOperations.size > 0) {
      await delayMs(100);
    }

    await this.redis.quit();
  }

  /**
   * Subscribes to the Dead Letter Queue.
   * @param {(msg: RotifMessage) => Promise<void>} handler - DLQ message handler
   */
  async subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>) {
    return this.trackOperation(this._subscribeToDLQ(handler));
  }

  /**
   * Internal DLQ subscription implementation.
   * @private
   */
  private async _subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>) {
    const streamKey = 'rotif:dlq';
    const group = 'dlq-group';
    const consumer = 'dlq-worker';

    try {
      await this.redis.xgroup('CREATE', streamKey, group, '0', 'MKSTREAM');
    } catch (err: any) {
      if (!err?.message?.includes('BUSYGROUP')) throw err;
    }

    this.logger.info('[DLQ] Subscribed to DLQ stream');

    while (this.active) {
      try {
        const entries = await this.redis.xreadgroup(
          'GROUP', group, consumer,
          'COUNT', 10,
          'BLOCK', this.config.blockInterval || 5000,
          'STREAMS', streamKey, '>'
        ) as [string, [string, string[]][]][] | null;

        if (!entries) continue;

        for (const [, records] of entries) {
          for (const [id, rawFields] of records) {
            const fields = parseFields(rawFields);
            const channel = fields['channel'] ?? 'unknown';
            const payloadStr = fields['payload'] ?? '{}';
            const timestamp = Date.now();

            const msg: RotifMessage = {
              id,
              channel,
              payload: JSON.parse(payloadStr),
              timestamp,
              attempt: parseInt(fields['attempt'] || '1', 10),
              ack: async () => { await this.redis.xack(streamKey, group, id); },
              retry: async () => { }
            };

            try {
              await handler(msg);
              await msg.ack();
            } catch (err) {
              this.logger.error(`[DLQ] Handler failed on ${id}:`, err);
            }
          }
        }
      } catch (err) {
        this.logger.error('[DLQ] Processing error', err);
      }
    }
  }

  /**
   * Requeues messages from DLQ back to their original streams.
   * @param {number} [count=10] - Maximum number of messages to requeue
   */
  async requeueFromDLQ(count = 10) {
    return this.trackOperation(this._requeueFromDLQ(count));
  }

  /**
   * Internal DLQ requeue implementation.
   * @private
   */
  private async _requeueFromDLQ(count = 10) {
    const entries = await this.redis.xrange('rotif:dlq', '-', '+', 'COUNT', count);
    for (const [id, fields] of entries) {
      const channel = fields['channel'];
      const payloadStr = fields['payload'];

      if (!channel || !payloadStr) continue;
      await this.redis.xadd(`rotif:stream:${channel.split('.')[0]}`, '*',
        'channel', channel,
        'payload', payloadStr,
        'timestamp', Date.now().toString(),
        'attempt', '1'
      );
      await this.redis.xdel('rotif:dlq', id);
    }
  }
}