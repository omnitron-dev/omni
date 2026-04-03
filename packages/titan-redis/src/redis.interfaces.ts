/**
 * Redis Module Abstraction Interfaces
 *
 * These interfaces provide a stable public API that hides the underlying
 * ioredis implementation details. When the redis module is extracted as
 * a separate package, consumers won't need to know ioredis is used internally.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Connection Status & Configuration
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Redis client connection status.
 * These are the possible states of a Redis client connection.
 */
export type IRedisClientStatus =
  | 'wait' // Not connected, waiting to connect
  | 'reconnecting' // Reconnecting after disconnect
  | 'connecting' // Currently connecting
  | 'connect' // Connected but not ready
  | 'ready' // Connected and ready for commands
  | 'close' // Connection closed normally
  | 'end'; // Connection ended (will not reconnect)

/**
 * Cluster node configuration
 */
export interface IRedisClusterNode {
  host: string;
  port: number;
}

/**
 * TLS/SSL options for Redis connection
 */
export interface IRedisTlsOptions {
  /**
   * Whether to reject unauthorized certificates
   */
  rejectUnauthorized?: boolean;
  /**
   * CA certificates
   */
  ca?: string | Buffer | Array<string | Buffer>;
  /**
   * Client certificate
   */
  cert?: string | Buffer;
  /**
   * Client private key
   */
  key?: string | Buffer;
}

/**
 * Cluster-specific options
 */
export interface IRedisClusterOptions {
  /**
   * Cluster nodes to connect to
   */
  nodes: IRedisClusterNode[];
  /**
   * Whether to enable ready check for cluster
   */
  enableReadyCheck?: boolean;
  /**
   * Maximum redirections for cluster commands
   */
  maxRedirections?: number;
  /**
   * Retry delay on cluster down
   */
  retryDelayOnClusterDown?: number;
  /**
   * Retry delay on failover
   */
  retryDelayOnFailover?: number;
  /**
   * Retry delay on try again
   */
  retryDelayOnTryAgain?: number;
  /**
   * Scale reads to replicas
   */
  scaleReads?: 'master' | 'slave' | 'all';
  /**
   * Use lazy connect for cluster
   */
  lazyConnect?: boolean;
}

/**
 * Redis client configuration options.
 * This is the public API - internally mapped to ioredis options.
 */
export interface IRedisClientOptions {
  /**
   * Client namespace identifier
   */
  namespace?: string;

  // Connection options
  /**
   * Redis server host
   * @default 'localhost'
   */
  host?: string;
  /**
   * Redis server port
   * @default 6379
   */
  port?: number;
  /**
   * Redis password
   */
  password?: string;
  /**
   * Redis username (Redis 6.0+)
   */
  username?: string;
  /**
   * Database index
   * @default 0
   */
  db?: number;
  /**
   * Connection name (visible in CLIENT LIST)
   */
  name?: string;

  // Connection behavior
  /**
   * Use lazy connection (don't connect until first command)
   * @default true
   */
  lazyConnect?: boolean;
  /**
   * Enable ready check before marking as ready
   * @default true
   */
  enableReadyCheck?: boolean;
  /**
   * Enable offline queue for commands when disconnected
   * @default true
   */
  enableOfflineQueue?: boolean;
  /**
   * Connection timeout in milliseconds
   */
  connectTimeout?: number;
  /**
   * Command timeout in milliseconds
   */
  commandTimeout?: number;
  /**
   * Keep-alive interval in milliseconds (0 to disable)
   */
  keepAlive?: number;
  /**
   * Maximum retries per request (null for infinite)
   */
  maxRetriesPerRequest?: number | null;

  // TLS options
  /**
   * TLS/SSL configuration
   */
  tls?: IRedisTlsOptions;

  // Cluster options
  /**
   * Cluster configuration (if connecting to a Redis Cluster)
   */
  cluster?: IRedisClusterOptions;

  // Retry strategy
  /**
   * Custom retry strategy function
   * Return delay in ms, or null/undefined to stop retrying
   */
  retryStrategy?: (times: number) => number | null | undefined;

  // Callbacks
  /**
   * Called when a client is created
   */
  onClientCreated?: (client: IRedisClient) => void;

