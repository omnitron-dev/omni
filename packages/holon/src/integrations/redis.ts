/**
 * Redis integration for caching and pub/sub
 */

import type { RedisConfig } from '../types.js';
import Redis from 'ioredis';

/**
 * Redis client wrapper
 */
export class RedisClient {
  private readonly client: Redis;
  private readonly config: RedisConfig;

  constructor(config: RedisConfig) {
    this.config = config;
    this.client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db ?? 0,
      keyPrefix: config.prefix,
    });
  }

  /**
   * Set a value
   */
  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      await this.client.setex(key, ttl, serialized);
    } else {
      await this.client.set(key, serialized);
    }
  }

  /**
   * Get a value
   */
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) {
      return null;
    }
    return JSON.parse(value) as T;
  }

  /**
   * Delete a key
   */
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  /**
   * Publish message
   */
  async publish(channel: string, message: unknown): Promise<void> {
    const serialized = JSON.stringify(message);
    await this.client.publish(channel, serialized);
  }

  /**
   * Subscribe to channel
   */
  async subscribe(
    channel: string,
    handler: (message: unknown) => void
  ): Promise<void> {
    const subscriber = this.client.duplicate();
    await subscriber.subscribe(channel);

    subscriber.on('message', (ch, msg) => {
      if (ch === channel) {
        const parsed = JSON.parse(msg);
        handler(parsed);
      }
    });
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Get underlying client
   */
  getClient(): Redis {
    return this.client;
  }
}

/**
 * Create Redis client
 */
export function createRedisClient(config: RedisConfig): RedisClient {
  return new RedisClient(config);
}
