/**
 * DLQ (Dead Letter Queue) management for Rotif
 */

import type { Redis } from 'ioredis';
import type { RotifLogger } from './types.js';
import { parseFields } from './utils/common.js';

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
    messagesArchived: 0
  };

  constructor(
    private redis: Redis,
    private logger: RotifLogger,
    private config: DLQCleanupConfig = {}
  ) {
    this.config = {
      enabled: false,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days default
      maxSize: 10000,
      cleanupInterval: 60 * 60 * 1000, // 1 hour default
      batchSize: 100,
      archiveBeforeDelete: false,
      archivePrefix: 'rotif:dlq:archive',
      ...config
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
    this.cleanup().catch(err => {
      this.logger.error('DLQ cleanup error:', err);
    });

    // Schedule periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(err => {
        this.logger.error('DLQ cleanup error:', err);
      });
    }, this.config.cleanupInterval!);

    this.logger.info(`DLQ auto-cleanup started (interval: ${this.config.cleanupInterval}ms)`);
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
   * Perform DLQ cleanup
   */
  async cleanup(): Promise<number> {
    const dlqKey = 'rotif:dlq';
    let cleanedCount = 0;

    try {
      // Get current time for age calculation
      const now = Date.now();

      // Process in batches
      let hasMore = true;
      while (hasMore) {
        // Read a batch of messages
        const messages = await this.redis.xrange(
          dlqKey,
          '-',
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

        // Delete old messages
        if (toDelete.length > 0) {
          await this.redis.xdel(dlqKey, ...toDelete);
          cleanedCount += toDelete.length;
          this.stats.messagesCleanedUp += toDelete.length;

          this.logger.info(`Cleaned up ${toDelete.length} messages from DLQ`);
        }

        // Check if we've processed enough
        if (messages.length < this.config.batchSize!) {
          hasMore = false;
        }
      }

      // Check size limit
      await this.enforceMaxSize();

    } catch (err) {
      this.logger.error('DLQ cleanup failed:', err);
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
        archivedAt: Date.now()
      };

      pipeline.rpush(archiveKey, JSON.stringify(archiveData));
    }

    // Set expiry on archive (30 days)
    pipeline.expire(archiveKey, 30 * 24 * 60 * 60);

    await pipeline.exec();
    this.stats.messagesArchived += messages.length;

    this.logger.info(`Archived ${messages.length} messages from DLQ`);
  }

  /**
   * Enforce maximum DLQ size
   */
  private async enforceMaxSize(): Promise<void> {
    const dlqKey = 'rotif:dlq';

    // Get current size
    const size = await this.redis.xlen(dlqKey);

    if (size > this.config.maxSize!) {
      const toTrim = size - this.config.maxSize!;

      // Get oldest messages to remove
      const messages = await this.redis.xrange(
        dlqKey,
        '-',
        '+',
        'COUNT',
        toTrim
      );

      if (messages && messages.length > 0) {
        const ids = messages.map(([id]) => id);

        // Archive if configured
        if (this.config.archiveBeforeDelete) {
          await this.archiveMessages(messages.map(([id, fields]) => ({ id, fields })));
        }

        // Delete messages
        await this.redis.xdel(dlqKey, ...ids);
        this.stats.messagesCleanedUp += ids.length;

        this.logger.info(`Trimmed ${ids.length} messages from DLQ to enforce max size`);
      }
    }
  }

  /**
   * Get DLQ statistics
   */
  async getStats(): Promise<DLQStats> {
    const dlqKey = 'rotif:dlq';

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
        const batch = await this.redis.xrange(
          dlqKey,
          lastId === '-' ? '-' : `(${lastId}`,
          '+',
          'COUNT',
          100
        );

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
        messagesArchived: this.stats.messagesArchived
      };
    } catch (err) {
      this.logger.error('Failed to get DLQ stats:', err);
      throw err;
    }
  }

  /**
   * Get messages from DLQ with filtering options
   */
  async getMessages(options: {
    channel?: string;
    limit?: number;
    offset?: number;
    maxAge?: number;
  } = {}): Promise<DLQMessageInfo[]> {
    const dlqKey = 'rotif:dlq';
    const { limit = 100, offset = 0, channel, maxAge } = options;

    try {
      // Get all messages (we'll filter in memory for now)
      const messages = await this.redis.xrange(dlqKey, '-', '+');

      const now = Date.now();
      let filtered: DLQMessageInfo[] = [];

      for (const [id, fields] of messages) {
        const fieldsObj = parseFields(fields as string[]);
        const timestamp = parseInt(fieldsObj['timestamp'] || '0');
        const age = now - timestamp;

        // Apply filters
        if (channel && fieldsObj['channel'] !== channel) continue;
        if (maxAge && age > maxAge) continue;

        filtered.push({
          id,
          channel: fieldsObj['channel'] || 'unknown',
          payload: JSON.parse(fieldsObj['payload'] || '{}'),
          error: fieldsObj['error'],
          timestamp,
          attempt: parseInt(fieldsObj['attempt'] || '0'),
          age
        });
      }

      // Apply pagination
      return filtered.slice(offset, offset + limit);

    } catch (err) {
      this.logger.error('Failed to get DLQ messages:', err);
      throw err;
    }
  }

  /**
   * Clear all messages from DLQ
   */
  async clear(): Promise<void> {
    const dlqKey = 'rotif:dlq';
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