  // Sentinel options
  /**
   * Sentinel configuration for high availability
   */
  sentinels?: Array<{ host: string; port: number }>;
  /**
   * Sentinel master name
   */
  sentinelName?: string;

  // Advanced options
  /**
   * Auto-resend unfulfilled commands on reconnect
   */
  autoResendUnfulfilledCommands?: boolean;
  /**
   * Auto-resubscribe to pub/sub channels on reconnect
   */
  autoResubscribe?: boolean;
  /**
   * Show friendly error stack traces
   */
  showFriendlyErrorStack?: boolean;
  /**
   * Connection string URL (overrides other connection options)
   */
  url?: string;
  /**
   * Socket path for Unix domain socket
   */
  path?: string;
  /**
   * Protocol (resp2 or resp3)
   */
  protocol?: 2 | 3;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Interface
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result of a pipeline or multi/transaction execution.
 * Each element is [error, result] where error is null on success.
 */
export type IRedisPipelineResult = Array<[Error | null, unknown]>;

/**
 * Redis pipeline/transaction interface.
 * Allows batching multiple commands for atomic execution.
 */
export interface IRedisPipeline {
  // String operations
  get(key: string): IRedisPipeline;
  set(key: string, value: string | number | Buffer, ...args: (string | number)[]): IRedisPipeline;
  setex(key: string, seconds: number, value: string | number | Buffer): IRedisPipeline;
  setnx(key: string, value: string | number | Buffer): IRedisPipeline;
  del(...keys: string[]): IRedisPipeline;
  exists(...keys: string[]): IRedisPipeline;
  incr(key: string): IRedisPipeline;
  incrby(key: string, increment: number): IRedisPipeline;
  decr(key: string): IRedisPipeline;
  decrby(key: string, decrement: number): IRedisPipeline;
  expire(key: string, seconds: number): IRedisPipeline;
  ttl(key: string): IRedisPipeline;
  mget(...keys: string[]): IRedisPipeline;
  mset(...keyValues: (string | number | Buffer)[]): IRedisPipeline;

  // Hash operations
  hget(key: string, field: string): IRedisPipeline;
  hset(key: string, field: string, value: string | number | Buffer): IRedisPipeline;
  hmset(key: string, ...fieldValues: (string | number | Buffer)[]): IRedisPipeline;
  hmget(key: string, ...fields: string[]): IRedisPipeline;
  hgetall(key: string): IRedisPipeline;
  hdel(key: string, ...fields: string[]): IRedisPipeline;
  hexists(key: string, field: string): IRedisPipeline;
  hincrby(key: string, field: string, increment: number): IRedisPipeline;
  hincrbyfloat(key: string, field: string, increment: number): IRedisPipeline;
  hlen(key: string): IRedisPipeline;
  hkeys(key: string): IRedisPipeline;
  hvals(key: string): IRedisPipeline;

  // Set operations
  sadd(key: string, ...members: (string | number | Buffer)[]): IRedisPipeline;
  srem(key: string, ...members: (string | number | Buffer)[]): IRedisPipeline;
  smembers(key: string): IRedisPipeline;
  sismember(key: string, member: string | number | Buffer): IRedisPipeline;
  scard(key: string): IRedisPipeline;

  // List operations
  lpush(key: string, ...values: (string | number | Buffer)[]): IRedisPipeline;
  rpush(key: string, ...values: (string | number | Buffer)[]): IRedisPipeline;
  lpop(key: string): IRedisPipeline;
  rpop(key: string): IRedisPipeline;
  lrange(key: string, start: number, stop: number): IRedisPipeline;
  llen(key: string): IRedisPipeline;
  ltrim(key: string, start: number, stop: number): IRedisPipeline;

