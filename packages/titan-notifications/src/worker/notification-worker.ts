/**
 * Notification Worker Service
 *
 * Core consumer that processes notification events from Rotif (Redis Streams).
 * Orchestrates app-provided implementations:
 * - INotificationTargetResolver: resolves target user IDs
 * - INotificationPersister: persists notification records to DB
 * - INotificationRealtimeSignaler: signals real-time clients
 *
 * Handles: consumer group creation, XREADGROUP loop, XAUTOCLAIM for dead
 * consumer recovery, XACK on success, error handling with logging.
 */

import type { Redis } from 'ioredis';
import { Injectable } from '@omnitron-dev/titan/decorators';
import { Inject } from '@omnitron-dev/titan/decorators';
import type { ILogger } from '@omnitron-dev/titan/types';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { delay as delayMs } from '@omnitron-dev/common';
import type { NotificationEvent } from '../publisher.js';
import type {
  INotificationTargetResolver,
  INotificationPersister,
  INotificationRealtimeSignaler,
  NotificationRecord,
} from './worker.interfaces.js';
import {
  NOTIFICATION_TARGET_RESOLVER,
  NOTIFICATION_PERSISTER,
  NOTIFICATION_REALTIME_SIGNALER,
} from './worker.tokens.js';

/** Default stream channel pattern for notification events */
const DEFAULT_STREAM_PATTERN = 'notify.*';

/** Default consumer group name */
const DEFAULT_GROUP_NAME = 'notification-workers';

/** Default block timeout for XREADGROUP in milliseconds */
const DEFAULT_BLOCK_TIMEOUT_MS = 5000;

/** Default batch size for XREADGROUP COUNT */
const DEFAULT_READ_COUNT = 100;

/** Default idle threshold for XAUTOCLAIM in milliseconds (5 minutes) */
const DEFAULT_AUTOCLAIM_IDLE_MS = 5 * 60 * 1000;

/** Default interval for XAUTOCLAIM checks in milliseconds (60 seconds) */
const DEFAULT_AUTOCLAIM_INTERVAL_MS = 60 * 1000;

export interface NotificationWorkerOptions {
  /** Rotif stream pattern (default: 'notify.*') */
  streamPattern?: string;
  /** Consumer group name (default: 'notification-workers') */
  groupName?: string;
  /** Unique consumer name (default: hostname + pid) */
  consumerName?: string;
  /** Block timeout for XREADGROUP in ms (default: 5000) */
  blockTimeoutMs?: number;
  /** Max messages per XREADGROUP batch (default: 100) */
  readCount?: number;
  /** Idle threshold for XAUTOCLAIM in ms (default: 300000 = 5 min) */
  autoclaimIdleMs?: number;
  /** Interval for XAUTOCLAIM checks in ms (default: 60000 = 1 min) */
  autoclaimIntervalMs?: number;
}

@Injectable()
export class NotificationWorkerService {
  private redis!: Redis;
  private active = false;
  private loopPromise: Promise<void> | null = null;
  private autoclaimTimer: ReturnType<typeof setInterval> | null = null;

  private streamKey!: string;
  private groupName!: string;
  private consumerName!: string;
  private blockTimeoutMs!: number;
  private readCount!: number;
  private autoclaimIdleMs!: number;
  private autoclaimIntervalMs!: number;

  constructor(
    @Inject(NOTIFICATION_TARGET_RESOLVER) private readonly targetResolver: INotificationTargetResolver,
    @Inject(NOTIFICATION_PERSISTER) private readonly persister: INotificationPersister,
    @Inject(NOTIFICATION_REALTIME_SIGNALER) private readonly signaler: INotificationRealtimeSignaler,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerService: ILoggerModule
  ) {}

  private get logger(): ILogger {
    return this.loggerService.logger;
  }

