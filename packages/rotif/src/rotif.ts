import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { Redis, RedisOptions } from 'ioredis';
import { defer, Deferred, delay as delayMs } from '@devgrid/common';

import { StatsTracker } from './stats';
import { DedupStore } from './exactly-once';
import { parseFields } from './utils/common';
import { defaultLogger } from './utils/logger';
import { defaultConsumerName } from './options';
import { Middleware, MiddlewareManager } from './middleware';
import { getStreamKey, ensureStreamGroup } from './stream-utils';
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
  private centralLoopDefer?: Deferred;
  private initializationDefer: Deferred;

  private publishScriptSHA?: string;
  private moveScheduledScriptSHA?: string;
  private ackScriptSHA?: string;
  private retryScriptSHA?: string;
  private moveToDLQScriptSHA?: string;

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

    this.initializationDefer = defer();

    this.loadLuaScripts().then(() => {
      if (this.config.enableDelayed !== false) {
        setImmediate(() => this.startDelayScheduler());
      }
      this.initializationDefer.resolve?.(true);
    });
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

    this.logger.info('Lua scripts loaded');
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
   * Starts the central event-loop for processing messages from all subscribed streams.
   */
  private async startCentralLoop() {
    if (this.centralLoopDefer) return;
    this.centralLoopDefer = defer();

    await this.initializationDefer.promise;

    const consumer = this.config.consumerNameFn?.() || defaultConsumerName();

    while (this.active) {
      if (this.subscriptions.size === 0) {
        await delayMs(500);
        continue;
      }

      // Составим пары поток-группа с учётом startFrom
      const streamGroupPairs = new Map<string, Map<string, string>>(); // stream -> (group -> startFrom)

      for (const sub of this.subscriptions.values()) {
        const stream = getStreamKey(sub.pattern.replace('*', ''));
        const group = sub.group;
        const startFrom = sub.options?.startFrom ?? '$';

        if (!streamGroupPairs.has(stream)) streamGroupPairs.set(stream, new Map());
        const groupMap = streamGroupPairs.get(stream)!;

        // Используем самое раннее startFrom, если несколько подписок указали разные значения
        if (!groupMap.has(group) || (startFrom !== '$' && groupMap.get(group) === '$')) {
          groupMap.set(group, startFrom);
        }
      }

      // Создание групп с правильным startFrom
      for (const [stream, groups] of streamGroupPairs.entries()) {
        for (const [group, startFrom] of groups.entries()) {
          await ensureStreamGroup(this.redis, stream, group, startFrom);
        }
      }

      // Читаем сообщения по всем группам и стримам отдельно
      const readPromises: Promise<void>[] = [];

      for (const [stream, groups] of streamGroupPairs.entries()) {
        for (const group of groups.keys()) {
          readPromises.push(this.trackOperation(this.redis.xreadgroup(
            'GROUP', group, consumer,
            'COUNT', 50,
            'BLOCK', this.config.blockInterval ?? 5000,
            'STREAMS', stream, '>'
          ) as Promise<[string, [string, string[]][]][] | null>).then(async entries => {
            if (!entries) return;
            for (const [returnedStream, records] of entries) {
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
                    await this.trackOperation(this.redis.evalsha(
                      this.ackScriptSHA!,
                      1,
                      returnedStream,
                      group,
                      id,
                      '1'
                    ));
                  },
                };

                await this.dispatchToSubscribers(channel, msg, returnedStream, payloadStr, timestampStr, attemptStr, group);
              }
            }
          }).catch(err => {
            this.logger.error(`Error reading stream ${stream} group ${group}`, err);
          }));
        }
      }

      await Promise.all(readPromises);
    }

    this.centralLoopDefer?.resolve?.(true);
  }


  /**
   * Dispatches messages to relevant subscribers.
   */
  private async dispatchToSubscribers(
    channel: string,
    msg: RotifMessage,
    stream: string,
    payloadStr: string,
    timestampStr: string,
    attemptStr: string,
    group: string // добавляем сюда группу!
  ) {
    const matchingSubs = Array.from(this.subscriptions.values()).filter(sub => {
      const regexPattern = sub.pattern.replace('*', '.*');
      return sub.group === group && new RegExp(`^${regexPattern}$`).test(channel);
    });

    for (const sub of matchingSubs) {
      if (sub.isPaused) continue;
      try {
        await this.middleware.runBeforeProcess(msg);
        await sub.handler(msg);
        await msg.ack();
        await this.middleware.runAfterProcess(msg);
      } catch (err) {
        this.logger.warn(`Handler error on message ${msg.id}`, err);
        await this.middleware.runOnError(msg, err as Error);

        const maxRetries = sub.options?.maxRetries ?? this.config.maxRetries ?? 5;

        if (msg.attempt >= maxRetries) {
          await this.trackOperation(this.redis.evalsha(
            this.moveToDLQScriptSHA!,
            2,
            stream,
            'rotif:dlq',
            group,
            msg.id,
            channel,
            payloadStr,
            (err as Error).message || 'unknown',
            msg.timestamp.toString(),
            msg.attempt.toString()
          ));
          this.logger.error(`Message ${msg.id} moved to DLQ`);
        } else {
          const retryDelay = typeof sub.options?.retryDelay === 'function'
            ? sub.options.retryDelay(msg.attempt, msg)
            : Number(sub.options?.retryDelay ?? this.config.retryDelay ?? 1000);

          await this.trackOperation(this.redis.evalsha(
            this.retryScriptSHA!,
            2,
            stream,
            'rotif:scheduled',
            group,
            msg.id,
            channel,
            payloadStr,
            timestampStr,
            attemptStr,
            (Date.now() + retryDelay).toString(),
            uuidv4(),
          ));
        }
      }
    }
  }

  /**
   * Publishes a message to a channel.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {PublishOptions} [options] - Publishing options
   * @returns {Promise<string>} Message ID
   */
  async publish(channel: string, payload: any, options?: PublishOptions): Promise<string> {
    await this.initializationDefer.promise;
    return this.trackOperation(this._publish(channel, payload, options));
  }

  /**
   * Internal publish implementation.
   * @private
   */
  private async _publish(channel: string, payload: any, options?: PublishOptions): Promise<string> {
    await this.middleware.runBeforePublish(channel, payload, options);

    const streamKey = getStreamKey(channel);
    const delayedSetKey = 'rotif:scheduled';
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

    const result = await this.redis.evalsha(
      this.publishScriptSHA!,
      2,
      streamKey,
      delayedSetKey,
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
    ) as string;

    if (!result) throw new Error('Publish failed: no ID returned');
    if (result === 'DUPLICATE') {
      this.logger.warn(`Duplicate message detected: ${dedupKey}`);
      return result;
    }

    this.logger.debug('Published message via Lua', { id: result, channel, deliveryType });

    await this.middleware.runAfterPublish(channel, payload, result, options);
    return result;
  }

  private generateDedupId(payload: any): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
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
    return this.trackOperation(this._subscribe(pattern, handler, options));
  }

  /**
   * Internal subscribe implementation.
   * @private
   */
  private async _subscribe(
    pattern: string,
    handler: (msg: RotifMessage) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<Subscription> {
    const group = options?.groupName ?? 'rotif-group';
    const subId = uuidv4();
    const stats = new StatsTracker();

    const sub: Subscription = {
      id: subId,
      pattern,
      group,
      options,
      handler, // сохранили обработчик
      unsubscribe: async () => {
        this.subscriptions.delete(subId);
      },
      pause: () => { sub.isPaused = true; },
      resume: () => { sub.isPaused = false; },
      isPaused: false,
      stats: () => stats.getStats(),
    };

    this.subscriptions.set(subId, sub);

    if (!this.centralLoopDefer) {
      this.startCentralLoop();
    }

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
        const movedMessagesCount = await this.trackOperation(this.redis.evalsha(
          this.moveScheduledScriptSHA!,
          1,
          'rotif:scheduled',
          Date.now().toString(),
          String(this.config.scheduledBatchSize ?? 1000)
        ));

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
    await this.initializationDefer.promise;

    this.logger.info('Stopping all subscriptions');
    this.active = false;

    for (const sub of this.subscriptions.values()) {
      await sub.unsubscribe();
    }

    if (this.delayTimeoutId) {
      clearInterval(this.delayTimeoutId);
    }

    if (this.centralLoopDefer) {
      await this.centralLoopDefer.promise;
    }

    // Дождёмся завершения всех операций, включая текущие xreadgroup
    while (this.activeOperations.size > 0) {
      await delayMs(100);
    }

    // После завершения операций закроем соединение с Redis
    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }

    this.logger.info('All subscriptions stopped');
  }

  /**
   * Subscribes to the Dead Letter Queue.
   * @param {(msg: RotifMessage) => Promise<void>} handler - DLQ message handler
   */
  async subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>) {
    await this.initializationDefer.promise;
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
}