import { Redis, ChainableCommander } from 'ioredis';
import { isCluster } from './redis.utils.js';
import { Errors } from '../../errors/index.js';
import { RedisClient } from './redis.types.js';
import { RedisManager } from './redis.manager.js';

export class RedisService {
  constructor(private readonly manager: RedisManager) {}

  /**
   * Get a Redis client for the specified namespace
   * @param namespace - Optional namespace for the Redis client
   * @returns The Redis client instance
   */
  getClient(namespace?: string): RedisClient {
    return this.manager.getClient(namespace);
  }

  /**
   * Get a Redis client or throw an error if not found
   * @param namespace - Optional namespace for the Redis client
   * @returns The Redis client instance
   * @throws {NotFoundError} If the client is not found
   */
  getOrThrow(namespace?: string): RedisClient {
    const client = this.getClient(namespace);
    if (!client) {
      throw Errors.notFound('Redis client', namespace || 'default');
    }
    return client;
  }

  /**
   * Get a Redis client or return null if not found
   * @param namespace - Optional namespace for the Redis client
   * @returns The Redis client instance or null
   */
  getOrNil(namespace?: string): RedisClient | null {
    try {
      return this.getClient(namespace);
    } catch {
      return null;
    }
  }

  /**
   * Ping the Redis server to check connectivity
   * @param namespace - Optional namespace for the Redis client
   * @returns True if the server is healthy
   */
  async ping(namespace?: string): Promise<boolean> {
    return this.manager.isHealthy(namespace);
  }

  /**
   * Check if the Redis client is ready
   * @param namespace - Optional namespace for the Redis client
   * @returns True if the client is ready
   */
  isReady(namespace?: string): boolean {
    const client = this.getClient(namespace);
    return client.status === 'ready';
  }

  /**
   * Load a Lua script into Redis
   * @param name - The name of the script
   * @param content - The Lua script content
   * @param namespace - Optional namespace for the Redis client
   * @returns The SHA1 hash of the loaded script
   */
  async loadScript(name: string, content: string, namespace?: string): Promise<string> {
    const client = this.getClient(namespace);
    const sha = (await client.script('LOAD', content)) as string;

    return sha;
  }

  /**
   * Run a previously loaded Lua script
   * @param name - The name of the script
   * @param keys - Array of Redis keys for the script
   * @param args - Array of arguments for the script
   * @param namespace - Optional namespace for the Redis client
   * @returns The result of the script execution
   */
  async runScript<T = any>(name: string, keys: string[], args: (string | number)[], namespace?: string): Promise<T> {
    return this.manager.runScript<T>(name, keys, args, namespace);
  }

  /**
   * Create a duplicate Redis client for pub/sub operations
   * @param namespace - Optional namespace for the Redis client
   * @returns A duplicate Redis client instance
   */
  createSubscriber(namespace?: string): RedisClient {
    const client = this.getClient(namespace);

    if (isCluster(client)) {
      return client.duplicate();
    }

    const redis = client as Redis;
    return redis.duplicate();
  }

  /**
   * Publish a message to a Redis channel
   * @param channel - The channel name
   * @param message - The message to publish (will be JSON stringified if not a string)
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of subscribers that received the message
   */
  async publish(channel: string, message: any, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return client.publish(channel, payload);
  }

  /**
   * Create a Redis pipeline for batch operations
   * @param namespace - Optional namespace for the Redis client
   * @returns A Redis pipeline instance
   */
  pipeline(namespace?: string): ChainableCommander {
    const client = this.getClient(namespace);
    return client.pipeline();
  }

  /**
   * Create a Redis multi/transaction for atomic operations
   * @param namespace - Optional namespace for the Redis client
   * @returns A Redis multi instance
   */
  multi(namespace?: string): ChainableCommander {
    const client = this.getClient(namespace);
    // Note: multi is not fully supported in cluster mode for cross-slot operations
    // but we allow it for single-slot operations
    return client.multi();
  }

  /**
   * Get a value from Redis
   * @param key - The key to retrieve
   * @param namespace - Optional namespace for the Redis client
   * @returns The value or null if not found
   */
  async get(key: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.get(key);
  }

  /**
   * Set a value in Redis
   * @param key - The key to set
   * @param value - The value to store
   * @param ttl - Optional TTL in seconds
   * @param namespace - Optional namespace for the Redis client
   * @returns 'OK' if successful, null otherwise
   */
  async set(key: string, value: string | number, ttl?: number, namespace?: string): Promise<'OK' | null> {
    const client = this.getClient(namespace);

    if (ttl) {
      return client.set(key, value, 'EX', ttl);
    }

    return client.set(key, value);
  }

