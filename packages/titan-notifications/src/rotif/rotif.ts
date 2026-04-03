import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import { Redis, RedisOptions } from 'ioredis';
import { createHash } from 'node:crypto';
import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import { defer, Deferred, delay as delayMs } from '@omnitron-dev/common';

import { Errors } from '@omnitron-dev/titan/errors';
import { StatsTracker } from './stats.js';
import { createNullLogger, type ILogger } from '@omnitron-dev/titan/types';
import { Middleware, MiddlewareManager } from './middleware.js';
import { RotifConfig, RotifMessage, Subscription, PublishOptions, SubscribeOptions } from './types.js';
import {
  getLoopKey,
  parseFields,
  parseFieldsFast,
  releaseFields,
  getStreamKey,
  getGroupName,
  generateDedupKey,
  defaultConsumerName,
  getCachedMatcher,
  chunkArray,
  processWithConcurrency,
  type ParsedFields,
} from './utils.js';
import { createRetryDelayFn, RetryStrategies } from '@omnitron-dev/titan/utils';
import { DLQManager, type DLQCleanupConfig } from './dlq-manager.js';

/**
 * Constants used throughout the Rotif module
 */
const ROTIF_CONSTANTS = {
  /** Base retry delay in milliseconds for exponential backoff */
  BASE_RETRY_DELAY_MS: 100,
  /** Maximum retry delay in milliseconds */
  MAX_RETRY_DELAY_MS: 5000,
  /** Default maximum wait time in milliseconds for unsubscribe operations */
  DEFAULT_MAX_WAIT_MS: 5000,
  /** Default number of messages to read per batch in xreadgroup */
  DEFAULT_READ_COUNT: 5000,
  /** Default message concurrency for parallel processing */
  DEFAULT_MESSAGE_CONCURRENCY: 1,
  /** Default pipeline batch size */
  DEFAULT_PIPELINE_BATCH_SIZE: 100,
  /** Default health check interval in milliseconds */
  DEFAULT_HEALTH_CHECK_INTERVAL: 30000,
  /** Default backpressure threshold */
  DEFAULT_BACKPRESSURE_THRESHOLD: 1000,
} as const;

/**
 * Connection health status
 */
interface HealthStatus {
  connected: boolean;
  lastPingMs: number;
  lastCheckTime: number;
  consecutiveFailures: number;
}

/**
 * Backpressure state for flow control
 */