  /**
   * Start the notification worker consumer loop.
   *
   * @param redis - ioredis client instance (caller owns the connection)
   * @param options - Worker configuration overrides
   */
  async start(redis: Redis, options: NotificationWorkerOptions = {}): Promise<void> {
    if (this.active) {
      this.logger.warn('NotificationWorkerService is already running');
      return;
    }

    this.redis = redis;
    this.active = true;

    const pattern = options.streamPattern ?? DEFAULT_STREAM_PATTERN;
    this.streamKey = `rotif:stream:${pattern}`;
    this.groupName = options.groupName ?? DEFAULT_GROUP_NAME;
    this.consumerName = options.consumerName ?? `worker-${process.pid}-${Date.now()}`;
    this.blockTimeoutMs = options.blockTimeoutMs ?? DEFAULT_BLOCK_TIMEOUT_MS;
    this.readCount = options.readCount ?? DEFAULT_READ_COUNT;
    this.autoclaimIdleMs = options.autoclaimIdleMs ?? DEFAULT_AUTOCLAIM_IDLE_MS;
    this.autoclaimIntervalMs = options.autoclaimIntervalMs ?? DEFAULT_AUTOCLAIM_INTERVAL_MS;

    // Ensure consumer group exists (MKSTREAM creates the stream if absent)
    await this.ensureConsumerGroup();

    // Recover dead consumer messages on startup
    await this.runAutoclaim();

    // Start periodic autoclaim
    this.autoclaimTimer = setInterval(() => {
      this.runAutoclaim().catch((err) => {
        this.logger.error({ err }, 'XAUTOCLAIM periodic check failed');
      });
    }, this.autoclaimIntervalMs);

    // Start the main consume loop
    this.loopPromise = this.consumeLoop();

    this.logger.info(
      {
        streamKey: this.streamKey,
        groupName: this.groupName,
        consumerName: this.consumerName,
      },
      'NotificationWorkerService started'
    );
  }

  /**
   * Gracefully stop the worker.
   */
  async stop(): Promise<void> {
    if (!this.active) return;

    this.active = false;

    if (this.autoclaimTimer) {
      clearInterval(this.autoclaimTimer);
      this.autoclaimTimer = null;
    }

    // Wait for the consume loop to exit (it checks `this.active` each iteration)
    if (this.loopPromise) {
      await Promise.race([this.loopPromise, delayMs(10_000)]);
      this.loopPromise = null;
    }

    this.logger.info('NotificationWorkerService stopped');
  }

  // ---------------------------------------------------------------------------
  // Consumer group management
  // ---------------------------------------------------------------------------