  /**
   * Set a value in Redis with expiration time
   * @param key - The key to set
   * @param ttl - TTL in seconds
   * @param value - The value to store
   * @param namespace - Optional namespace for the Redis client
   * @returns 'OK' if successful
   */
  async setex(key: string, ttl: number, value: string | number, namespace?: string): Promise<'OK'> {
    const client = this.getClient(namespace);
    return client.setex(key, ttl, value);
  }

  /**
   * Set a value only if the key does not exist
   * @param key - The key to set
   * @param value - The value to store
   * @param namespace - Optional namespace for the Redis client
   * @returns 1 if the key was set, 0 if not
   */
  async setnx(key: string, value: string | number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.setnx(key, value);
  }

  /**
   * Delete one or more keys from Redis
   * @param keys - The key(s) to delete
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of keys deleted
   */
  async del(keys: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(keys) ? client.del(...keys) : client.del(keys);
  }

  /**
   * Check if one or more keys exist
   * @param keys - The key(s) to check
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of keys that exist
   */
  async exists(keys: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(keys) ? client.exists(...keys) : client.exists(keys);
  }

  /**
   * Increment a key's value by 1
   * @param key - The key to increment
   * @param namespace - Optional namespace for the Redis client
   * @returns The value after incrementing
   */
  async incr(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.incr(key);
  }

  /**
   * Increment a key's value by a specified amount
   * @param key - The key to increment
   * @param increment - The amount to increment by
   * @param namespace - Optional namespace for the Redis client
   * @returns The value after incrementing
   */
  async incrby(key: string, increment: number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.incrby(key, increment);
  }

  /**
   * Decrement a key's value by 1
   * @param key - The key to decrement
   * @param namespace - Optional namespace for the Redis client
   * @returns The value after decrementing
   */
  async decr(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.decr(key);
  }

  /**
   * Decrement a key's value by a specified amount
   * @param key - The key to decrement
   * @param decrement - The amount to decrement by
   * @param namespace - Optional namespace for the Redis client
   * @returns The value after decrementing
   */
  async decrby(key: string, decrement: number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.decrby(key, decrement);
  }

  /**
   * Set a key's time to live in seconds
   * @param key - The key to set expiration on
   * @param seconds - The number of seconds until expiration
   * @param namespace - Optional namespace for the Redis client
   * @returns 1 if the timeout was set, 0 if not
   */
  async expire(key: string, seconds: number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.expire(key, seconds);
  }

  /**
   * Get the time to live for a key in seconds
   * @param key - The key to check
   * @param namespace - Optional namespace for the Redis client
   * @returns The TTL in seconds, -1 if no expiration, -2 if key doesn't exist
   */
  async ttl(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.ttl(key);
  }

  /**
   * Get a field from a hash
   * @param key - The hash key
   * @param field - The field name
   * @param namespace - Optional namespace for the Redis client
   * @returns The field value or null if not found
   */
  async hget(key: string, field: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.hget(key, field);
  }

  /**
   * Set a field in a hash
   * @param key - The hash key
   * @param field - The field name
   * @param value - The value to set
   * @param namespace - Optional namespace for the Redis client
   * @returns 1 if new field was created, 0 if field was updated
   */
  async hset(key: string, field: string, value: string | number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.hset(key, field, value);
  }

  /**
   * Get all fields and values from a hash
   * @param key - The hash key
   * @param namespace - Optional namespace for the Redis client
   * @returns An object containing all field-value pairs
   */
  async hgetall(key: string, namespace?: string): Promise<Record<string, string>> {
    const client = this.getClient(namespace);
    return client.hgetall(key);
  }

  /**
   * Delete one or more fields from a hash
   * @param key - The hash key
   * @param fields - The field(s) to delete
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of fields deleted
   */
  async hdel(key: string, fields: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(fields) ? client.hdel(key, ...fields) : client.hdel(key, fields);
  }

  /**
   * Add one or more members to a set
   * @param key - The set key
   * @param members - The member(s) to add
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members added
   */
  async sadd(key: string, members: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(members) ? client.sadd(key, ...members) : client.sadd(key, members);
  }

  /**
   * Remove one or more members from a set
   * @param key - The set key
   * @param members - The member(s) to remove
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members removed
   */
  async srem(key: string, members: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(members) ? client.srem(key, ...members) : client.srem(key, members);
  }

  /**
   * Get all members of a set
   * @param key - The set key
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of set members
   */
  async smembers(key: string, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.smembers(key);
  }

  /**
   * Check if a member exists in a set
   * @param key - The set key
   * @param member - The member to check
   * @param namespace - Optional namespace for the Redis client
   * @returns 1 if member exists, 0 if not
   */
  async sismember(key: string, member: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.sismember(key, member);
  }

  /**
   * Prepend one or more values to a list
   * @param key - The list key
   * @param values - The value(s) to prepend
   * @param namespace - Optional namespace for the Redis client
   * @returns The length of the list after the operation
   */
  async lpush(key: string, values: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(values) ? client.lpush(key, ...values) : client.lpush(key, values);
  }