  // Sorted set operations
  zadd(key: string, ...args: (string | number | Buffer)[]): IRedisPipeline;
  zrem(key: string, ...members: (string | number | Buffer)[]): IRedisPipeline;
  zrange(key: string, start: number, stop: number, ...args: string[]): IRedisPipeline;
  zrevrange(key: string, start: number, stop: number, ...args: string[]): IRedisPipeline;
  zrangebyscore(key: string, min: number | string, max: number | string, ...args: (string | number)[]): IRedisPipeline;
  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    ...args: (string | number)[]
  ): IRedisPipeline;
  zcard(key: string): IRedisPipeline;
  zscore(key: string, member: string | number | Buffer): IRedisPipeline;
  zincrby(key: string, increment: number, member: string | number | Buffer): IRedisPipeline;
  zcount(key: string, min: number | string, max: number | string): IRedisPipeline;
  zrank(key: string, member: string | number | Buffer): IRedisPipeline;
  zrevrank(key: string, member: string | number | Buffer): IRedisPipeline;
  zremrangebyscore(key: string, min: number | string, max: number | string): IRedisPipeline;
  zremrangebyrank(key: string, start: number, stop: number): IRedisPipeline;

  // Stream operations
  xadd(key: string, id: string, ...fieldValues: string[]): IRedisPipeline;
  xlen(key: string): IRedisPipeline;
  xrange(key: string, start: string, end: string, ...args: (string | number)[]): IRedisPipeline;
  xtrim(key: string, ...args: (string | number)[]): IRedisPipeline;
  xack(key: string, group: string, ...ids: string[]): IRedisPipeline;

  // Pub/Sub
  publish(channel: string, message: string | Buffer): IRedisPipeline;

  // Script execution
  eval(script: string, numkeys: number, ...args: (string | number)[]): IRedisPipeline;
  evalsha(sha: string, numkeys: number, ...args: (string | number)[]): IRedisPipeline;

  // Execution
  /**
   * Execute all queued commands
   * @returns Array of [error, result] tuples for each command
   */
  exec(): Promise<IRedisPipelineResult | null>;

  /**
   * Get the number of queued commands
   */
  length: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Redis Client Interface
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Redis client event types
 */
export interface IRedisClientEvents {
  connect: () => void;
  ready: () => void;
  error: (error: Error) => void;
  close: () => void;
  reconnecting: (delay: number) => void;
  end: () => void;
  wait: () => void;
  message: (channel: string, message: string) => void;
  messageBuffer: (channel: Buffer, message: Buffer) => void;
  pmessage: (pattern: string, channel: string, message: string) => void;
  pmessageBuffer: (pattern: Buffer, channel: Buffer, message: Buffer) => void;
}

/**
 * Redis client interface providing a stable public API.
 * This abstracts away the underlying ioredis implementation.
 *
 * Note: This interface includes EventEmitter capabilities through the underlying
 * ioredis implementation. The subscribe method here refers to Redis pub/sub,
 * not EventEmitter's subscribe method.
 */
export interface IRedisClient {
  /**
   * Current connection status
   */
  readonly status: IRedisClientStatus;

  // ═══════════════════════════════════════════════════════════════════════════
  // EventEmitter Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add an event listener
   */
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  on<K extends keyof IRedisClientEvents>(event: K, listener: IRedisClientEvents[K]): this;

  /**
   * Add a one-time event listener
   */
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  once<K extends keyof IRedisClientEvents>(event: K, listener: IRedisClientEvents[K]): this;

  /**
   * Remove an event listener
   */
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  off<K extends keyof IRedisClientEvents>(event: K, listener: IRedisClientEvents[K]): this;

  /**
   * Remove all listeners or all listeners for a specific event
   */
  removeAllListeners(event?: string | symbol): this;

  /**
   * Emit an event
   */
  emit(event: string | symbol, ...args: any[]): boolean;
  emit<K extends keyof IRedisClientEvents>(event: K, ...args: Parameters<IRedisClientEvents[K]>): boolean;

  /**
   * Get the list of events with registered listeners
   */
  eventNames(): Array<string | symbol>;

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string | symbol): number;

  /**
   * Get the listeners for an event
   */
  listeners(event: string | symbol): ((...args: unknown[]) => void)[];

  // ═══════════════════════════════════════════════════════════════════════════
  // Connection Management
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Connect to Redis server
   */
  connect(): Promise<void>;

  /**
   * Gracefully disconnect from Redis
   */
  quit(): Promise<'OK'>;

  /**
   * Forcefully disconnect from Redis
   */
  disconnect(): void;