  private async ensureConsumerGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', this.streamKey, this.groupName, '0', 'MKSTREAM');
      this.logger.debug({ streamKey: this.streamKey, groupName: this.groupName }, 'Consumer group created');
    } catch (err: any) {
      // BUSYGROUP means the group already exists — safe to ignore
      if (!err?.message?.includes('BUSYGROUP')) {
        throw err;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main consume loop
  // ---------------------------------------------------------------------------

  private async consumeLoop(): Promise<void> {
    while (this.active) {
      try {
        const entries = (await this.redis.xreadgroup(
          'GROUP',
          this.groupName,
          this.consumerName,
          'COUNT',
          this.readCount,
          'BLOCK',
          this.blockTimeoutMs,
          'STREAMS',
          this.streamKey,
          '>'
        )) as [string, [string, string[]][]][] | null;

        if (!entries || entries.length === 0) {
          continue;
        }

        for (const [, messages] of entries) {
          for (const [messageId, fields] of messages) {
            await this.handleMessage(messageId, fields);
          }
        }
      } catch (err: any) {
        if (!this.active) break;

        // If consumer group was destroyed externally, re-create it
        if (err?.message?.includes('NOGROUP')) {
          this.logger.warn('Consumer group not found, re-creating');
          await this.ensureConsumerGroup();
          await delayMs(100);
          continue;
        }

        this.logger.error({ err }, 'Error in notification worker consume loop');
        await delayMs(1000);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  private async handleMessage(messageId: string, rawFields: string[]): Promise<void> {
    let event: NotificationEvent;

    try {
      event = this.parseFields(rawFields);
    } catch (err) {
      this.logger.error({ err, messageId }, 'Failed to parse notification event, ACKing to prevent redelivery');
      await this.ack(messageId);
      return;
    }

    try {
      await this.processEvent(event);
      await this.ack(messageId);
    } catch (err) {
      this.logger.error(
        { err, messageId, channel: event.channel, type: event.type },
        'Failed to process notification event'
      );
      // Do NOT ack — the message stays in the PEL and will be picked up
      // by XAUTOCLAIM after the idle threshold expires.
    }
  }

  /**
   * Parse raw XREADGROUP field array into a NotificationEvent.
   *
   * Rotif stores messages as flat key-value pairs:
   *   ['channel', '...', 'payload', '...', 'timestamp', '...', 'attempt', '...']
   *
   * The actual NotificationEvent is JSON-encoded inside the 'payload' field.
   */
  private parseFields(rawFields: string[]): NotificationEvent {
    const map: Record<string, string> = {};
    for (let i = 0; i < rawFields.length; i += 2) {
      map[rawFields[i]!] = rawFields[i + 1]!;
    }

    const payloadStr = map['payload'];
    if (!payloadStr) {
      throw new Error('Missing payload field in stream message');
    }

    return JSON.parse(payloadStr) as NotificationEvent;
  }

  /**
   * Core processing pipeline for a notification event.
   *
   * 1. Resolve target users via app-provided INotificationTargetResolver
   * 2. Build NotificationRecord objects
   * 3. Persist to DB via app-provided INotificationPersister
   * 4. Signal real-time clients via app-provided INotificationRealtimeSignaler
   */
  private async processEvent(event: NotificationEvent): Promise<void> {
    // 1. Resolve target users
    const userIds = await this.targetResolver.resolveUsers(event);

    if (userIds.length === 0) {
      this.logger.debug({ channel: event.channel, type: event.type }, 'No target users resolved, skipping');
      return;
    }

    // 2. Build notification records
    const now = new Date();
    const records: NotificationRecord[] = userIds.map((userId) => ({
      userId,
      type: event.type,
      category: event.category,
      title: event.title,
      body: event.body,
      icon: event.icon,
      image: event.image,
      actionType: event.action?.type,
      actionUrl: event.action?.url,
      actionData: event.action?.data,
      channelsInApp: true,
      channelsPush: false,
      channelsEmail: false,
      status: 'delivered',
      priority: event.priority ?? 'normal',
      sourceApp: event.sourceApp,
      sourceEventId: event.sourceEventId,
      groupKey: event.groupKey,
      data: event.data,
      dedupKey: event.deduplicationKey ? `${event.deduplicationKey}:${userId}` : undefined,
      expiresAt: event.ttlMs ? new Date(now.getTime() + event.ttlMs) : undefined,
      createdAt: now,
    }));

    // 3. Persist to DB
    const persisted = await this.persister.persistBatch(records);

    this.logger.debug(
      { channel: event.channel, type: event.type, userCount: userIds.length, persistedCount: persisted.length },
      'Notification records persisted'
    );

    // 4. Signal real-time clients
    if (userIds.length === 1) {
      await this.signaler.signal(userIds[0]!);
    } else {
      await this.signaler.signalBatch(userIds);
    }
  }

  // ---------------------------------------------------------------------------
  // XAUTOCLAIM — recover messages from dead/stalled consumers
  // ---------------------------------------------------------------------------

  private async runAutoclaim(): Promise<void> {
    let startId = '0-0';
    let totalClaimed = 0;

    try {
      // XAUTOCLAIM loops until the returned cursor is '0-0'
      while (this.active) {
        const result = (await this.redis.xautoclaim(
          this.streamKey,
          this.groupName,
          this.consumerName,
          this.autoclaimIdleMs,
          startId,
          'COUNT',
          this.readCount
        )) as [string, [string, string[]][], string[]];

        const [nextStartId, messages, _deletedIds] = result;

        if (messages.length === 0) {
          break;
        }

        for (const [messageId, fields] of messages) {
          await this.handleMessage(messageId, fields);
        }

        totalClaimed += messages.length;

        // '0-0' means we've scanned the entire PEL
        if (nextStartId === '0-0') {
          break;
        }

        startId = nextStartId;
      }

      if (totalClaimed > 0) {
        this.logger.info({ totalClaimed }, 'XAUTOCLAIM recovered dead consumer messages');
      }
    } catch (err: any) {
      // NOGROUP is possible if the stream/group was just created
      if (!err?.message?.includes('NOGROUP')) {
        this.logger.error({ err }, 'XAUTOCLAIM failed');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ack(messageId: string): Promise<void> {
    await this.redis.xack(this.streamKey, this.groupName, messageId);
  }
}