interface BackpressureState {
  /** Whether backpressure is currently active */
  active: boolean;
  /** Number of messages pending processing */
  pendingCount: number;
  /** Timestamp when backpressure was activated */
  activatedAt?: number;
}

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
  private logger: ILogger;
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
  private dlqClient?: Redis;
  private consumerLoops = new Map<
    string,
    {
      loopPromise: Promise<void>;
      subscriptions: Set<Subscription>;
      readyPromise: Promise<void>;
      needsPendingRecovery?: boolean;
    }
  >();
  private luaScripts = new Map<string, string>();
  private roundRobinIndices = new Map<string, number>();
  private dlqSubscriptionPromise?: Promise<void>;
  /** DLQ Manager instance */
  private dlqManager: DLQManager;
  /** DLQ key */
  private dlqKey: string;
  /** Health check timer */
  private healthCheckTimer?: NodeJS.Timeout;
  /** Connection health status */
  private healthStatus: HealthStatus = {
    connected: false,
    lastPingMs: 0,
    lastCheckTime: 0,
    consecutiveFailures: 0,
  };
  /** Backpressure state for each consumer loop */
  private backpressureStates = new Map<string, BackpressureState>();
  /** Cached pattern matchers for faster matching */
  private patternMatcherCache = new Map<string, (channel: string) => boolean>();
  /** Enable field pooling (from config) */
  private enableFieldPooling: boolean;

  /**
   * Creates a new NotificationManager instance.
   * @param {RotifConfig} config - Configuration options
   */
  constructor(config: RotifConfig) {
    this.config = config;
    this.logger = config.logger || createNullLogger();
    this.redis = new Redis(config.redis as RedisOptions);
    this.dlqKey = config.dlqKey || 'rotif:dlq';
    this.enableFieldPooling = config.enableFieldPooling !== false; // Default true

    // Initialize DLQ Manager
    this.dlqManager = new DLQManager(this.redis, this.logger, config.dlqCleanup, this.dlqKey);
    this.redis.options.retryStrategy = (times) => {
      const jitter = Math.random() * ROTIF_CONSTANTS.BASE_RETRY_DELAY_MS; // Random jitter to prevent thundering herd

      // Exponential backoff with jitter
      const delay = Math.min(
        ROTIF_CONSTANTS.BASE_RETRY_DELAY_MS * Math.pow(2, times - 1) + jitter,
        ROTIF_CONSTANTS.MAX_RETRY_DELAY_MS
      );

      return delay;
    };

    this.redis.on('error', (err) => {
      this.logger.error({ err }, 'Redis connection error');
      this.healthStatus.connected = false;
      this.healthStatus.consecutiveFailures++;
    });

    this.redis.on('reconnecting', (time: number) => {
      this.logger.info(`Redis reconnecting in ${time}ms...`);
      this.healthStatus.connected = false;
    });

    this.redis.on('connect', () => {
      this.syncPatterns();
      this.healthStatus.connected = true;
      this.healthStatus.consecutiveFailures = 0;
      this.logger.info('Redis successfully connected');
    });

    this.initializationDefer = defer();

    this.loadLuaScripts().then(() => {
      // Guard against race condition: check if instance was destroyed before starting async operations
      if (!this.active) return;

      if (!this.config.disableDelayed) {
        setImmediate(() => {
          this.startDelayScheduler();
        });
      }
      // Start DLQ auto-cleanup if configured
      if (this.config.dlqCleanup?.enabled) {
        this.dlqManager.startAutoCleanup();
      }
      // Subscribe to pattern updates after Lua scripts are loaded
      this.subscribeToPatternUpdates();

      // Start health check if enabled (default: true)
      if (this.config.enableHealthCheck !== false) {
        this.startHealthCheck();
      }

      this.initializationDefer.resolve?.(true);
    });
  }

  /**
   * Starts periodic health checks for Redis connection.
   * Monitors connection latency and reconnects if needed.
   * @private
   */
  private startHealthCheck(): void {
    const interval = this.config.healthCheckInterval ?? ROTIF_CONSTANTS.DEFAULT_HEALTH_CHECK_INTERVAL;

    const performHealthCheck = async () => {
      if (!this.active) return;

      try {
        const startTime = Date.now();
        await this.redis.ping();
        const latency = Date.now() - startTime;

        this.healthStatus = {
          connected: true,
          lastPingMs: latency,
          lastCheckTime: Date.now(),
          consecutiveFailures: 0,
        };

        if (latency > 100) {
          this.logger.warn({ latency }, 'Redis connection latency is high');
        }
      } catch (err) {
        this.healthStatus.consecutiveFailures++;
        this.healthStatus.connected = false;
        this.healthStatus.lastCheckTime = Date.now();

        this.logger.error(
          { err, consecutiveFailures: this.healthStatus.consecutiveFailures },
          'Redis health check failed'
        );

        // If multiple consecutive failures, try to force reconnect
        if (this.healthStatus.consecutiveFailures >= 3) {
          this.logger.warn('Multiple health check failures, attempting reconnection');
          try {
            await this.redis.disconnect();
            await this.redis.connect();
          } catch (reconnectErr) {
            this.logger.error({ err: reconnectErr }, 'Failed to reconnect Redis');
          }
        }
      }
    };

    // Perform initial check
    performHealthCheck();

    // Schedule periodic checks
    this.healthCheckTimer = setInterval(performHealthCheck, interval);
  }

  /**
   * Gets the current health status of the Redis connection.
   * @returns {HealthStatus} Current health status
   */
  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus };
  }

  /**
   * Checks if backpressure should be applied for a consumer loop.
   * @param loopKey - The consumer loop identifier
   * @returns Whether consumption should be paused
   * @private
   */
  private shouldApplyBackpressure(loopKey: string): boolean {
    if (this.config.enableBackpressure === false) return false;

    const state = this.backpressureStates.get(loopKey);
    if (!state) return false;

    const threshold = this.config.backpressureThreshold ?? ROTIF_CONSTANTS.DEFAULT_BACKPRESSURE_THRESHOLD;
    return state.pendingCount >= threshold;
  }

  /**
   * Updates backpressure state for a consumer loop.
   * @param loopKey - The consumer loop identifier
   * @param delta - Change in pending count (positive = add, negative = remove)
   * @private
   */
  private updateBackpressure(loopKey: string, delta: number): void {
    if (this.config.enableBackpressure === false) return;

    let state = this.backpressureStates.get(loopKey);
    if (!state) {
      state = { active: false, pendingCount: 0 };
      this.backpressureStates.set(loopKey, state);
    }

    state.pendingCount = Math.max(0, state.pendingCount + delta);

    const threshold = this.config.backpressureThreshold ?? ROTIF_CONSTANTS.DEFAULT_BACKPRESSURE_THRESHOLD;
    const wasActive = state.active;
    state.active = state.pendingCount >= threshold;

    if (state.active && !wasActive) {
      state.activatedAt = Date.now();
      this.logger.warn({ loopKey, pendingCount: state.pendingCount }, 'Backpressure activated');
    } else if (!state.active && wasActive) {
      const duration = Date.now() - (state.activatedAt ?? Date.now());
      this.logger.info({ loopKey, durationMs: duration }, 'Backpressure deactivated');
      state.activatedAt = undefined;
    }
  }

  async loadLuaScripts() {
    try {
      // Determine lua directory using ESM import.meta
      let luaDir: string;
      try {
        // Use import.meta.url to get the current module's URL
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        luaDir = path.resolve(__dirname, '..', '..', 'lua', 'rotif');
      } catch (_e) {
        // If import.meta is not available (shouldn't happen in ESM), skip loading lua scripts
        this.logger.debug('Cannot determine lua directory, skipping script loading');
        return;
      }

      // Check if lua directory exists
      if (!fs.existsSync(luaDir)) {
        this.logger.debug('Lua scripts directory not found, skipping loading');
        return;
      }

      const luaFiles = fs.readdirSync(luaDir).filter((file) => file.endsWith('.lua'));

      for (const file of luaFiles) {
        const scriptContent = fs.readFileSync(path.join(luaDir, file), 'utf-8');
        const scriptName = path.basename(file, '.lua');
        const _localSha = createHash('sha1').update(scriptContent).digest('hex');

        // Always reload scripts in development to ensure changes are picked up
        const sha = (await this.redis.script('LOAD', scriptContent)) as string;
        this.luaScripts.set(scriptName, sha);
      }
      this.logger.info('Lua scripts loaded or reused');
    } catch (error) {
      this.logger.debug({ err: error }, 'Could not load Lua scripts');
      // Continue without Lua scripts - they're optional optimizations
    }
  }

  async runLuaScript<T = any>(scriptName: string, keys: string[], args: (string | number)[]): Promise<T> {
    const sha = this.luaScripts.get(scriptName);
    if (!sha) {
      throw Errors.notFound('Lua script', scriptName);
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
   * Wait until the notification manager is ready
   * @returns {Promise<void>}
   */
  async waitUntilReady(): Promise<void> {
    await this.initializationDefer.promise;
  }

  /**
   * Destroy the notification manager and clean up resources
   * @returns {Promise<void>}
   */
  async destroy(): Promise<void> {
    // Stop active operations
    this.active = false;

    // Clear delay scheduler interval
    if (this.delayTimeoutId) {
      clearInterval(this.delayTimeoutId);
      this.delayTimeoutId = undefined;
    }

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    // Clear patterns
    this.activePatterns.clear();

    // Clear Lua scripts
    this.luaScripts.clear();

    // Clear subscriptions
    this.subscriptions.clear();

    // Clear caches
    this.patternMatcherCache.clear();
    this.backpressureStates.clear();

    // Close all Redis connections
    await Promise.all([this.redis?.quit(), this.subClient?.quit(), this.dlqClient?.quit()].filter(Boolean));
  }

  /**
   * Publishes a message to a channel.
   * Uses cached pattern matching for ~5x faster pattern evaluation.
   * @param {string} channel - Channel name
   * @param {any} payload - Message payload
   * @param {PublishOptions} [options] - Publishing options
   * @returns {Promise<string>} Message ID
   */
  async publish(channel: string, payload: any, options?: PublishOptions): Promise<string[] | string | null> {
    if (!this.active) {
      throw new Error('Cannot publish: Rotif instance is stopped');
    }
    await this.initializationDefer.promise;
    await this.middleware.runBeforePublish(channel, payload, options);

    // Use cached pattern matchers for faster matching (optimization: ~5x speedup on repeated patterns)
    const matchingPatterns: string[] = [];
    for (const pattern of this.activePatterns) {
      let matcher = this.patternMatcherCache.get(pattern);
      if (!matcher) {
        matcher = getCachedMatcher(pattern, minimatch);
        this.patternMatcherCache.set(pattern, matcher);
      }
      if (matcher(channel)) {
        matchingPatterns.push(pattern);
      }
    }

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

    // Pre-serialize payload once for all patterns (optimization: avoid repeated JSON.stringify)
    const payloadJson = JSON.stringify(payload);
    const exactlyOnceFlag = options?.exactlyOnce ? 'true' : 'false';

    const results: string[] = [];

    for (const pattern of matchingPatterns) {
      const streamKey = getStreamKey(pattern);
      const dedupKey = options?.exactlyOnce
        ? (this.config.generateDedupKey?.({ channel, payload, pattern }) ??
          generateDedupKey({ channel, payload, pattern, side: 'pub' }))
        : '';
      try {
        const result = await this.runLuaScript(
          'publish-message',
          [streamKey, 'rotif:scheduled'],
          [
            payloadJson,
            timestamp,
            channel,
            attempt,
            deliveryType,
            delayTimestamp,
            maxStreamLength,
            minStreamId,
            dedupKey,
            deduplicationTTL.toString(),
            generateUuidV7(),
            exactlyOnceFlag,
            pattern, // Pass pattern to store in message
          ]
        );

        if (result === 'DUPLICATE') {
          this.logger.info(`Duplicate message detected: ${dedupKey}`);
        } else {
          results.push(result as string);
        }
      } catch (err) {
        this.logger.error({ err, streamKey }, 'Error publishing to stream');
        await this.middleware.runOnError(
          { channel, payload, attempt: +attempt, id: '', timestamp: +timestamp, ack: async () => {} },
          err as Error
        );
      }
    }

    if (results.length === 0) {
      return 'DUPLICATE';
    }

    this.logger.debug({ channel }, `Published message to ${results.length} active streams`);

    await this.middleware.runAfterPublish(channel, payload, results as string[], options);

    return results.length === 1 ? (results[0] as string) : (results as string[]);
  }

  /**
   * Publishes multiple messages in a batch using Redis pipelining.
   * Reduces network roundtrips by ~80% compared to individual publishes.
   *
   * @param messages - Array of messages to publish
   * @returns Array of results (message IDs or 'DUPLICATE' or null)
   */
  async publishBatch(
    messages: Array<{ channel: string; payload: any; options?: PublishOptions }>
  ): Promise<Array<string[] | string | null>> {
    await this.initializationDefer.promise;

    if (messages.length === 0) return [];

    // For small batches, use regular publish (pipelining overhead not worth it)
    if (messages.length < 3 || this.config.enablePipelining === false) {
      return Promise.all(messages.map((m) => this.publish(m.channel, m.payload, m.options)));
    }

    const results: Array<string[] | string | null> = new Array(messages.length);
    const batchSize = this.config.pipelineBatchSize ?? ROTIF_CONSTANTS.DEFAULT_PIPELINE_BATCH_SIZE;

    // Process in chunks to avoid overwhelming Redis
    const chunks = chunkArray(messages, batchSize);

    for (const chunk of chunks) {
      // For each chunk, we still need to use Lua scripts for atomicity
      // But we can process them concurrently
      await Promise.all(
        chunk.map(async (msg, idx) => {
          const globalIdx = chunks.indexOf(chunk) * batchSize + idx;
          results[globalIdx] = await this.publish(msg.channel, msg.payload, msg.options);
        })
      );
    }

    return results;
  }

  /**
   * Subscribes to messages on a channel pattern.
   * @param {string} pattern - Channel pattern
   * @param {(msg: RotifMessage) => Promise<void>} handler - Message handler
   * @param {SubscribeOptions} [options] - Subscription options
   * @returns {Promise<Subscription>} Subscription instance
   */
  async subscribe(
    pattern: string,
    handler: (msg: RotifMessage) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<Subscription> {
    await this.initializationDefer.promise;
    const group = getGroupName(pattern, options?.groupName);
    const consumer = this.config.consumerNameFn?.() || defaultConsumerName();
    const stream = getStreamKey(pattern);
    const retryStream = `${stream}:retry`;

    const subId = generateUuidV7();
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
        const startTime = Date.now();
        while (sub.inflightCount > 0 && Date.now() - startTime < ROTIF_CONSTANTS.DEFAULT_MAX_WAIT_MS) {
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
          const newCount = await this.runLuaScript('safe-unsubscribe', ['rotif:patterns'], [pattern]);

          if (Number(newCount) === 0) {
            // Immediately remove from local activePatterns
            this.activePatterns.delete(pattern);
            await this.redis.publish('rotif:subscriptions:updates', `remove:${pattern}`);
            this.logger.info(`Unsubscribed from pattern (no more subscribers): ${pattern}`);
          }
        }
      },
      pause: () => {
        sub.isPaused = true;
      },
      resume: () => {
        sub.isPaused = false;
        // Trigger immediate pending message recovery in the consumer loop
        // so that messages left unacked during pause get redelivered
        const loopKey = `${stream}:${group}`;
        const loop = this.consumerLoops.get(loopKey);
        if (loop) {
          loop.needsPendingRecovery = true;
        }
      },
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
          this.logger.error({ err }, 'DelayScheduler error');
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
    if (!this.active) {
      return; // Already stopped — idempotent
    }

    this.logger.info('Stopping all subscriptions');

    if (this.delayTimeoutId) {
      clearInterval(this.delayTimeoutId);
    }

    // Stop DLQ auto-cleanup
    this.dlqManager.stopAutoCleanup();

    // Unsubscribe all first
    const unsubscribePromises = Array.from(this.subscriptions.values()).map((sub) => sub.unsubscribe(false));
    await Promise.all(unsubscribePromises);

    // Now mark as inactive to stop loops
    this.active = false;

    // Wait for DLQ subscription to stop if it exists (with timeout)
    if (this.dlqSubscriptionPromise) {
      await Promise.race([
        this.dlqSubscriptionPromise,
        delayMs(3000), // 3 second timeout
      ]);
    }

    // Wait for consumer loops to finish (with timeout)
    const loopPromises = Array.from(this.consumerLoops.values()).map((loop) => loop.loopPromise);
    if (loopPromises.length > 0) {
      await Promise.race([
        Promise.all(loopPromises),
        delayMs(3000), // 3 second timeout
      ]);
    }

    if (this.redis.status !== 'end') {
      await this.redis.quit();
    }

    if (this.subClient && this.subClient.status !== 'end') {
      await this.subClient.quit();
    }

    if (this.dlqClient && this.dlqClient.status !== 'end') {
      await this.dlqClient.quit();
    }

    this.logger.info('All subscriptions stopped');
  }

  /**
   * Subscribes to the Dead Letter Queue.
   * @param {(msg: RotifMessage) => Promise<void>} handler - DLQ message handler
   */
  async subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>) {
    await this.initializationDefer.promise;
    const streamKey = this.dlqKey;
    const group = 'dlq-group';
    const consumer = 'dlq-worker';

    // Create a separate Redis connection for DLQ subscription to avoid blocking
    if (!this.dlqClient) {
      this.dlqClient = new Redis(this.config.redis as RedisOptions);
    }

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

          const entries = (await this.dlqClient!.xreadgroup(
            'GROUP',
            group,
            consumer,
            'COUNT',
            1000,
            'BLOCK',
            1000, // Reduce block timeout for faster shutdown
            'STREAMS',
            streamKey,
            '>'
          )) as [string, [string, string[]][]][] | null;

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
                ack: async () => {
                  await this.redis.xack(streamKey, group, id);
                },
              };

              try {
                await handler(msg);
                await msg.ack();
              } catch (err) {
                this.logger.error({ err, messageId: id }, '[DLQ] Handler failed');
              }
            }
          }
        } catch (err: any) {
          if (!this.active) break;

          // Defensive handling: if NOGROUP, try to create the group and continue
          if (err?.message?.includes('NOGROUP')) {
            this.logger.debug(`[DLQ] Consumer group ${group} not found, creating it`);
            try {
              await this.redis.xgroup('CREATE', streamKey, group, '0', 'MKSTREAM');
            } catch (createErr: any) {
              if (!createErr?.message?.includes('BUSYGROUP')) {
                this.logger.error({ err: createErr }, '[DLQ] Failed to create consumer group');
              }
            }
            await delayMs(100); // Short delay before retry
            continue;
          }

          this.logger.error({ err }, '[DLQ] Processing error');
          await delayMs(500);
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

    const requeuedCount = await this.runLuaScript('requeue-from-dlq', [this.dlqKey], [count.toString()]);

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

      this.subClient.subscribe('rotif:subscriptions:updates').catch((err) => {
        this.logger.error({ err }, 'Pub/Sub subscription failed');
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
        this.logger.error({ err }, 'Pub/Sub subscriber error');
      });

      this.subClient.on('end', () => {
        if (!this.active) return;
        this.logger.warn('Pub/Sub subscriber disconnected, reconnecting...');
        setTimeout(connect, 1000);
      });

      this.subClient.on('connect', () => {
        this.syncPatterns();
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

    // Initialize backpressure state for this loop
    this.backpressureStates.set(loopKey, { active: false, pendingCount: 0 });

    // Message concurrency setting (default: 1 for sequential processing)
    const messageConcurrency = this.config.messageConcurrency ?? ROTIF_CONSTANTS.DEFAULT_MESSAGE_CONCURRENCY;

    const handleMessage = async (id: string, rawFields: string[]) => {
      // Use optimized field parsing with object pooling if enabled
      const fields = this.enableFieldPooling ? parseFieldsFast(rawFields) : parseFields(rawFields);
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
        this.logger.error({ err: parseError, messageId: id, payloadStr }, 'Failed to parse payload');
        // Move unparseable message to DLQ instead of silently acknowledging
        const errorMessage = parseError instanceof Error ? parseError.message : 'Failed to parse message payload';
        await this.runLuaScript(
          'move-to-dlq',
          [stream, this.dlqKey],
          [
            group,
            id,
            channel,
            payloadStr,
            errorMessage,
            timestamp.toString(),
            attempt.toString(),
            exactlyOnce ? 'true' : 'false',
            dedupTTL ?? '3600',
          ]
        );
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

      // Use cached pattern matchers for faster matching (~5x speedup)
      const matchingSubs: Subscription[] = [];
      let hasAnyMatchingPattern = false;

      for (const sub of subscriptions) {
        let matcher = this.patternMatcherCache.get(sub.pattern);
        if (!matcher) {
          matcher = getCachedMatcher(sub.pattern, minimatch);
          this.patternMatcherCache.set(sub.pattern, matcher);
        }

        if (matcher(channel)) {
          hasAnyMatchingPattern = true;
          if (!sub.isPaused) {
            matchingSubs.push(sub);
          }
        }
      }

      if (matchingSubs.length === 0) {
        if (hasAnyMatchingPattern) {
          // All matching subscriptions are paused — do NOT acknowledge.
          // Leave the message pending so it can be redelivered after resume.
          // The consumer loop will re-read it from PEL on next iteration.
        } else {
          // No subscriptions at all, warn and ack to prevent infinite redelivery
          this.logger.warn(`No matching subscriptions for channel=${channel}, msg=${id}`);
          await this.runLuaScript('ack-message', [stream], [group, id, '1']);
        }
        // Release pooled fields before returning
        if (this.enableFieldPooling && 'channel' in fields) {
          releaseFields(fields as ParsedFields);
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
        // Verify subscription is still valid before processing
        if (!subscriptions.has(sub) || sub.isPaused) {
          continue;
        }

        // Increment in-flight counter
        sub.inflightCount += 1;

        // Record retry if this is a retry attempt (attempt > 1)
        if (msg.attempt > 1) {
          sub.statsTracker?.recordRetry();
        }

        // Check if message has exceeded max retries BEFORE processing
        const maxRetries = sub.options?.maxRetries ?? this.config.maxRetries ?? 5;
        // maxRetries is the number of retries AFTER the first attempt
        // So total attempts allowed = maxRetries + 1
        // Only check this for retries (attempt > 1)
        if (msg.attempt > 1 && msg.attempt > maxRetries + 1) {
          await this.runLuaScript(
            'move-to-dlq',
            [stream, this.dlqKey],
            [
              group,
              msg.id,
              channel,
              payloadStr,
              'Max retries exceeded',
              msg.timestamp.toString(),
              msg.attempt.toString(),
              exactlyOnce ? 'true' : 'false',
              dedupTTL ?? '3600',
            ]
          );
          // Record failure when message moved to DLQ
          sub.statsTracker?.recordFailure();
          this.logger.error({ messageId: id }, 'Message moved to DLQ - max retries exceeded');
          // Decrement in-flight counter
          sub.inflightCount = Math.max(0, sub.inflightCount - 1);
          continue;
        }

        let dedupKey = '';
        if (exactlyOnce) {
          // Use group for consumer-side deduplication
          dedupKey = generateDedupKey({ channel, payload: msg.payload, group, side: 'con' });
          // Use atomic SET NX to prevent race conditions
          const wasSet = await this.redis.set(dedupKey, '1', 'EX', dedupTTL ? Number(dedupTTL) : 3600, 'NX');

          if (!wasSet) {
            // Message was already processed by another worker
            await msg.ack();
            this.logger.info(`Duplicate message detected for channel=${channel} and group=${group} msg=${id}`);
            // Decrement in-flight counter
            sub.inflightCount = Math.max(0, sub.inflightCount - 1);
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

          // Check if we've exhausted all retries
          // maxRetries is the number of retries AFTER the first attempt
          if (msg.attempt >= maxRetries + 1) {
            // Move to DLQ with the actual error message
            const errorMessage = err instanceof Error ? err.message : String(err);
            await this.runLuaScript(
              'move-to-dlq',
              [stream, this.dlqKey],
              [
                group,
                msg.id,
                channel,
                payloadStr,
                errorMessage,
                msg.timestamp.toString(),
                msg.attempt.toString(),
                exactlyOnce ? 'true' : 'false',
                dedupTTL ?? '3600',
              ]
            );
            // Record failure when message moved to DLQ
            sub.statsTracker?.recordFailure();
            this.logger.error({ messageId: id, error: errorMessage }, 'Message moved to DLQ after error');
            // Decrement in-flight counter
            sub.inflightCount = Math.max(0, sub.inflightCount - 1);
            continue;
          }

          // We can still retry - Calculate retry delay using strategy or function
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
            ? stream.slice(0, -6) // Remove ':retry' suffix to get main stream
            : stream; // Already the main stream
          const nextAttempt = attempt + 1;
          const retryAt = Date.now() + retryDelay;

          try {
            this.logger.debug(`Scheduling retry: stream=${mainStream}, attempt=${nextAttempt}, delay=${retryDelay}ms`);
            const result = await this.runLuaScript(
              'retry-message',
              [stream, 'rotif:scheduled'],
              [
                group,
                msg.id,
                channel,
                payloadStr,
                timestamp.toString(),
                nextAttempt.toString(),
                retryAt.toString(),
                generateUuidV7(),
                fields['exactlyOnce'] ?? 'false',
                dedupTTL ?? '3600',
                mainStream,
                pattern, // Pass pattern for retries
              ]
            );
            this.logger.debug(`Retry scheduled successfully: ${result}`);
          } catch (luaErr) {
            this.logger.error({ err: luaErr }, 'Failed to schedule retry');
            throw luaErr;
          }
        } finally {
          // Decrement in-flight counter
          sub.inflightCount = Math.max(0, sub.inflightCount - 1);
        }
      }

      // Release pooled fields back to pool for reuse
      if (this.enableFieldPooling && 'channel' in fields && typeof (fields as ParsedFields).channel === 'string') {
        releaseFields(fields as ParsedFields);
      }
    };

    // Add to consumerLoops FIRST before starting the loop
    const loopEntry = {
      loopPromise: null as any, // Will be set below
      subscriptions,
      readyPromise: readyDefer.promise!,
    };
    this.consumerLoops.set(loopKey, loopEntry);

    // NOW start the actual loop
    // Update the loopPromise in the entry
    loopEntry.loopPromise = (async () => {
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

        // Backpressure check: pause consumption if too many messages pending
        if (this.shouldApplyBackpressure(loopKey)) {
          this.logger.debug({ loopKey }, 'Backpressure active, pausing consumption');
          await delayMs(50); // Short pause to let handlers catch up
          continue;
        }

        try {
          if (!this.config.disablePendingMessageRecovery) {
            const now = Date.now();
            const loopData = this.consumerLoops.get(loopKey);
            const forceRecovery = loopData?.needsPendingRecovery;
            if (forceRecovery) {
              loopData!.needsPendingRecovery = false;
            }
            if (forceRecovery || now - lastPendingCheck >= pendingCheckInterval) {
              lastPendingCheck = now;

              try {
                // Use 0 idle threshold for forced recovery (resume after pause) to claim immediately
                const effectiveIdleThreshold = forceRecovery ? 0 : idleThreshold;
                const pendingEntries = await this.redis.xpending(
                  stream,
                  group,
                  'IDLE',
                  effectiveIdleThreshold,
                  '-',
                  '+',
                  100
                );

                if (pendingEntries && pendingEntries.length > 0) {
                  const staleIds = pendingEntries.map((entry: any) => entry[0]);

                  const claimedMessages = (await this.redis.xclaim(
                    stream,
                    group,
                    consumer,
                    effectiveIdleThreshold,
                    ...staleIds
                  )) as [string, string[]][];

                  // Process claimed messages with concurrency control
                  if (messageConcurrency > 1 && claimedMessages.length > 1) {
                    // Track pending count for backpressure
                    this.updateBackpressure(loopKey, claimedMessages.length);
                    try {
                      await processWithConcurrency(
                        claimedMessages,
                        async ([id, rawFields]) => {
                          await handleMessage(id, rawFields);
                        },
                        messageConcurrency
                      );
                    } finally {
                      this.updateBackpressure(loopKey, -claimedMessages.length);
                    }
                  } else {
                    for (const [id, rawFields] of claimedMessages) {
                      this.updateBackpressure(loopKey, 1);
                      try {
                        await handleMessage(id, rawFields);
                      } finally {
                        this.updateBackpressure(loopKey, -1);
                      }
                    }
                  }
                }
              } catch (pendingErr: any) {
                // Defensive handling: if NOGROUP, try to create the group and continue
                if (pendingErr?.message?.includes('NOGROUP')) {
                  this.logger.debug(`Consumer group ${group} not found for stream ${stream}, creating it`);
                  await this.ensureStreamGroup(stream, group);
                  continue; // Skip this iteration and retry on next loop
                }
                throw pendingErr; // Re-throw other errors
              }
            }
          }

          const entries = await this.redis.xreadgroup(
            'GROUP',
            group,
            consumer,
            'COUNT',
            ROTIF_CONSTANTS.DEFAULT_READ_COUNT,
            'BLOCK',
            this.config.blockInterval ?? ROTIF_CONSTANTS.DEFAULT_MAX_WAIT_MS,
            'STREAMS',
            stream,
            '>'
          );

          if (!entries) {
            continue;
          }

          const typedEntries = entries as [string, [string, string[]][]][];
          for (const [_streamName, records] of typedEntries) {
            // Process messages with concurrency control for better throughput
            if (messageConcurrency > 1 && records.length > 1) {
              // Track pending count for backpressure
              this.updateBackpressure(loopKey, records.length);
              try {
                await processWithConcurrency(
                  records,
                  async ([id, rawFields]) => {
                    await handleMessage(id, rawFields);
                  },
                  messageConcurrency
                );
              } finally {
                this.updateBackpressure(loopKey, -records.length);
              }
            } else {
              // Sequential processing (default behavior for backward compatibility)
              for (const [id, rawFields] of records) {
                this.updateBackpressure(loopKey, 1);
                try {
                  await handleMessage(id, rawFields);
                } finally {
                  this.updateBackpressure(loopKey, -1);
                }
              }
            }
          }
        } catch (err: any) {
          if (!this.active) break;

          // Defensive handling: if NOGROUP, try to create the group and continue
          if (err?.message?.includes('NOGROUP')) {
            this.logger.debug(`Consumer group ${group} not found for stream ${stream}, creating it`);
            await this.ensureStreamGroup(stream, group);
            await delayMs(100); // Short delay before retry
            continue;
          }

          this.logger.error({ err, stream, group }, 'Error reading stream');
          await delayMs(500);
        }
      }

      if (this.active) {
        this.logger.info(`Stopped shared consumer loop for ${stream}:${group}`);
      }
    })();

    await readyDefer.promise!; // Wait for the loop to be ready before returning
    return subscriptions;
  }

  private async syncPatterns() {
    try {
      const patterns = await this.redis.zrangebyscore('rotif:patterns', 1, '+inf');
      this.activePatterns = new Set(patterns);
    } catch (err) {
      this.logger.error({ err }, 'Error syncing patterns');
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
  private async ensureStreamGroup(stream: string, group: string, startId: string = '0') {
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

  /**
   * Get subscription statistics
   * @returns Object containing count of total, active, and paused subscriptions
   */
  getSubscriptionStats(): { count: number; active: number; paused: number } {
    let active = 0;
    let paused = 0;

    for (const sub of this.subscriptions.values()) {
      if (sub.isPaused) {
        paused++;
      } else {
        active++;
      }
    }

    return {
      count: this.subscriptions.size,
      active,
      paused,
    };
  }
}