  /**
   * Create a duplicate connection with same options
   */
  duplicate(): IRedisClient;

  /**
   * Ping the server
   */
  ping(): Promise<'PONG'>;
  ping(message: string): Promise<string>;

  // ═══════════════════════════════════════════════════════════════════════════
  // String Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the value of a key
   */
  get(key: string): Promise<string | null>;

  /**
   * Set the value of a key
   */
  set(key: string, value: string | number | Buffer): Promise<'OK' | null>;
  set(key: string, value: string | number | Buffer, mode: 'EX', seconds: number): Promise<'OK' | null>;
  set(key: string, value: string | number | Buffer, mode: 'PX', milliseconds: number): Promise<'OK' | null>;
  set(key: string, value: string | number | Buffer, mode: 'NX'): Promise<'OK' | null>;
  set(key: string, value: string | number | Buffer, mode: 'XX'): Promise<'OK' | null>;

  /**
   * Set the value and expiration of a key
   */
  setex(key: string, seconds: number, value: string | number | Buffer): Promise<'OK'>;

  /**
   * Set the value of a key, only if the key does not exist
   */
  setnx(key: string, value: string | number | Buffer): Promise<number>;

  /**
   * Delete one or more keys
   */
  del(...keys: string[]): Promise<number>;

  /**
   * Determine if one or more keys exist
   */
  exists(...keys: string[]): Promise<number>;

  /**
   * Increment the integer value of a key by one
   */
  incr(key: string): Promise<number>;

  /**
   * Increment the integer value of a key by the given amount
   */
  incrby(key: string, increment: number): Promise<number>;

  /**
   * Increment the float value of a key by the given amount
   */
  incrbyfloat(key: string, increment: number): Promise<string>;

  /**
   * Decrement the integer value of a key by one
   */
  decr(key: string): Promise<number>;

  /**
   * Decrement the integer value of a key by the given number
   */
  decrby(key: string, decrement: number): Promise<number>;

  /**
   * Get the values of all the given keys
   */
  mget(...keys: string[]): Promise<(string | null)[]>;

  /**
   * Set multiple keys to multiple values
   */
  mset(...keyValues: (string | number | Buffer)[]): Promise<'OK'>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Key Expiration
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Set a key's time to live in seconds
   */
  expire(key: string, seconds: number): Promise<number>;

  /**
   * Set a key's time to live in milliseconds
   */
  pexpire(key: string, milliseconds: number): Promise<number>;

  /**
   * Set the expiration for a key as a UNIX timestamp
   */
  expireat(key: string, timestamp: number): Promise<number>;

  /**
   * Get the time to live for a key in seconds
   */
  ttl(key: string): Promise<number>;

  /**
   * Get the time to live for a key in milliseconds
   */
  pttl(key: string): Promise<number>;

  /**
   * Remove the expiration from a key
   */
  persist(key: string): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Hash Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the value of a hash field
   */
  hget(key: string, field: string): Promise<string | null>;

  /**
   * Set the value of a hash field
   */
  hset(key: string, field: string, value: string | number | Buffer): Promise<number>;
  hset(key: string, data: Record<string, string | number | Buffer>): Promise<number>;

  /**
   * Set multiple hash fields to multiple values
   */
  hmset(key: string, data: Record<string, string | number | Buffer>): Promise<'OK'>;

  /**
   * Get the values of multiple hash fields
   */
  hmget(key: string, ...fields: string[]): Promise<(string | null)[]>;

  /**
   * Get all fields and values in a hash
   */
  hgetall(key: string): Promise<Record<string, string>>;

  /**
   * Delete one or more hash fields
   */
  hdel(key: string, ...fields: string[]): Promise<number>;

  /**
   * Determine if a hash field exists
   */
  hexists(key: string, field: string): Promise<number>;

  /**
   * Increment the integer value of a hash field
   */
  hincrby(key: string, field: string, increment: number): Promise<number>;

  /**
   * Increment the float value of a hash field
   */
  hincrbyfloat(key: string, field: string, increment: number): Promise<string>;

  /**
   * Get the number of fields in a hash
   */
  hlen(key: string): Promise<number>;

