/**
 * Priceverse 2.0 - Extended Redis Service
 * Wraps Titan's RedisService to provide Redis Streams and additional operations
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';

// Raw ioredis client type
type RedisClient = {
  xadd(key: string, id: string, ...args: string[]): Promise<string | null>;
  xgroup(subcommand: string, ...args: (string | number)[]): Promise<unknown>;
  xreadgroup(...args: (string | number)[]): Promise<unknown>;
  xack(key: string, group: string, ...ids: string[]): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | null>;
  setex(key: string, ttl: number, value: string): Promise<string>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  duplicate(): RedisClient;
  status: string;
};

/**
 * Extended Redis Service with Redis Streams support
 * Uses the raw ioredis client for operations not exposed by Titan's RedisService
 */
@Injectable({ scope: 'singleton' })
export class ExtendedRedisService {
  private client: RedisClient;

  constructor(@Inject(RedisService) private readonly redisService: RedisService) {
    // Get the raw ioredis client which has all methods including Streams
    this.client = this.redisService.getClient() as unknown as RedisClient;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Health & Connectivity
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ping Redis to check connectivity
   */
  async ping(): Promise<boolean> {
    return this.redisService.ping();
  }

  /**
   * Check if Redis is ready
   */
  isReady(): boolean {
    return this.redisService.isReady();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Redis Streams Operations (for trade collection)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add entry to a stream
   */
  async xadd(
    key: string,
    id: string,
    fields: Record<string, string>
  ): Promise<string | null> {
    const args = Object.entries(fields).flat();
    return this.client.xadd(key, id, ...args);
  }

  /**
   * Create a consumer group
   */
  async xgroup(
    command: 'CREATE' | 'DESTROY' | 'SETID',
    key: string,
    group: string,
    id: string,
    mkstream?: 'MKSTREAM'
  ): Promise<unknown> {
    if (mkstream) {
      return this.client.xgroup(command, key, group, id, mkstream);
    }
    return this.client.xgroup(command, key, group, id);
  }

  /**
   * Read from a consumer group
   */
  async xreadgroup(
    group: string,
    consumer: string,
    count: number,
    block: number,
    ...streams: string[]
  ): Promise<Array<[string, Array<[string, Record<string, string>]>]> | null> {
    const result = await this.client.xreadgroup(
      'GROUP',
      group,
      consumer,
      'COUNT',
      count,
      'BLOCK',
      block,
      'STREAMS',
      ...streams
    ) as Array<[string, Array<[string, string[]]>]> | null;

    if (!result) return null;

    // Transform to expected format
    return result.map(([streamKey, entries]) => [
      streamKey,
      entries.map(([id, fields]) => {
        const fieldsObj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          fieldsObj[fields[i]] = fields[i + 1];
        }
        return [id, fieldsObj] as [string, Record<string, string>];
      }),
    ]);
  }

  /**
   * Acknowledge a message in a consumer group
   */
  async xack(key: string, group: string, id: string): Promise<number> {
    return this.client.xack(key, group, id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sorted Set Operations (for trade buffering)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add member to sorted set
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.client.zadd(key, score, member);
  }

  /**
   * Get members by score range
   */
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string
  ): Promise<string[]> {
    return this.client.zrangebyscore(key, min, max);
  }

  /**
   * Remove members by score range
   */
  async zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string
  ): Promise<number> {
    return this.client.zremrangebyscore(key, min, max);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // String Operations (for caching)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a value
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Set a value with expiration
   */
  async setex(key: string, ttl: number, value: string): Promise<string> {
    return this.client.setex(key, ttl, value);
  }

  /**
   * Set a value
   */
  async set(key: string, value: string): Promise<string | null> {
    return this.client.set(key, value);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pub/Sub Operations (for real-time updates)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(channel: string): Promise<void> {
    await this.client.subscribe(channel);
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string): Promise<void> {
    await this.client.unsubscribe(channel);
  }

  /**
   * Listen for events
   */
  on(event: string, callback: (...args: unknown[]) => void): void {
    this.client.on(event, callback);
  }

  /**
   * Create a duplicate connection for pub/sub
   */
  duplicate(): ExtendedRedisService {
    // Create a new instance that wraps a duplicated client
    const duplicateClient = this.client.duplicate();
    const wrapper = Object.create(ExtendedRedisService.prototype) as ExtendedRedisService;
    (wrapper as unknown as { client: RedisClient }).client = duplicateClient;
    (wrapper as unknown as { redisService: RedisService }).redisService = this.redisService;
    return wrapper;
  }

  /**
   * Get the raw ioredis client for advanced operations
   */
  getRawClient(): RedisClient {
    return this.client;
  }
}
