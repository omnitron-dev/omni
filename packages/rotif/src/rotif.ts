import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch'
import { Redis, RedisOptions } from 'ioredis';
import { randomUUID, createHash } from 'node:crypto';
import { defer, Deferred, delay as delayMs } from '@omnitron-dev/common';

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { StatsTracker } from './stats';
import { defaultLogger } from './utils/logger';
import { Middleware, MiddlewareManager } from './middleware';
import { RotifConfig, RotifLogger, RotifMessage, Subscription, PublishOptions, SubscribeOptions } from './types';
import { getLoopKey, parseFields, getStreamKey, getGroupName, generateDedupKey, defaultConsumerName } from './utils/common';
import { createRetryDelayFn, RetryStrategies } from './retry-strategies';
import { DLQManager, type DLQCleanupConfig } from './dlq-manager';

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
  /** Timeout ID for delayed message scheduler */
  private delayTimeoutId?: NodeJS.Timeout;
  private activePatterns = new Set<string>();
  private initializationDefer: Deferred;
  private subClient?: Redis;
  private consumerLoops = new Map<string, { loopPromise: Promise<void>; subscriptions: Set<Subscription>; readyPromise: Promise<void> }>();
  private luaScripts = new Map<string, string>();
  private roundRobinIndices = new Map<string, number>();
  private dlqSubscriptionPromise?: Promise<void>;
  /** DLQ Manager instance */
  private dlqManager: DLQManager;

  /**
   * Creates a new NotificationManager instance.
   * @param {RotifConfig} config - Configuration options
   */
  constructor(config: RotifConfig) {
    this.config = config;
    this.logger = config.logger || defaultLogger;
    this.redis = new Redis(config.redis as RedisOptions);

    // Initialize DLQ Manager
    this.dlqManager = new DLQManager(this.redis, this.logger, config.dlqCleanup);
    this.redis.options.retryStrategy = (times) => {
      const baseDelay = 100; // Базовое время ожидания
      const maxDelay = 5000; // Максимальное время ожидания
      const jitter = Math.random() * 100; // Случайное отклонение для предотвращения thundering herd

      // Экспоненциальная задержка с добавлением jitter
      const delay = Math.min(baseDelay * Math.pow(2, times - 1) + jitter, maxDelay);

      return delay;
    };

    this.redis.on('error', (err) => {
      this.logger.error('Redis connection error', err);
    });

    this.redis.on('reconnecting', (time: number) => {
      this.logger.info(`Redis reconnecting in ${time}ms...`);
    });

    this.redis.on('connect', () => {
      this.syncPatterns();
      this.logger.info('Redis successfully connected');
    });

    this.initializationDefer = defer();

    this.loadLuaScripts().then(() => {
      if (!this.config.disableDelayed) {
        setImmediate(() => {
          this.startDelayScheduler();
        });
      }
      // Start DLQ auto-cleanup if configured
      if (this.config.dlqCleanup?.enabled) {
        this.dlqManager.startAutoCleanup();
      }
      this.initializationDefer.resolve?.(true);
    });
    this.subscribeToPatternUpdates();
  }

  async loadLuaScripts() {
    const luaDir = path.resolve(__dirname, '..', 'lua');
    const luaFiles = fs.readdirSync(luaDir).filter(file => file.endsWith('.lua'));

    for (const file of luaFiles) {
      const scriptContent = fs.readFileSync(path.join(luaDir, file), 'utf-8');
      const scriptName = path.basename(file, '.lua');
      const localSha = createHash('sha1').update(scriptContent).digest('hex');

      // Always reload scripts in development to ensure changes are picked up
      const sha = await this.redis.script('LOAD', scriptContent) as string;
      this.luaScripts.set(scriptName, sha);
    }
    this.logger.info('Lua scripts loaded or reused');
  }

  async runLuaScript<T = any>(
    scriptName: string,
    keys: string[],
    args: (string | number)[]
  ): Promise<T> {
    const sha = this.luaScripts.get(scriptName);
    if (!sha) {
      throw new Error(`Lua script ${scriptName} not loaded.`);
    }

    return this.redis.evalsha(sha, keys.length, ...keys, ...args) as T;
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

    const deduplicationTTL = options?.deduplicationTTL ?? this.config.deduplicationTTL ?? 3600;

    const results: string[] = [];

    for (const pattern of matchingPatterns) {
      const streamKey = getStreamKey(pattern);
      const dedupKey = options?.exactlyOnce
        ? (this.config.generateDedupKey?.({ channel, payload, pattern }) ?? generateDedupKey({ channel, payload, pattern, side: 'pub' }))
        : '';
      try {
        const result = await this.runLuaScript(
          'publish-message',
          [streamKey, 'rotif:scheduled'],
          [
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
            randomUUID(),
            options?.exactlyOnce ? 'true' : 'false',
            pattern, // Pass pattern to store in message
          ]
        );

        if (result === 'DUPLICATE') {
          this.logger.info(`Duplicate message detected: ${dedupKey}`);
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
    const group = getGroupName(pattern, options?.groupName);
    const consumer = this.config.consumerNameFn?.() || defaultConsumerName();
    const stream = getStreamKey(pattern);
    const retryStream = `${stream}:retry`;

    const subId = randomUUID();
    const stats = new StatsTracker();

    await this.ensureStreamGroup(stream, group);
    await this.ensureStreamGroup(retryStream, group);

    const sub: Subscription = {
      id: subId,
      pattern,
      group,
      options,
      handler,
      statsTracker: stats,
      inflightCount: 0, // Track in-flight messages
      unsubscribe: async (removePattern = false) => {
        sub.isPaused = true;

        // Wait for in-flight messages to complete (with timeout)
        const maxWait = 5000; // 5 seconds max wait
        const startTime = Date.now();
        while ((sub as any).inflightCount > 0 && Date.now() - startTime < maxWait) {
          await delayMs(10);
        }

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
          const newCount = await this.runLuaScript(
            'safe-unsubscribe',
            ['rotif:patterns'],
            [pattern]
          );

          if (Number(newCount) === 0) {
            // Immediately remove from local activePatterns
            this.activePatterns.delete(pattern);
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
      // Immediately add to local activePatterns
      this.activePatterns.add(pattern);
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
        const movedMessagesCount = await this.runLuaScript(
          'move-scheduled-messages',
          ['rotif:scheduled'],
          [Date.now().toString(), String(this.config.scheduledBatchSize ?? 1000)]
        );

        if (this.active && Number(movedMessagesCount) > 0) {
          this.logger.debug(`Moved ${movedMessagesCount} scheduled messages`);
        }
      } catch (err) {
        if (this.active) {
          this.logger.error('DelayScheduler error', err);
        }
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

    if (this.delayTimeoutId) {
      clearInterval(this.delayTimeoutId);
    }

    // Stop DLQ auto-cleanup
    this.dlqManager.stopAutoCleanup();

    // Unsubscribe all first
    const unsubscribePromises = Array.from(this.subscriptions.values()).map(sub =>
      sub.unsubscribe(false)
    );
    await Promise.all(unsubscribePromises);

    // Now mark as inactive to stop loops
    this.active = false;

    // Wait for DLQ subscription to stop if it exists (with timeout)
    if (this.dlqSubscriptionPromise) {
      await Promise.race([
        this.dlqSubscriptionPromise,
        delayMs(3000)  // 3 second timeout
      ]);
    }

    // Wait for consumer loops to finish (with timeout)
    const loopPromises = Array.from(this.consumerLoops.values()).map(loop => loop.loopPromise);
    if (loopPromises.length > 0) {
      await Promise.race([
        Promise.all(loopPromises),
        delayMs(3000)  // 3 second timeout
      ]);
    }

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

    // Track the DLQ subscription loop
    this.dlqSubscriptionPromise = (async () => {
      while (this.active) {
        try {
          // Break if stopAll has been called
          if (!this.active) break;

          const entries = await this.redis.xreadgroup(
            'GROUP', group, consumer,
            'COUNT', 1000,
            'BLOCK', 1000,  // Reduce block timeout for faster shutdown
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
          if (this.active) {
            this.logger.error('[DLQ] Processing error', err);
          }
        }
      }
    })();

    // Return the promise so tests can optionally await it
    return this.dlqSubscriptionPromise;
  }

  /**
   * Requeues messages from DLQ back to their original streams.
   * @param {number} [count=10] - Maximum number of messages to requeue
   */
  async requeueFromDLQ(count = 10): Promise<number> {
    await this.initializationDefer.promise;

    const requeuedCount = await this.runLuaScript(
      'requeue-from-dlq',
      ['rotif:dlq'],
      [count.toString()]
    );

    this.logger.info(`Requeued ${requeuedCount} messages from DLQ`);

    return Number(requeuedCount);
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
    const existingLoop = this.consumerLoops.get(loopKey);

    if (existingLoop) {
      await existingLoop.readyPromise; // Wait for existing loop to be ready
      return existingLoop.subscriptions;
    }

    const subscriptions = new Set<Subscription>();
    const readyDefer = defer();

    const handleMessage = async (id: string, rawFields: string[]) => {
      const fields = parseFields(rawFields);
      const channel = fields['channel'] ?? '';
      const payloadStr = fields['payload'] ?? '{}';
      const timestamp = parseInt(fields['timestamp'] ?? '0');
      const attempt = parseInt(fields['attempt'] ?? '1');
      const exactlyOnce = (fields['exactlyOnce'] ?? 'false') === 'true';
      const dedupTTL = fields['dedupTTL'];
      const pattern = fields['pattern'] ?? channel; // Get pattern from message


      let payload: any;
      try {
        payload = payloadStr ? JSON.parse(payloadStr) : null;
      } catch (parseError) {
        this.logger.error(`Failed to parse payload for message ${id}: ${payloadStr}`, parseError);
        // Acknowledge the message to prevent it from being stuck
        await this.runLuaScript('ack-message', [stream], [group, id, '1']);
        return;
      }

      const msg: RotifMessage = {
        id,
        channel,
        payload,
        timestamp,
        attempt,
        ack: async () => {
          await this.runLuaScript('ack-message', [stream], [group, id, '1']);
        },
      };

      const matchingSubs = Array.from(subscriptions).filter(sub =>
        !sub.isPaused && minimatch(channel, sub.pattern)
      );

      if (matchingSubs.length === 0) {
        // Check if we have any subscriptions at all (even paused ones)
        const allSubs = Array.from(subscriptions).filter(sub => minimatch(channel, sub.pattern));
        if (allSubs.length > 0) {
          // We have paused subscriptions, just acknowledge without warning
          await this.runLuaScript('ack-message', [stream], [group, id, '1']);
        } else {
          // No subscriptions at all, warn and ack
          this.logger.warn(`No matching subscriptions for channel=${channel}, msg=${id}`);
          await this.runLuaScript('ack-message', [stream], [group, id, '1']);
        }
        return;
      }

      let subs: Subscription[];
      if (this.config.localRoundRobin) {
        const subIndex = this.getRoundRobinIndex(stream, group, matchingSubs.length);
        subs = [matchingSubs[subIndex]!];
      } else {
        subs = matchingSubs;
      }

      for (const sub of subs) {
        // Double-check if subscription is still active before processing
        if (sub.isPaused) {
          continue;
        }

        // Increment in-flight counter
        (sub as any).inflightCount = ((sub as any).inflightCount || 0) + 1;

        // Record retry if this is a retry attempt (attempt > 1)
        if (msg.attempt > 1) {
          sub.statsTracker?.recordRetry();
        }

        let dedupKey = '';
        if (exactlyOnce) {
          // Use group for consumer-side deduplication
          dedupKey = generateDedupKey({ channel, payload: msg.payload, group, side: 'con' });
          // Use atomic SET NX to prevent race conditions
          const wasSet = await this.redis.set(
            dedupKey,
            '1',
            'EX',
            dedupTTL ? Number(dedupTTL) : 3600,
            'NX'
          );

          if (!wasSet) {
            // Message was already processed by another worker
            await msg.ack();
            this.logger.info(`Duplicate message detected for channel=${channel} and group=${group} msg=${id}`);
            // Decrement in-flight counter
            (sub as any).inflightCount = Math.max(0, ((sub as any).inflightCount || 0) - 1);
            continue;
          }
        }

        try {
          await this.middleware.runBeforeProcess(msg);
          await sub.handler(msg);
          await msg.ack();
          await this.middleware.runAfterProcess(msg);

          // Record successful message processing
          sub.statsTracker?.recordMessage();
        } catch (err) {
          await this.middleware.runOnError(msg, err as Error);

          // If exactly-once is enabled and message failed, remove dedup key to allow retry
          if (exactlyOnce && dedupKey) {
            await this.redis.del(dedupKey);
          }

          const maxRetries = sub.options?.maxRetries ?? this.config.maxRetries ?? 5;

          if (msg.attempt > maxRetries) {
            await this.runLuaScript('move-to-dlq', [stream, 'rotif:dlq'], [
              group, msg.id, channel, payloadStr,
              (err as Error).message || 'unknown', msg.timestamp.toString(), msg.attempt.toString(),
            ]);
            // Record failure when message moved to DLQ
            sub.statsTracker?.recordFailure();
            this.logger.error(`Message ${id} moved to DLQ`);
          } else {
            // Calculate retry delay using strategy or function
            let retryDelay: number;
            if (sub.options?.retryStrategy) {
              const retryFn = createRetryDelayFn(sub.options.retryStrategy);
              retryDelay = retryFn(msg.attempt, msg);
            } else if (this.config.retryStrategy) {
              const retryFn = createRetryDelayFn(this.config.retryStrategy);
              retryDelay = retryFn(msg.attempt, msg);
            } else if (typeof sub.options?.retryDelay === 'function') {
              retryDelay = sub.options.retryDelay(msg.attempt, msg);
            } else {
              retryDelay = Number(sub.options?.retryDelay ?? this.config.retryDelay ?? 1000);
            }

            // Determine the correct stream for retry - always use the main stream (without :retry suffix)
            // This ensures retries go to the main stream, not back to retry stream
            const mainStream = stream.endsWith(':retry')
              ? stream.slice(0, -6)  // Remove ':retry' suffix to get main stream
              : stream; // Already the main stream
            const nextAttempt = attempt + 1;
            const retryAt = Date.now() + retryDelay;


            try {
              this.logger.debug(`Scheduling retry: stream=${mainStream}, attempt=${nextAttempt}, delay=${retryDelay}ms`);
              const result = await this.runLuaScript('retry-message', [stream, 'rotif:scheduled'], [
                group, msg.id, channel, payloadStr, timestamp.toString(), nextAttempt.toString(),
                retryAt.toString(), randomUUID(), fields['exactlyOnce'] ?? 'false', dedupTTL ?? '3600', mainStream,
                pattern, // Pass pattern for retries
              ]);
              this.logger.debug(`Retry scheduled successfully: ${result}`);
            } catch (luaErr) {
              this.logger.error(`Failed to schedule retry: ${luaErr}`);
              throw luaErr;
            }
          }
        } finally {
          // Decrement in-flight counter
          (sub as any).inflightCount = Math.max(0, ((sub as any).inflightCount || 0) - 1);
        }
      }

    };

    // Create the loop promise but DON'T start it yet
    let loopPromise: Promise<void>;

    // Add to consumerLoops FIRST before starting the loop
    const loopEntry = {
      loopPromise: null as any, // Will be set below
      subscriptions,
      readyPromise: readyDefer.promise!
    };
    this.consumerLoops.set(loopKey, loopEntry);

    // NOW start the actual loop
    loopPromise = (async () => {
      this.logger.info(`Starting shared consumer loop for ${stream}:${group}`);

      let lastPendingCheck = Date.now();
      const pendingCheckInterval = this.config.pendingCheckInterval ?? 30000;
      const idleThreshold = this.config.pendingIdleThreshold ?? 60000;

      // Mark the loop as ready before starting to process messages
      readyDefer.resolve?.(undefined);

      while (this.active) {
        if (subscriptions.size === 0) {
          // Exit loop if no subscriptions and this loop is marked for deletion
          if (!this.consumerLoops.has(loopKey)) {
            break;
          }
          await delayMs(100);
          continue;
        }

        try {
          if (!this.config.disablePendingMessageRecovery) {
            const now = Date.now();
            if (now - lastPendingCheck >= pendingCheckInterval) {
              lastPendingCheck = now;

              const pendingEntries = await this.redis.xpending(stream, group, 'IDLE', idleThreshold, '-', '+', 100);

              if (pendingEntries && pendingEntries.length > 0) {
                const staleIds = pendingEntries.map((entry: any) => entry[0]);

                const claimedMessages = await this.redis.xclaim(stream, group, consumer, idleThreshold, ...staleIds) as [string, string[]][];

                for (const [id, rawFields] of claimedMessages) {
                  await handleMessage(id, rawFields);
                }
              }
            }
          }

          const entries = await this.redis.xreadgroup(
            'GROUP', group, consumer,
            'COUNT', 5000,
            'BLOCK', this.config.blockInterval ?? 5000,
            'STREAMS', stream, '>'
          );

          if (!entries) {
            continue;
          }

          const typedEntries = entries as [string, [string, string[]][]][];
          for (const [streamName, records] of typedEntries) {
            for (const [id, rawFields] of records) {
              await handleMessage(id, rawFields);
            }
          }
        } catch (err) {
          if (!this.active) break;
          this.logger.error(`Error reading stream ${stream} group ${group}`, err);
          await delayMs(500);
        }
      }

      if (this.active) {
        this.logger.info(`Stopped shared consumer loop for ${stream}:${group}`);
      }
    })();

    // Update the loopPromise in the entry
    loopEntry.loopPromise = loopPromise;

    await readyDefer.promise!; // Wait for the loop to be ready before returning
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

  private getRoundRobinIndex(stream: string, group: string, count: number): number {
    const key = `${stream}:${group}`;
    const current = this.roundRobinIndices.get(key) || 0;
    const next = (current + 1) % count;
    this.roundRobinIndices.set(key, next);
    return current;
  }

  /**
   * Get DLQ statistics
   */
  async getDLQStats() {
    return this.dlqManager.getStats();
  }

  /**
   * Get messages from DLQ with filtering
   */
  async getDLQMessages(options?: { channel?: string; limit?: number; offset?: number; maxAge?: number }) {
    return this.dlqManager.getMessages(options);
  }

  /**
   * Manually trigger DLQ cleanup
   */
  async cleanupDLQ(): Promise<number> {
    return this.dlqManager.cleanup();
  }

  /**
   * Clear all DLQ messages
   */
  async clearDLQ(): Promise<void> {
    return this.dlqManager.clear();
  }

  /**
   * Update DLQ cleanup configuration
   */
  updateDLQConfig(config: Partial<DLQCleanupConfig>): void {
    this.dlqManager.updateConfig(config);
  }

  /**
   * Export retry strategies for external use
   */
  static RetryStrategies = RetryStrategies;

  /**
   * Export createRetryDelayFn for custom strategies
   */
  static createRetryDelayFn = createRetryDelayFn;
}
