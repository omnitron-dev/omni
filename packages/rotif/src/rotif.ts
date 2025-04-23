import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch'
import { Redis, RedisOptions } from 'ioredis';
import { defer, Deferred, delay as delayMs } from '@devgrid/common';

import { StatsTracker } from './stats';
import { DedupStore } from './exactly-once';
import { parseFields } from './utils/common';
import { defaultLogger } from './utils/logger';
import { getLoopKey, getStreamKey } from './stream-utils';
import { Middleware, MiddlewareManager } from './middleware';
import { defaultGroupName, defaultConsumerName } from './options';
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
  private activePatterns = new Set<string>();
  private initializationDefer: Deferred;
  private subClient?: Redis;
  private consumerLoops = new Map<string, { loopPromise: Promise<void>; subscriptions: Set<Subscription> }>();

  private publishScriptSHA?: string;
  private moveScheduledScriptSHA?: string;
  private ackScriptSHA?: string;
  private retryScriptSHA?: string;
  private moveToDLQScriptSHA?: string;
  private safeUnsubSHA?: string;

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

    this.redis.on('reconnecting', (time) => {
      this.logger.info(`Redis reconnecting in ${time}ms...`);
    });

    this.redis.on('connect', () => {
      this.syncPatterns();
      this.logger.info('Redis successfully connected');
    });

    this.initializationDefer = defer();

    this.loadLuaScripts().then(() => {
      if (this.config.enableDelayed !== false) {
        setImmediate(() => {
          this.startDelayScheduler();
        });
      }
      this.initializationDefer.resolve?.(true);
    });
    this.subscribeToPatternUpdates();
  }

  async loadLuaScripts() {
    this.publishScriptSHA = await this.redis.script(
      'LOAD',
      fs.readFileSync(path.join(__dirname, '..', 'lua', 'publish-message.lua'), 'utf-8')
    ) as string;

    this.moveScheduledScriptSHA = await this.redis.script(
      'LOAD',
      fs.readFileSync(path.join(__dirname, '..', 'lua', 'move-scheduled-messages.lua'), 'utf-8')
    ) as string;

    this.ackScriptSHA = await this.redis.script(
      'LOAD',
      fs.readFileSync(path.join(__dirname, '..', 'lua', 'ack-message.lua'), 'utf-8')
    ) as string;

    this.retryScriptSHA = await this.redis.script(
      'LOAD',
      fs.readFileSync(path.join(__dirname, '..', 'lua', 'retry-message.lua'), 'utf-8')
    ) as string;

    this.moveToDLQScriptSHA = await this.redis.script(
      'LOAD',
      fs.readFileSync(path.join(__dirname, '..', 'lua', 'move-to-dlq.lua'), 'utf-8')
    ) as string;

    this.safeUnsubSHA = await this.redis.script(
      'LOAD',
      fs.readFileSync(path.join(__dirname, '..', 'lua', 'safe-unsubscribe.lua'), 'utf-8')
    ) as string;

    this.logger.info('Lua scripts loaded');
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
  async publish(channel: string, payload: any, options?: PublishOptions): Promise<string[] | string | null> {
    await this.initializationDefer.promise;
    await this.middleware.runBeforePublish(channel, payload, options);

    const matchingPatterns = Array.from(this.activePatterns).filter(pattern =>
      minimatch(channel, pattern)
    );

    if (matchingPatterns.length === 0) {
      this.logger.debug(`No active patterns match channel ${channel}, skipping publish.`);
      return null;
    }

    const timestamp = Date.now().toString();
    const attempt = String(options?.attempt ?? 1);
    const deliveryType = options?.delayMs || options?.deliverAt ? 'delayed' : 'normal';
    const delayTimestamp = options?.deliverAt
      ? new Date(options.deliverAt).getTime().toString()
      : options?.delayMs
        ? (Date.now() + options.delayMs).toString()
        : '0';

    const maxStreamLength = this.config.maxStreamLength ? String(this.config.maxStreamLength) : '0';
    const minStreamId = this.config.minStreamId ?? '';

    const dedupKey = options?.exactlyOnce
      ? `rotif:dedup:${channel}:${this.generateDedupId(payload)}`
      : '';

    const deduplicationTTL = options?.deduplicationTTL ?? this.config.deduplicationTTL ?? 3600;

    const results: string[] = [];

    for (const pattern of matchingPatterns) {
      const streamKey = getStreamKey(pattern);
      try {
        const result = await this.redis.evalsha(
          this.publishScriptSHA!,
          2,
          streamKey,
          'rotif:scheduled',
          JSON.stringify(payload),
          timestamp,
          channel,
          attempt,
          deliveryType,
          delayTimestamp,
          maxStreamLength,
          minStreamId,
          dedupKey,
          deduplicationTTL.toString(),
          uuidv4(),
        );

        if (result === 'DUPLICATE') {
          this.logger.warn(`Duplicate message detected: ${dedupKey}`);
        } else {
          results.push(result as string);
        }
      } catch (err) {
        this.logger.error(`Error publishing to ${streamKey}`, err);
        await this.middleware.runOnError({ channel, payload, attempt: +attempt, id: '', timestamp: +timestamp, ack: async () => { } }, err as Error);
      }
    }

    if (results.length === 0) {
      return 'DUPLICATE';
    }

    this.logger.debug(`Published message to ${results.length} active streams`, { channel });

    await this.middleware.runAfterPublish(channel, payload, results as string[], options);

    return results.length === 1 ? results[0] as string : results as string[];
  }

  /**
   * Subscribes to messages on a channel pattern.
   * @param {string} pattern - Channel pattern
   * @param {(msg: RotifMessage) => Promise<void>} handler - Message handler
   * @param {SubscribeOptions} [options] - Subscription options
   * @returns {Promise<Subscription>} Subscription instance
   */
  async subscribe(pattern: string, handler: (msg: RotifMessage) => Promise<void>, options?: SubscribeOptions): Promise<Subscription> {
    await this.initializationDefer.promise;
    const group = options?.groupName ?? defaultGroupName(pattern);
    const consumer = this.config.consumerNameFn?.() || defaultConsumerName();
    const stream = getStreamKey(pattern);
    const retryStream = `${stream}:retry`;

    const subId = uuidv4();
    const stats = new StatsTracker();

    await this.ensureStreamGroup(stream, group);
    await this.ensureStreamGroup(retryStream, group);

    const sub: Subscription = {
      id: subId,
      pattern,
      group,
      options,
      handler,
      unsubscribe: async (removePattern = false) => {
        sub.isPaused = true;
        this.subscriptions.delete(subId);

        const loopKey = getLoopKey(stream, group);
        const retryLoopKey = getLoopKey(retryStream, group);

        const loop = this.consumerLoops.get(loopKey);
        loop?.subscriptions.delete(sub);
        if (loop && loop.subscriptions.size === 0) {
          this.consumerLoops.delete(loopKey);
        }

        const retryLoop = this.consumerLoops.get(retryLoopKey);
        retryLoop?.subscriptions.delete(sub);
        if (retryLoop && retryLoop.subscriptions.size === 0) {
          this.consumerLoops.delete(retryLoopKey);
        }

        if (removePattern) {
          const newCount = await this.redis.evalsha(
            this.safeUnsubSHA!,
            1,
            'rotif:patterns',
            pattern
          );

          if (Number(newCount) === 0) {
            await this.redis.publish('rotif:subscriptions:updates', `remove:${pattern}`);
            this.logger.info(`Unsubscribed from pattern (no more subscribers): ${pattern}`);
          }
        }
      },
      pause: () => { sub.isPaused = true; },
      resume: () => { sub.isPaused = false; },
      isPaused: false,
      stats: () => stats.getStats(),
    };

    const mainLoopSubscriptions = await this.startSharedConsumerLoop(stream, group, consumer);
    mainLoopSubscriptions.add(sub);

    const retryLoopSubscriptions = await this.startSharedConsumerLoop(retryStream, group, consumer);
    retryLoopSubscriptions.add(sub);

    const newCount = await this.redis.zincrby('rotif:patterns', 1, pattern);
    if (Number(newCount) === 1) {
      await this.redis.publish('rotif:subscriptions:updates', `add:${pattern}`);
      this.logger.info(`Subscribed to new pattern: ${pattern}`);
    }

    this.subscriptions.set(subId, sub);

    return sub;
  }

  /**
   * Starts the delayed message scheduler.
   * @private
   */
  private async startDelayScheduler() {
    const scheduler = async () => {
      if (!this.active) return;
      try {
        const movedMessagesCount = await this.redis.evalsha(
          this.moveScheduledScriptSHA!,
          1,
          'rotif:scheduled',
          Date.now().toString(),
          String(this.config.scheduledBatchSize ?? 1000)
        );

        this.logger.debug(`Moved ${movedMessagesCount} scheduled messages`);
      } catch (err) {
        this.logger.error('DelayScheduler error', err);
      }
    };
    scheduler();
    this.delayTimeoutId = setInterval(scheduler, this.config.checkDelayInterval ?? 1000);
  }

  /**
   * Stops all subscriptions and cleans up resources.
   */
  async stopAll() {
    this.logger.info('Stopping all subscriptions');
    this.active = false;

    if (this.delayTimeoutId) {
      clearInterval(this.delayTimeoutId);
    }

    // Указываем false явно для ясности
    for (const sub of this.subscriptions.values()) {
      await sub.unsubscribe(false);
    }

    await Promise.all(Array.from(this.consumerLoops.values()).map(loop => loop.loopPromise));

    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }

    if (this.subClient && this.subClient.status !== 'end') {
      await this.subClient.quit();
    }

    this.logger.info('All subscriptions stopped');
  }

  /**
   * Subscribes to the Dead Letter Queue.
   * @param {(msg: RotifMessage) => Promise<void>} handler - DLQ message handler
   */
  async subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>) {
    await this.initializationDefer.promise;
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
          'COUNT', 1000,
          'BLOCK', this.config.blockInterval || 5000,
          'STREAMS', streamKey, '>'
        ) as [string, [string, string[]][]][] | null;

        if (!entries) continue;

        for (const [, records] of entries) {
          for (const [id, rawFields] of records) {
            const fields = parseFields(rawFields);
            const channel = fields['channel'] ?? 'unknown';
            const payloadStr = fields['payload'] ?? '{}';
            const timestamp = parseInt(fields['timestamp'] ?? Date.now().toString(), 10);
            const attempt = parseInt(fields['attempt'] ?? '1', 10);

            const msg: RotifMessage = {
              id,
              channel,
              payload: JSON.parse(payloadStr),
              timestamp,
              attempt,
              ack: async () => { await this.redis.xack(streamKey, group, id); },
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
    await this.initializationDefer.promise;
    const entries = await this.redis.xrange('rotif:dlq', '-', '+', 'COUNT', count);
    for (const [id, fields] of entries) {
      const channel = fields['channel'];
      const payloadStr = fields['payload'];
      const timestampStr = fields['timestamp'] ?? Date.now().toString();
      const attemptStr = fields['attempt'] ?? '1';

      if (!channel || !payloadStr) continue;

      await this.redis.xadd(getStreamKey(channel), '*',
        'channel', channel,
        'payload', payloadStr,
        'timestamp', timestampStr,
        'attempt', attemptStr,
      );

      await this.redis.xdel('rotif:dlq', id);
    }
  }

  private subscribeToPatternUpdates() {
    const connect = () => {
      if (!this.active) return;
      if (this.subClient) {
        this.subClient.disconnect();
        this.subClient.removeAllListeners();
      }

      this.subClient = new Redis(this.config.redis as RedisOptions);

      this.subClient.subscribe('rotif:subscriptions:updates').catch(err => {
        this.logger.error('Pub/Sub subscription failed:', err);
      });

      this.subClient.on('message', (_, message) => {
        const [action, pattern] = message.split(':');
        if (action === 'add') {
          this.activePatterns.add(pattern as string);
        } else if (action === 'remove') {
          this.activePatterns.delete(pattern as string);
        }
      });

      this.subClient.on('error', (err) => {
        this.logger.error('Pub/Sub subscriber error:', err);
      });

      this.subClient.on('end', () => {
        if (!this.active) return;
        this.logger.warn('Pub/Sub subscriber disconnected, reconnecting...');
        setTimeout(connect, 1000);
      });

      this.subClient.on('connect', () => {
        this.logger.info('Pub/Sub subscriber connected');
      });
    };

    connect();
  }

  private async startSharedConsumerLoop(stream: string, group: string, consumer: string): Promise<Set<Subscription>> {
    const loopKey = getLoopKey(stream, group);
    const loop = this.consumerLoops.get(loopKey);

    if (loop) {
      return loop.subscriptions; // Если уже есть, просто возвращаем существующий Set
    }

    const subscriptions = new Set<Subscription>();

    const loopPromise = (async () => {
      this.logger.info(`Starting shared consumer loop for ${stream}:${group}`);

      while (this.active) {
        if (subscriptions.size === 0) {
          await delayMs(100);  // Ждем, если нет подписок
          continue;
        }

        try {
          const entries = await this.redis.xreadgroup(
            'GROUP', group, consumer,
            'COUNT', 5000,
            'BLOCK', this.config.blockInterval ?? 5000,
            'STREAMS', stream, '>'
          );

          if (!entries) continue;

          const typedEntries = entries as [string, [string, string[]][]][];
          for (const [returnedStream, records] of typedEntries) {
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
                  await this.redis.evalsha(
                    this.ackScriptSHA!,
                    1,
                    returnedStream,
                    group,
                    id,
                    '1'
                  );
                },
              };

              const matchingSubs = Array.from(subscriptions).filter(sub =>
                !sub.isPaused && minimatch(channel, sub.pattern)
              );

              if (matchingSubs.length === 0) {
                this.logger.warn(`No matching subscriptions for channel=${channel}, msg=${msg.id}`);
                continue;
              }

              for (const sub of matchingSubs) {
                try {
                  this.logger.debug(`Processing message ${msg.id} for channel=${channel}`);
                  await this.middleware.runBeforeProcess(msg);
                  await sub.handler(msg);
                  await msg.ack();
                  await this.middleware.runAfterProcess(msg);
                } catch (err) {
                  this.logger.error(`Handler error on message ${msg.id}`, err);
                  await this.middleware.runOnError(msg, err as Error);

                  const maxRetries = sub.options?.maxRetries ?? this.config.maxRetries ?? 5;

                  if (msg.attempt >= maxRetries) {
                    await this.redis.evalsha(
                      this.moveToDLQScriptSHA!,
                      2,
                      returnedStream,
                      'rotif:dlq',
                      group,
                      msg.id,
                      channel,
                      payloadStr,
                      (err as Error).message || 'unknown',
                      msg.timestamp.toString(),
                      msg.attempt.toString()
                    );
                    this.logger.error(`Message ${msg.id} moved to DLQ`);
                  } else {
                    const retryDelay = typeof sub.options?.retryDelay === 'function'
                      ? sub.options.retryDelay(msg.attempt, msg)
                      : Number(sub.options?.retryDelay ?? this.config.retryDelay ?? 1000);

                    const retryStream = `${returnedStream}:retry`;

                    await this.redis.evalsha(
                      this.retryScriptSHA!,
                      2,
                      retryStream,
                      'rotif:scheduled',
                      group,
                      msg.id,
                      channel,
                      payloadStr,
                      timestampStr,
                      (attempt + 1).toString(),
                      (Date.now() + (retryDelay as number)).toString(),
                      uuidv4(),
                    );
                  }
                }
              }
            }
          }
        } catch (err) {
          if (!this.active) break;

          this.logger.error(`Error reading stream ${stream} group ${group}`, err);
          await delayMs(500);
        }
      }

      this.logger.info(`Stopped shared consumer loop for ${stream}:${group}`);
    })();

    this.consumerLoops.set(loopKey, { loopPromise, subscriptions });

    return subscriptions;
  }

  private async syncPatterns() {
    try {
      const patterns = await this.redis.zrangebyscore('rotif:patterns', 1, '+inf');
      this.activePatterns = new Set(patterns);
    } catch (err) {
      this.logger.error('Error syncing patterns', err);
    }
  }

  /**
   * Ensures a consumer group exists for a Redis stream.
   * Creates the group if it doesn't exist, ignores if it already exists.
   * @param {Redis} redis - Redis client
   * @param {string} stream - Stream name
   * @param {string} group - Group name
   * @param {string} [startId='$'] - Starting ID for the group
   */
  private async ensureStreamGroup(
    stream: string,
    group: string,
    startId: string = '0'
  ) {
    try {
      await this.redis.xgroup('CREATE', stream, group, startId, 'MKSTREAM');
    } catch (err: any) {
      if (!err?.message?.includes('BUSYGROUP')) throw err;
    }
  }

  async waitForConsumerLoopsReady(patterns: string[], timeout = 10000) {
    const start = Date.now();
    const streamsWithGroups = patterns.flatMap(p => {
      const group = defaultGroupName(p);
      const stream = getStreamKey(p);
      return [stream, `${stream}:retry:${group}`];
    });

    while (Date.now() - start < timeout) {
      const existingGroups = await Promise.all(
        streamsWithGroups.map(async stream => {
          try {
            const info = await this.redis.xinfo('GROUPS', stream) as { length: number };
            return info.length > 0;
          } catch {
            return false;
          }
        })
      );
      if (existingGroups.every(Boolean)) {
        return;
      }
      await delayMs(50);
    }
    throw new Error('Consumer loops not ready within timeout');
  }

  private generateDedupId(payload: any): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}