  /**
   * Get all field names in a hash
   */
  hkeys(key: string): Promise<string[]>;

  /**
   * Get all values in a hash
   */
  hvals(key: string): Promise<string[]>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Set Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add one or more members to a set
   */
  sadd(key: string, ...members: (string | number | Buffer)[]): Promise<number>;

  /**
   * Remove one or more members from a set
   */
  srem(key: string, ...members: (string | number | Buffer)[]): Promise<number>;

  /**
   * Get all members of a set
   */
  smembers(key: string): Promise<string[]>;

  /**
   * Determine if a value is a member of a set
   */
  sismember(key: string, member: string | number | Buffer): Promise<number>;

  /**
   * Get the number of members in a set
   */
  scard(key: string): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════════
  // List Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Prepend one or more values to a list
   */
  lpush(key: string, ...values: (string | number | Buffer)[]): Promise<number>;

  /**
   * Append one or more values to a list
   */
  rpush(key: string, ...values: (string | number | Buffer)[]): Promise<number>;

  /**
   * Remove and get the first element of a list
   */
  lpop(key: string): Promise<string | null>;

  /**
   * Remove and get the last element of a list
   */
  rpop(key: string): Promise<string | null>;

  /**
   * Get a range of elements from a list
   */
  lrange(key: string, start: number, stop: number): Promise<string[]>;

  /**
   * Get the length of a list
   */
  llen(key: string): Promise<number>;

  /**
   * Trim a list to the specified range
   */
  ltrim(key: string, start: number, stop: number): Promise<'OK'>;

  /**
   * Get an element by its index
   */
  lindex(key: string, index: number): Promise<string | null>;

  /**
   * Set the value of an element by its index
   */
  lset(key: string, index: number, value: string | number | Buffer): Promise<'OK'>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Sorted Set Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add one or more members to a sorted set, or update score if exists
   */
  zadd(key: string, ...args: (string | number | Buffer)[]): Promise<number>;

  /**
   * Remove one or more members from a sorted set
   */
  zrem(key: string, ...members: (string | number | Buffer)[]): Promise<number>;

  /**
   * Return a range of members by index
   */
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>;

  /**
   * Return a range of members by index, with scores ordered high to low
   */
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zrevrange(key: string, start: number, stop: number, withScores: 'WITHSCORES'): Promise<string[]>;