  /**
   * Append one or more values to a list
   * @param key - The list key
   * @param values - The value(s) to append
   * @param namespace - Optional namespace for the Redis client
   * @returns The length of the list after the operation
   */
  async rpush(key: string, values: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(values) ? client.rpush(key, ...values) : client.rpush(key, values);
  }

  /**
   * Remove and return the first element of a list
   * @param key - The list key
   * @param namespace - Optional namespace for the Redis client
   * @returns The removed element or null if the list is empty
   */
  async lpop(key: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.lpop(key);
  }

  /**
   * Remove and return the last element of a list
   * @param key - The list key
   * @param namespace - Optional namespace for the Redis client
   * @returns The removed element or null if the list is empty
   */
  async rpop(key: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.rpop(key);
  }

  /**
   * Get a range of elements from a list
   * @param key - The list key
   * @param start - The start index
   * @param stop - The stop index
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of elements in the specified range
   */
  async lrange(key: string, start: number, stop: number, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.lrange(key, start, stop);
  }

  /**
   * Get the length of a list
   * @param key - The list key
   * @param namespace - Optional namespace for the Redis client
   * @returns The length of the list
   */
  async llen(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.llen(key);
  }

  /**
   * Trim a list to the specified range
   * @param key - The list key
   * @param start - The start index
   * @param stop - The stop index
   * @param namespace - Optional namespace for the Redis client
   * @returns 'OK' if successful
   */
  async ltrim(key: string, start: number, stop: number, namespace?: string): Promise<'OK'> {
    const client = this.getClient(namespace);
    return client.ltrim(key, start, stop);
  }

  /**
   * Add one or more members to a sorted set
   * @param key - The sorted set key
   * @param args - Score-member pairs followed by optional namespace
   * @returns The number of elements added
   */
  async zadd(key: string, ...args: (string | number)[]): Promise<number> {
    // Parse namespace from last argument if it's a string and not part of score-member pairs
    let namespace: string | undefined;
    let scoreMembers = args;

    // Check if last arg could be namespace (odd number of args and last is string)
    if (args.length % 2 === 1 && typeof args[args.length - 1] === 'string') {
      namespace = args[args.length - 1] as string;
      scoreMembers = args.slice(0, -1);
    }

    const client = this.getClient(namespace);
    return client.zadd(key, ...scoreMembers);
  }

  /**
   * Remove one or more members from a sorted set
   * @param key - The sorted set key
   * @param members - The member(s) to remove
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members removed
   */
  async zrem(key: string, members: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(members) ? client.zrem(key, ...members) : client.zrem(key, members);
  }

  /**
   * Get a range of members from a sorted set by index
   * @param key - The sorted set key
   * @param start - The start index
   * @param stop - The stop index
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of members in the specified range
   */
  async zrange(key: string, start: number, stop: number, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.zrange(key, start, stop);
  }

  /**
   * Get a range of members from a sorted set by index in reverse order
   * @param key - The sorted set key
   * @param start - The start index
   * @param stop - The stop index
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of members in the specified range
   */
  async zrevrange(key: string, start: number, stop: number, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.zrevrange(key, start, stop);
  }

  /**
   * Get the cardinality (number of members) of a sorted set
   * @param key - The sorted set key
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members in the sorted set
   */
  async zcard(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.zcard(key);
  }

  /**
   * Get the score of a member in a sorted set
   * @param key - The sorted set key
   * @param member - The member to get the score for
   * @param namespace - Optional namespace for the Redis client
   * @returns The score or null if the member doesn't exist
   */
  async zscore(key: string, member: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.zscore(key, member);
  }

  /**
   * Evaluate a Lua script
   * @param script - The Lua script content
   * @param numkeys - The number of keys
   * @param args - Keys and arguments for the script
   * @returns The result of the script execution
   */
  async eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<any> {
    const client = this.getClient();
    return client.eval(script, numkeys, ...args);
  }

  /**
   * Evaluate a cached Lua script by its SHA1 hash
   * @param sha - The SHA1 hash of the script
   * @param numkeys - The number of keys
   * @param args - Keys and arguments for the script
   * @returns The result of the script execution
   */
  async evalsha(sha: string, numkeys: number, ...args: (string | number)[]): Promise<any> {
    const client = this.getClient();
    return client.evalsha(sha, numkeys, ...args);
  }

  /**
   * Remove all keys from the current database
   * @param namespace - Optional namespace for the Redis client
   * @returns 'OK' if successful
   */
  async flushdb(namespace?: string): Promise<'OK'> {
    const client = this.getClient(namespace);
    return client.flushdb();
  }

  /**
   * Remove all keys from all databases
   * @returns 'OK' if successful
   */
  async flushall(): Promise<'OK'> {
    const client = this.getClient();
    return client.flushall();
  }
}
