/**
 * DLQ (Dead Letter Queue) management for Rotif
 */

import type { Redis } from 'ioredis';
import type { ILogger } from '@omnitron-dev/titan/types';
import { parseFields } from './utils.js';

/**
 * DLQ cleanup configuration
 */
export interface DLQCleanupConfig {
  /** Enable auto-cleanup */
  enabled?: boolean;
  /** Maximum age of messages to keep in DLQ (in milliseconds) */
  maxAge?: number;
  /** Maximum number of messages to keep in DLQ */
  maxSize?: number;
  /** Interval between cleanup runs (in milliseconds) */
  cleanupInterval?: number;
  /** Batch size for cleanup operations */
  batchSize?: number;
  /** Archive messages before deletion */
  archiveBeforeDelete?: boolean;
  /** Archive destination (Redis key prefix) */
  archivePrefix?: string;
}

/**
 * DLQ message info
 */
export interface DLQMessageInfo {
  id: string;
  channel: string;
  payload: any;
  error?: string;
  timestamp: number;
  attempt: number;
  age: number;
}

/**
 * DLQ statistics
 */
export interface DLQStats {
  /** Total number of messages in DLQ */
  totalMessages: number;
  /** Number of messages by channel */
  messagesByChannel: Record<string, number>;
  /** Oldest message timestamp */
  oldestMessage?: number;
  /** Newest message timestamp */
  newestMessage?: number;
  /** Number of messages cleaned up */
  messagesCleanedUp: number;
  /** Number of messages archived */
  messagesArchived: number;
}

/**
 * Manages DLQ operations including cleanup and monitoring
 */
export class DLQManager {
  private cleanupTimer?: NodeJS.Timeout;
  private stats: DLQStats = {
    totalMessages: 0,
    messagesByChannel: {},
    messagesCleanedUp: 0,
    messagesArchived: 0,
  };
  private dlqKey: string;

  constructor(
    private redis: Redis,
    private logger: ILogger,
    private config: DLQCleanupConfig = {},
    dlqKey: string = 'rotif:dlq'
  ) {
    this.dlqKey = dlqKey;
    this.config = {
      enabled: false,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days default
      maxSize: 10000,
      cleanupInterval: 60 * 60 * 1000, // 1 hour default
      batchSize: 100,
      archiveBeforeDelete: false,
      archivePrefix: 'rotif:dlq:archive',
      ...config,
    };
  }