  /**
   * Return a range of members by score
   */
  zrangebyscore(key: string, min: number | string, max: number | string): Promise<string[]>;
  zrangebyscore(key: string, min: number | string, max: number | string, withScores: 'WITHSCORES'): Promise<string[]>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    limit: 'LIMIT',
    offset: number,
    count: number
  ): Promise<string[]>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
    withScores: 'WITHSCORES',
    limit: 'LIMIT',
    offset: number,
    count: number
  ): Promise<string[]>;

  /**
   * Return a range of members by score, with scores ordered high to low
   */
  zrevrangebyscore(key: string, max: number | string, min: number | string): Promise<string[]>;
  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    withScores: 'WITHSCORES'
  ): Promise<string[]>;
  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    limit: 'LIMIT',
    offset: number,
    count: number
  ): Promise<string[]>;
  zrevrangebyscore(
    key: string,
    max: number | string,
    min: number | string,
    withScores: 'WITHSCORES',
    limit: 'LIMIT',
    offset: number,
    count: number
  ): Promise<string[]>;

  /**
   * Get the number of members in a sorted set
   */
  zcard(key: string): Promise<number>;

  /**
   * Get the score of a member
   */
  zscore(key: string, member: string | number | Buffer): Promise<string | null>;

  /**
   * Increment the score of a member
   */
  zincrby(key: string, increment: number, member: string | number | Buffer): Promise<string>;

  /**
   * Count members in a score range
   */
  zcount(key: string, min: number | string, max: number | string): Promise<number>;

  /**
   * Get the rank of a member
   */
  zrank(key: string, member: string | number | Buffer): Promise<number | null>;

  /**
   * Get the rank of a member (reverse order)
   */
  zrevrank(key: string, member: string | number | Buffer): Promise<number | null>;

  /**
   * Remove members by score range
   */
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<number>;

  /**
   * Remove members by rank range
   */
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Pub/Sub Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Publish a message to a channel
   */
  publish(channel: string, message: string | Buffer): Promise<number>;

  /**
   * Subscribe to one or more channels
   */
  subscribe(...channels: string[]): Promise<number>;

  /**
   * Unsubscribe from one or more channels
   */
  unsubscribe(...channels: string[]): Promise<number>;

  /**
   * Subscribe to channels matching a pattern
   */
  psubscribe(...patterns: string[]): Promise<number>;

  /**
   * Unsubscribe from channels matching a pattern
   */
  punsubscribe(...patterns: string[]): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Stream Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Append an entry to a stream
   */
  xadd(key: string, id: string, ...fieldValues: string[]): Promise<string | null>;

  /**
   * Get the length of a stream
   */
  xlen(key: string): Promise<number>;

  /**
   * Read stream entries in a range
   */
  xrange(key: string, start: string, end: string): Promise<Array<[string, string[]]>>;
  xrange(key: string, start: string, end: string, count: 'COUNT', n: number): Promise<Array<[string, string[]]>>;

  /**
   * Read from streams
   */
  xread(...args: (string | number)[]): Promise<Array<[string, Array<[string, string[]]>]> | null>;

  /**
   * Read from streams as a consumer group
   */
  xreadgroup(...args: (string | number)[]): Promise<Array<[string, Array<[string, string[]]>]> | null>;

  /**
   * Manage consumer groups
   */
  xgroup(...args: (string | number)[]): Promise<unknown>;

  /**
   * Acknowledge stream messages
   */
  xack(key: string, group: string, ...ids: string[]): Promise<number>;

  /**
   * Trim a stream to a maximum length
   */
  xtrim(key: string, strategy: 'MAXLEN', count: number): Promise<number>;
  xtrim(key: string, strategy: 'MAXLEN', approximate: '~', count: number): Promise<number>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Script Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Evaluate a Lua script
   */
  eval(script: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;

  /**
   * Evaluate a Lua script by its SHA1 hash
   */
  evalsha(sha1: string, numkeys: number, ...args: (string | number)[]): Promise<unknown>;

  /**
   * Script commands (LOAD, EXISTS, FLUSH, etc.)
   */
  script(command: 'LOAD', script: string): Promise<string>;
  script(command: 'EXISTS', ...sha1s: string[]): Promise<number[]>;
  script(command: 'FLUSH'): Promise<'OK'>;
  script(command: 'KILL'): Promise<'OK'>;

  // ═══════════════════════════════════════════════════════════════════════════
  // Pipeline & Transaction
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a pipeline for batching commands
   */
  pipeline(): IRedisPipeline;

  /**
   * Create a transaction (MULTI/EXEC)
   */
  multi(): IRedisPipeline;

  // ═══════════════════════════════════════════════════════════════════════════
  // Server Operations
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Remove all keys from the current database
   */
  flushdb(): Promise<'OK'>;

  /**
   * Remove all keys from all databases
   */
  flushall(): Promise<'OK'>;

  /**
   * Get information and statistics about the server
   */
  info(section?: string): Promise<string>;

  /**
   * Return the number of keys in the currently-selected database
   */
  dbsize(): Promise<number>;

  /**
   * Find all keys matching the pattern
   */
  keys(pattern: string): Promise<string[]>;

  /**
   * Return the type of a key
   */
  type(key: string): Promise<string>;

  /**
   * Rename a key
   */
  rename(key: string, newKey: string): Promise<'OK'>;

  /**
   * Rename a key, only if the new key does not exist
   */
  renamenx(key: string, newKey: string): Promise<number>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Type Guards
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if client is ready for commands
 */
export function isRedisClientReady(client: IRedisClient): boolean {
  return client.status === 'ready';
}

/**
 * Check if client is still alive (not ended)
 */
export function isRedisClientAlive(client: IRedisClient): boolean {
  const status = client.status;
  return status !== 'end' && status !== 'close';
}

/**
 * Check if client is connecting or connected
 */
export function isRedisClientConnecting(client: IRedisClient): boolean {
  const status = client.status;
  return status === 'connecting' || status === 'connect' || status === 'ready';
}
