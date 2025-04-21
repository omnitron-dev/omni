import { Redis } from 'ioredis';

/**
 * Interface for deduplication stores.
 * Provides methods to check for duplicates and mark messages as processed.
 * @interface DedupStore
 */
export interface DedupStore {
  /**
   * Checks if a message is a duplicate.
   * @param {string} id - Message ID
   * @param {string} channel - Channel name
   * @returns {Promise<boolean>} True if the message is a duplicate
   */
  isDuplicate(id: string, channel: string): Promise<boolean>;

  /**
   * Marks a message as processed.
   * @param {string} id - Message ID
   * @param {string} channel - Channel name
   */
  markProcessed(id: string, channel: string): Promise<void>;
}

/**
 * In-memory implementation of DedupStore.
 * Uses a Map to store processed message IDs with a maximum size limit.
 * @class InMemoryDedupStore
 * @implements {DedupStore}
 */
export class InMemoryDedupStore implements DedupStore {
  /** Maximum number of message IDs to store per channel */
  private readonly maxSize = 10000;
  /** Map of channel names to sets of processed message IDs */
  private store = new Map<string, Set<string>>();

  /**
   * Checks if a message is a duplicate.
   * @param {string} id - Message ID
   * @param {string} channel - Channel name
   * @returns {Promise<boolean>} True if the message is a duplicate
   */
  async isDuplicate(id: string, channel: string): Promise<boolean> {
    const set = this.store.get(channel);
    return set ? set.has(id) : false;
  }

  /**
   * Marks a message as processed.
   * If the set exceeds maxSize, removes the oldest message ID.
   * @param {string} id - Message ID
   * @param {string} channel - Channel name
   */
  async markProcessed(id: string, channel: string): Promise<void> {
    let set = this.store.get(channel);
    if (!set) {
      set = new Set();
      this.store.set(channel, set);
    }
    set.add(id);
    if (set.size > this.maxSize) {
      const oldest = set.values().next().value;
      if (oldest) {
        set.delete(oldest);
      }
    }
  }
}

/**
 * Redis-based implementation of DedupStore.
 * Uses Redis keys with TTL to store processed message IDs.
 * @class RedisDedupStore
 * @implements {DedupStore}
 */
export class RedisDedupStore implements DedupStore {
  /**
   * Creates a new RedisDedupStore instance.
   * @param {Redis} redis - Redis client
   * @param {number} [ttlSeconds=3600] - TTL in seconds for stored keys
   */
  constructor(private redis: Redis, private ttlSeconds = 3600) { }

  /**
   * Generates a Redis key for a message.
   * @private
   * @param {string} channel - Channel name
   * @param {string} id - Message ID
   * @returns {string} Redis key
   */
  private key(channel: string, id: string) {
    return `rotif:dedup:${channel}:${id}`;
  }

  /**
   * Checks if a message is a duplicate.
   * @param {string} id - Message ID
   * @param {string} channel - Channel name
   * @returns {Promise<boolean>} True if the message is a duplicate
   */
  async isDuplicate(id: string, channel: string): Promise<boolean> {
    return !!(await this.redis.exists(this.key(channel, id)));
  }

  /**
   * Marks a message as processed.
   * Stores the message ID in Redis with the configured TTL.
   * @param {string} id - Message ID
   * @param {string} channel - Channel name
   */
  async markProcessed(id: string, channel: string): Promise<void> {
    await this.redis.set(this.key(channel, id), '1', 'EX', this.ttlSeconds);
  }
}