  /**
   * Start automatic DLQ cleanup
   */
  startAutoCleanup(): void {
    if (!this.config.enabled) {
      return;
    }

    // Clear existing timer if any
    this.stopAutoCleanup();

    // Run initial cleanup
    this.cleanup().catch((err) => {
      this.logger.error({ err }, 'DLQ cleanup error');
    });

    // Schedule periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch((err) => {
        this.logger.error({ err }, 'DLQ cleanup error');
      });
    }, this.config.cleanupInterval!);

    this.logger.info({ interval: this.config.cleanupInterval }, 'DLQ auto-cleanup started');
  }

  /**
   * Stop automatic DLQ cleanup
   */
  stopAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
      this.logger.info('DLQ auto-cleanup stopped');
    }
  }

  /**
   * Perform DLQ cleanup.
   * Uses pipelining for batch deletions to reduce Redis roundtrips.
   */
  async cleanup(): Promise<number> {
    const dlqKey = this.dlqKey;
    let cleanedCount = 0;

    try {
      // Get current time for age calculation
      const now = Date.now();
      let lastId = '-';

      // Process in batches with cursor-based pagination
      let hasMore = true;
      while (hasMore) {
        // Read a batch of messages using cursor to avoid re-scanning
        const messages = await this.redis.xrange(
          dlqKey,
          lastId === '-' ? '-' : `(${lastId}`,
          '+',
          'COUNT',
          this.config.batchSize!
        );

        if (!messages || messages.length === 0) {
          hasMore = false;
          break;
        }

        const toDelete: string[] = [];
        const toArchive: Array<{ id: string; fields: any }> = [];

        for (const [id, fields] of messages) {
          lastId = id; // Update cursor
          const fieldsObj = parseFields(fields as string[]);
          const timestamp = parseInt(fieldsObj['timestamp'] || '0');
          const age = now - timestamp;

          // Check if message should be cleaned up
          const shouldDelete = age > this.config.maxAge!;

          if (shouldDelete) {
            if (this.config.archiveBeforeDelete) {
              toArchive.push({ id, fields });
            }
            toDelete.push(id);
          }
        }

        // Archive messages if configured
        if (toArchive.length > 0 && this.config.archiveBeforeDelete) {
          await this.archiveMessages(toArchive);
        }

        // Delete old messages using pipeline for better performance
        if (toDelete.length > 0) {
          // Use pipeline for batch deletion (reduces roundtrips by ~90%)
          const pipeline = this.redis.pipeline();
          // XDEL supports multiple IDs in a single call
          pipeline.xdel(dlqKey, ...toDelete);
          await pipeline.exec();

          cleanedCount += toDelete.length;
          this.stats.messagesCleanedUp += toDelete.length;

          this.logger.info({ count: toDelete.length }, 'Cleaned up messages from DLQ');
        }

        // Check if we've processed enough
        if (messages.length < this.config.batchSize!) {
          hasMore = false;
        }
      }

      // Check size limit
      await this.enforceMaxSize();
    } catch (err) {
      this.logger.error({ err }, 'DLQ cleanup failed');
      throw err;
    }

    return cleanedCount;
  }

  /**
   * Archive messages before deletion
   */
  private async archiveMessages(messages: Array<{ id: string; fields: any }>): Promise<void> {
    const pipeline = this.redis.pipeline();
    const archiveKey = `${this.config.archivePrefix}:${new Date().toISOString().split('T')[0]}`;

    for (const { id, fields } of messages) {
      const fieldsObj = parseFields(fields as string[]);
      const archiveData = {
        id,
        ...fieldsObj,
        archivedAt: Date.now(),
      };

      pipeline.rpush(archiveKey, JSON.stringify(archiveData));
    }

    // Set expiry on archive (30 days)
    pipeline.expire(archiveKey, 30 * 24 * 60 * 60);

    await pipeline.exec();
    this.stats.messagesArchived += messages.length;

    this.logger.info({ count: messages.length }, 'Archived messages from DLQ');
  }

  /**
   * Enforce maximum DLQ size.
   * Uses pipelining for efficient bulk operations.
   */
  private async enforceMaxSize(): Promise<void> {
    const dlqKey = this.dlqKey;

    // Get current size
    const size = await this.redis.xlen(dlqKey);

    if (size > this.config.maxSize!) {
      const toTrim = size - this.config.maxSize!;

      // Get oldest messages to remove
      const messages = await this.redis.xrange(dlqKey, '-', '+', 'COUNT', toTrim);

      if (messages && messages.length > 0) {
        const ids = messages.map(([id]) => id);

        // Archive if configured
        if (this.config.archiveBeforeDelete) {
          await this.archiveMessages(messages.map(([id, fields]) => ({ id, fields })));
        }

        // Delete messages using pipeline for better performance
        const pipeline = this.redis.pipeline();
        pipeline.xdel(dlqKey, ...ids);
        await pipeline.exec();

        this.stats.messagesCleanedUp += ids.length;

        this.logger.info({ count: ids.length }, 'Trimmed messages from DLQ to enforce max size');
      }
    }
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    const dlqKey = this.dlqKey;

    try {
      // Get total count
      const totalMessages = await this.redis.xlen(dlqKey);

      // Get first and last messages for timestamps
      const first = await this.redis.xrange(dlqKey, '-', '+', 'COUNT', 1);
      const last = await this.redis.xrevrange(dlqKey, '+', '-', 'COUNT', 1);

      // Count by channel
      const messagesByChannel: Record<string, number> = {};

      // Process in batches to count channels
      let lastId = '-';
      let hasMore = true;

      while (hasMore) {
        const batch = await this.redis.xrange(dlqKey, lastId === '-' ? '-' : `(${lastId}`, '+', 'COUNT', 100);

        if (!batch || batch.length === 0) {
          hasMore = false;
          break;
        }

        for (const [id, fields] of batch) {
          const fieldsObj = parseFields(fields as string[]);
          const channel = fieldsObj['channel'] || 'unknown';
          messagesByChannel[channel] = (messagesByChannel[channel] || 0) + 1;
          lastId = id;
        }

        if (batch.length < 100) {
          hasMore = false;
        }
      }

      return {
        totalMessages,
        messagesByChannel,
        oldestMessage: first[0] ? parseInt(parseFields(first[0][1] as string[])['timestamp'] || '0') : undefined,
        newestMessage: last[0] ? parseInt(parseFields(last[0][1] as string[])['timestamp'] || '0') : undefined,
        messagesCleanedUp: this.stats.messagesCleanedUp,
        messagesArchived: this.stats.messagesArchived,
      };
    } catch (err) {
      this.logger.error({ err }, 'Failed to get DLQ stats');
      throw err;
    }
  }

  /**
   * Get messages from DLQ with filtering options.
   * Uses streaming pagination to avoid loading all messages into memory.
   */
  async getMessages(
    options: {
      channel?: string;
      limit?: number;
      offset?: number;
      maxAge?: number;
    } = {}
  ): Promise<DLQMessageInfo[]> {
    const dlqKey = this.dlqKey;
    const { limit = 100, offset = 0, channel, maxAge } = options;

    try {
      const now = Date.now();
      const filtered: DLQMessageInfo[] = [];
      let skipped = 0;
      let lastId = '-';
      const batchSize = 100; // Process in batches to reduce memory pressure

      // Stream through messages in batches instead of loading all at once
      // This is more memory-efficient for large DLQs
      while (filtered.length < limit) {
        const messages = await this.redis.xrange(dlqKey, lastId === '-' ? '-' : `(${lastId}`, '+', 'COUNT', batchSize);

        if (!messages || messages.length === 0) {
          break;
        }

        for (const [id, fields] of messages) {
          lastId = id;
          const fieldsObj = parseFields(fields as string[]);
          const timestamp = parseInt(fieldsObj['timestamp'] || '0');
          const age = now - timestamp;

          // Apply filters
          if (channel && fieldsObj['channel'] !== channel) continue;
          if (maxAge && age > maxAge) continue;

          // Handle offset (skip first N matching messages)
          if (skipped < offset) {
            skipped++;
            continue;
          }

          // Stop if we have enough messages
          if (filtered.length >= limit) {
            break;
          }

          let payload = {};
          try {
            payload = JSON.parse(fieldsObj['payload'] || '{}');
          } catch {
            // If payload is not valid JSON, default to empty object
            payload = {};
          }

          filtered.push({
            id,
            channel: fieldsObj['channel'] || 'unknown',
            payload,
            error: fieldsObj['error'],
            timestamp,
            attempt: parseInt(fieldsObj['attempt'] || '0'),
            age,
          });
        }

        // If we got fewer messages than batch size, we've reached the end
        if (messages.length < batchSize) {
          break;
        }
      }

      return filtered;
    } catch (err) {
      this.logger.error({ err }, 'Failed to get DLQ messages');
      throw err;
    }
  }

  /**
   * Clear all messages from DLQ
   */
  async clear(): Promise<void> {
    const dlqKey = this.dlqKey;
    await this.redis.del(dlqKey);
    this.logger.info('DLQ cleared');
  }

  /**
   * Get cleanup configuration
   */
  getConfig(): DLQCleanupConfig {
    return { ...this.config };
  }

  /**
   * Update cleanup configuration
   */
  updateConfig(config: Partial<DLQCleanupConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart auto-cleanup if it was running
    if (this.cleanupTimer && this.config.enabled) {
      this.startAutoCleanup();
    } else if (!this.config.enabled) {
      this.stopAutoCleanup();
    }
  }
}
