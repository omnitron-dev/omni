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

  // ═══════════════════════════════════════════════════════════════════════════
  // Redis Streams Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add an entry to a stream
   * @param key - The stream key
   * @param id - Entry ID ('*' for auto-generate)
   * @param fields - Field-value pairs to add
   * @param namespace - Optional namespace for the Redis client
   * @returns The entry ID
   */
  async xadd(
    key: string,
    id: string,
    fields: Record<string, string>,
    namespace?: string
  ): Promise<string | null> {
    const client = this.getClient(namespace);
    const args = Object.entries(fields).flat();
    return client.xadd(key, id, ...args);
  }

  /**
   * Create, destroy, or manage a consumer group
   * @param command - The subcommand (CREATE, DESTROY, SETID)
   * @param key - The stream key
   * @param group - The consumer group name
   * @param id - Starting ID for the group
   * @param mkstream - If 'MKSTREAM', creates the stream if it doesn't exist
   * @param namespace - Optional namespace for the Redis client
   * @returns Command result
   */
  async xgroup(
    command: 'CREATE' | 'DESTROY' | 'SETID',
    key: string,
    group: string,
    id: string,
    mkstream?: 'MKSTREAM',
    namespace?: string
  ): Promise<unknown> {
    const client = this.getClient(namespace);
    // Use type assertion to handle ioredis strict overload types
    if (mkstream) {
      return (client as any).xgroup(command, key, group, id, mkstream);
    }
    return (client as any).xgroup(command, key, group, id);
  }

  /**
   * Read entries from a stream as a consumer in a consumer group
   * @param group - The consumer group name
   * @param consumer - The consumer name
   * @param count - Maximum number of entries to return
   * @param block - Block timeout in milliseconds (0 = forever)
   * @param streams - Stream keys followed by their IDs (use '>' for new entries)
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of stream entries or null
   */
  async xreadgroup(
    group: string,
    consumer: string,
    count: number,
    block: number,
    streams: Array<{ key: string; id: string }>,
    namespace?: string
  ): Promise<Array<[string, Array<[string, Record<string, string>]>]> | null> {
    const client = this.getClient(namespace);
    const streamKeys = streams.map((s) => s.key);
    const streamIds = streams.map((s) => s.id);

    // Build arguments array for xreadgroup
    const xreadArgs: (string | number)[] = [
      'GROUP',
      group,
      consumer,
      'COUNT',
      count,
      'BLOCK',
      block,
      'STREAMS',
      ...streamKeys,
      ...streamIds,
    ];

    const result = (await (client as any).xreadgroup(...xreadArgs)) as Array<
      [string, Array<[string, string[]]>]
    > | null;

    if (!result) return null;

    // Transform flat array to Record<string, string>
    return result.map(([streamKey, entries]) => [
      streamKey,
      entries.map(([entryId, fields]) => {
        const fieldsObj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const key = fields[i];
          const value = fields[i + 1];
          if (key !== undefined && value !== undefined) {
            fieldsObj[key] = value;
          }
        }
        return [entryId, fieldsObj] as [string, Record<string, string>];
      }),
    ]);
  }

  /**
   * Acknowledge one or more messages in a consumer group
   * @param key - The stream key
   * @param group - The consumer group name
   * @param ids - One or more entry IDs to acknowledge
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of messages acknowledged
   */
  async xack(key: string, group: string, ids: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    const idArray = Array.isArray(ids) ? ids : [ids];
    return client.xack(key, group, ...idArray);
  }

  /**
   * Get the length of a stream
   * @param key - The stream key
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of entries in the stream
   */
  async xlen(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.xlen(key);
  }

  /**
   * Read entries from a stream by range
   * @param key - The stream key
   * @param start - Start ID ('-' for minimum)
   * @param end - End ID ('+' for maximum)
   * @param count - Optional maximum number of entries
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of stream entries
   */
  async xrange(
    key: string,
    start: string,
    end: string,
    count?: number,
    namespace?: string
  ): Promise<Array<[string, Record<string, string>]>> {
    const client = this.getClient(namespace);

    let result: Array<[string, string[]]>;
    if (count !== undefined) {
      result = (await client.xrange(key, start, end, 'COUNT', count)) as Array<[string, string[]]>;
    } else {
      result = (await client.xrange(key, start, end)) as Array<[string, string[]]>;
    }

    return result.map(([entryId, fields]) => {
      const fieldsObj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        const fieldKey = fields[i];
        const fieldValue = fields[i + 1];
        if (fieldKey !== undefined && fieldValue !== undefined) {
          fieldsObj[fieldKey] = fieldValue;
        }
      }
      return [entryId, fieldsObj] as [string, Record<string, string>];
    });
  }

  /**
   * Read entries from a stream (without consumer group)
   * @param streams - Array of stream keys and IDs to read from
   * @param count - Maximum number of entries per stream
   * @param block - Optional block timeout in milliseconds
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of stream entries or null
   */
  async xread(
    streams: Array<{ key: string; id: string }>,
    count?: number,
    block?: number,
    namespace?: string
  ): Promise<Array<[string, Array<[string, Record<string, string>]>]> | null> {
    const client = this.getClient(namespace);
    const streamKeys = streams.map((s) => s.key);
    const streamIds = streams.map((s) => s.id);

    const args: (string | number)[] = [];
    if (count !== undefined) {
      args.push('COUNT', count);
    }
    if (block !== undefined) {
      args.push('BLOCK', block);
    }
    args.push('STREAMS', ...streamKeys, ...streamIds);

    const result = (await (client as any).xread(...args)) as Array<[string, Array<[string, string[]]>]> | null;

    if (!result) return null;

    return result.map(([streamKey, entries]) => [
      streamKey,
      entries.map(([entryId, fields]) => {
        const fieldsObj: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) {
          const fieldKey = fields[i];
          const fieldValue = fields[i + 1];
          if (fieldKey !== undefined && fieldValue !== undefined) {
            fieldsObj[fieldKey] = fieldValue;
          }
        }
        return [entryId, fieldsObj] as [string, Record<string, string>];
      }),
    ]);
  }

  /**
   * Trim a stream to a maximum length
   * @param key - The stream key
   * @param maxlen - Maximum length to trim to
   * @param approximate - If true, uses ~ for approximate trimming (more efficient)
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of entries deleted
   */
  async xtrim(key: string, maxlen: number, approximate = true, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    if (approximate) {
      return client.xtrim(key, 'MAXLEN', '~', maxlen);
    }
    return client.xtrim(key, 'MAXLEN', maxlen);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Additional Sorted Set Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get members from a sorted set by score range
   * @param key - The sorted set key
   * @param min - Minimum score (use '-inf' for negative infinity)
   * @param max - Maximum score (use '+inf' for positive infinity)
   * @param options - Optional limit and offset
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of members in the specified score range
   */
  async zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    options?: { offset?: number; count?: number; withScores?: boolean },
    namespace?: string
  ): Promise<string[]> {
    const client = this.getClient(namespace);

    // Build args and use type assertion for dynamic argument spread
    if (options?.withScores && options?.offset !== undefined && options?.count !== undefined) {
      return client.zrangebyscore(key, min, max, 'WITHSCORES', 'LIMIT', options.offset, options.count);
    }
    if (options?.withScores) {
      return client.zrangebyscore(key, min, max, 'WITHSCORES');
    }
    if (options?.offset !== undefined && options?.count !== undefined) {
      return client.zrangebyscore(key, min, max, 'LIMIT', options.offset, options.count);
    }
    return client.zrangebyscore(key, min, max);
  }

  /**
   * Get members from a sorted set by score range in reverse order
   * @param key - The sorted set key
   * @param max - Maximum score (use '+inf' for positive infinity)
   * @param min - Minimum score (use '-inf' for negative infinity)
   * @param options - Optional limit and offset
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of members in the specified score range (descending)
   */
  async zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    options?: { offset?: number; count?: number; withScores?: boolean },
    namespace?: string
  ): Promise<string[]> {
    const client = this.getClient(namespace);

    // Build args and use explicit overloads for type safety
    if (options?.withScores && options?.offset !== undefined && options?.count !== undefined) {
      return client.zrevrangebyscore(key, max, min, 'WITHSCORES', 'LIMIT', options.offset, options.count);
    }
    if (options?.withScores) {
      return client.zrevrangebyscore(key, max, min, 'WITHSCORES');
    }
    if (options?.offset !== undefined && options?.count !== undefined) {
      return client.zrevrangebyscore(key, max, min, 'LIMIT', options.offset, options.count);
    }
    return client.zrevrangebyscore(key, max, min);
  }

  /**
   * Remove members from a sorted set by score range
   * @param key - The sorted set key
   * @param min - Minimum score
   * @param max - Maximum score
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members removed
   */
  async zremrangebyscore(key: string, min: number | string, max: number | string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.zremrangebyscore(key, min, max);
  }

  /**
   * Increment the score of a member in a sorted set
   * @param key - The sorted set key
   * @param increment - The increment value
   * @param member - The member to increment
   * @param namespace - Optional namespace for the Redis client
   * @returns The new score after incrementing
   */
  async zincrby(key: string, increment: number, member: string, namespace?: string): Promise<string> {
    const client = this.getClient(namespace);
    return client.zincrby(key, increment, member);
  }

  /**
   * Count members in a sorted set by score range
   * @param key - The sorted set key
   * @param min - Minimum score
   * @param max - Maximum score
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members in the score range
   */
  async zcount(key: string, min: number | string, max: number | string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.zcount(key, min, max);
  }

  /**
   * Remove members from a sorted set by rank range
   * @param key - The sorted set key
   * @param start - Start rank (0-based)
   * @param stop - Stop rank
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of members removed
   */
  async zremrangebyrank(key: string, start: number, stop: number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.zremrangebyrank(key, start, stop);
  }

  /**
   * Get the rank of a member in a sorted set
   * @param key - The sorted set key
   * @param member - The member to get rank for
   * @param namespace - Optional namespace for the Redis client
   * @returns The rank (0-based) or null if member doesn't exist
   */
  async zrank(key: string, member: string, namespace?: string): Promise<number | null> {
    const client = this.getClient(namespace);
    return client.zrank(key, member);
  }

  /**
   * Get the rank of a member in a sorted set (reverse order)
   * @param key - The sorted set key
   * @param member - The member to get rank for
   * @param namespace - Optional namespace for the Redis client
   * @returns The rank (0-based, highest score = 0) or null if member doesn't exist
   */
  async zrevrank(key: string, member: string, namespace?: string): Promise<number | null> {
    const client = this.getClient(namespace);
    return client.zrevrank(key, member);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Pub/Sub Subscriber Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to one or more channels on a subscriber client
   * Note: Use createSubscriber() first to get a dedicated client for subscriptions
   * @param client - The subscriber Redis client (from createSubscriber())
   * @param channels - One or more channel names to subscribe to
   * @returns Promise that resolves when subscribed
   */
  async subscribeClient(client: RedisClient, channels: string | string[]): Promise<void> {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    await (client as Redis).subscribe(...channelArray);
  }

  /**
   * Unsubscribe from one or more channels on a subscriber client
   * @param client - The subscriber Redis client
   * @param channels - One or more channel names to unsubscribe from
   * @returns Promise that resolves when unsubscribed
   */
  async unsubscribeClient(client: RedisClient, channels: string | string[]): Promise<void> {
    const channelArray = Array.isArray(channels) ? channels : [channels];
    await (client as Redis).unsubscribe(...channelArray);
  }

  /**
   * Subscribe to channels matching a pattern on a subscriber client
   * @param client - The subscriber Redis client (from createSubscriber())
   * @param patterns - One or more patterns to subscribe to
   * @returns Promise that resolves when subscribed
   */
  async psubscribeClient(client: RedisClient, patterns: string | string[]): Promise<void> {
    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    await (client as Redis).psubscribe(...patternArray);
  }

  /**
   * Unsubscribe from pattern subscriptions on a subscriber client
   * @param client - The subscriber Redis client
   * @param patterns - One or more patterns to unsubscribe from
   * @returns Promise that resolves when unsubscribed
   */
  async punsubscribeClient(client: RedisClient, patterns: string | string[]): Promise<void> {
    const patternArray = Array.isArray(patterns) ? patterns : [patterns];
    await (client as Redis).punsubscribe(...patternArray);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Additional Hash Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set multiple fields in a hash
   * @param key - The hash key
   * @param fields - Field-value pairs to set
   * @param namespace - Optional namespace for the Redis client
   * @returns 'OK' if successful
   */
  async hmset(key: string, fields: Record<string, string | number>, namespace?: string): Promise<'OK'> {
    const client = this.getClient(namespace);
    return client.hmset(key, fields);
  }

  /**
   * Get multiple fields from a hash
   * @param key - The hash key
   * @param fields - Field names to retrieve
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of values (null for non-existing fields)
   */
  async hmget(key: string, fields: string[], namespace?: string): Promise<(string | null)[]> {
    const client = this.getClient(namespace);
    return client.hmget(key, ...fields);
  }

  /**
   * Check if a field exists in a hash
   * @param key - The hash key
   * @param field - The field name
   * @param namespace - Optional namespace for the Redis client
   * @returns 1 if field exists, 0 otherwise
   */
  async hexists(key: string, field: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.hexists(key, field);
  }

  /**
   * Increment a hash field value
   * @param key - The hash key
   * @param field - The field name
   * @param increment - The increment value
   * @param namespace - Optional namespace for the Redis client
   * @returns The value after incrementing
   */
  async hincrby(key: string, field: string, increment: number, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.hincrby(key, field, increment);
  }

  /**
   * Increment a hash field by a float value
   * @param key - The hash key
   * @param field - The field name
   * @param increment - The float increment value
   * @param namespace - Optional namespace for the Redis client
   * @returns The value after incrementing (as string)
   */
  async hincrbyfloat(key: string, field: string, increment: number, namespace?: string): Promise<string> {
    const client = this.getClient(namespace);
    return client.hincrbyfloat(key, field, increment);
  }

  /**
   * Get the number of fields in a hash
   * @param key - The hash key
   * @param namespace - Optional namespace for the Redis client
   * @returns The number of fields
   */
  async hlen(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.hlen(key);
  }

  /**
   * Get all field names in a hash
   * @param key - The hash key
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of field names
   */
  async hkeys(key: string, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.hkeys(key);
  }

  /**
   * Get all values in a hash
   * @param key - The hash key
   * @param namespace - Optional namespace for the Redis client
   * @returns Array of values
   */
  async hvals(key: string, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.hvals(key);
  }
}
