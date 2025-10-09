import { Redis, ChainableCommander } from 'ioredis';
import { isCluster } from './redis.utils.js';
import { Errors } from '../../errors/index.js';
import { RedisClient } from './redis.types.js';
import { RedisManager } from './redis.manager.js';

export class RedisService {
  constructor(private readonly manager: RedisManager) {}

  getClient(namespace?: string): RedisClient {
    return this.manager.getClient(namespace);
  }

  getOrThrow(namespace?: string): RedisClient {
    const client = this.getClient(namespace);
    if (!client) {
      throw Errors.notFound('Redis client', namespace || 'default');
    }
    return client;
  }

  getOrNil(namespace?: string): RedisClient | null {
    try {
      return this.getClient(namespace);
    } catch {
      return null;
    }
  }

  async ping(namespace?: string): Promise<boolean> {
    return this.manager.isHealthy(namespace);
  }

  isReady(namespace?: string): boolean {
    const client = this.getClient(namespace);
    return client.status === 'ready';
  }

  async loadScript(
    name: string,
    content: string,
    namespace?: string,
  ): Promise<string> {
    const client = this.getClient(namespace);
    const sha = await client.script('LOAD', content) as string;

    return sha;
  }

  async runScript<T = any>(
    name: string,
    keys: string[],
    args: (string | number)[],
    namespace?: string,
  ): Promise<T> {
    return this.manager.runScript<T>(name, keys, args, namespace);
  }

  createSubscriber(namespace?: string): RedisClient {
    const client = this.getClient(namespace);

    if (isCluster(client)) {
      return client.duplicate();
    }

    const redis = client as Redis;
    return redis.duplicate();
  }

  async publish(
    channel: string,
    message: any,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    const payload = typeof message === 'string' ? message : JSON.stringify(message);
    return client.publish(channel, payload);
  }

  pipeline(namespace?: string): ChainableCommander {
    const client = this.getClient(namespace);
    return client.pipeline();
  }

  multi(namespace?: string): ChainableCommander {
    const client = this.getClient(namespace);
    // Note: multi is not fully supported in cluster mode for cross-slot operations
    // but we allow it for single-slot operations
    return client.multi();
  }

  async get(key: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.get(key);
  }

  async set(
    key: string,
    value: string | number,
    ttl?: number,
    namespace?: string,
  ): Promise<'OK' | null> {
    const client = this.getClient(namespace);

    if (ttl) {
      return client.set(key, value, 'EX', ttl);
    }

    return client.set(key, value);
  }

  async setex(
    key: string,
    ttl: number,
    value: string | number,
    namespace?: string,
  ): Promise<'OK'> {
    const client = this.getClient(namespace);
    return client.setex(key, ttl, value);
  }

  async setnx(
    key: string,
    value: string | number,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return client.setnx(key, value);
  }

  async del(keys: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(keys) ? client.del(...keys) : client.del(keys);
  }

  async exists(keys: string | string[], namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(keys) ? client.exists(...keys) : client.exists(keys);
  }

  async incr(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.incr(key);
  }

  async incrby(
    key: string,
    increment: number,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return client.incrby(key, increment);
  }

  async decr(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.decr(key);
  }

  async decrby(
    key: string,
    decrement: number,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return client.decrby(key, decrement);
  }

  async expire(
    key: string,
    seconds: number,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return client.expire(key, seconds);
  }

  async ttl(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.ttl(key);
  }

  async hget(
    key: string,
    field: string,
    namespace?: string,
  ): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.hget(key, field);
  }

  async hset(
    key: string,
    field: string,
    value: string | number,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return client.hset(key, field, value);
  }

  async hgetall(
    key: string,
    namespace?: string,
  ): Promise<Record<string, string>> {
    const client = this.getClient(namespace);
    return client.hgetall(key);
  }

  async hdel(
    key: string,
    fields: string | string[],
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(fields)
      ? client.hdel(key, ...fields)
      : client.hdel(key, fields);
  }

  async sadd(
    key: string,
    members: string | string[],
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(members)
      ? client.sadd(key, ...members)
      : client.sadd(key, members);
  }

  async srem(
    key: string,
    members: string | string[],
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(members)
      ? client.srem(key, ...members)
      : client.srem(key, members);
  }

  async smembers(key: string, namespace?: string): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.smembers(key);
  }

  async sismember(
    key: string,
    member: string,
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return client.sismember(key, member);
  }

  async lpush(
    key: string,
    values: string | string[],
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(values)
      ? client.lpush(key, ...values)
      : client.lpush(key, values);
  }

  async rpush(
    key: string,
    values: string | string[],
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(values)
      ? client.rpush(key, ...values)
      : client.rpush(key, values);
  }

  async lpop(key: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.lpop(key);
  }

  async rpop(key: string, namespace?: string): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.rpop(key);
  }

  async lrange(
    key: string,
    start: number,
    stop: number,
    namespace?: string,
  ): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.lrange(key, start, stop);
  }

  async llen(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.llen(key);
  }

  async zadd(
    key: string,
    ...args: (string | number)[]
  ): Promise<number> {
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

  async zrem(
    key: string,
    members: string | string[],
    namespace?: string,
  ): Promise<number> {
    const client = this.getClient(namespace);
    return Array.isArray(members)
      ? client.zrem(key, ...members)
      : client.zrem(key, members);
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    namespace?: string,
  ): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.zrange(key, start, stop);
  }

  async zrevrange(
    key: string,
    start: number,
    stop: number,
    namespace?: string,
  ): Promise<string[]> {
    const client = this.getClient(namespace);
    return client.zrevrange(key, start, stop);
  }

  async zcard(key: string, namespace?: string): Promise<number> {
    const client = this.getClient(namespace);
    return client.zcard(key);
  }

  async zscore(
    key: string,
    member: string,
    namespace?: string,
  ): Promise<string | null> {
    const client = this.getClient(namespace);
    return client.zscore(key, member);
  }

  async eval(
    script: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<any> {
    const client = this.getClient();
    return client.eval(script, numkeys, ...args);
  }

  async evalsha(
    sha: string,
    numkeys: number,
    ...args: (string | number)[]
  ): Promise<any> {
    const client = this.getClient();
    return client.evalsha(sha, numkeys, ...args);
  }

  async flushdb(namespace?: string): Promise<'OK'> {
    const client = this.getClient(namespace);
    return client.flushdb();
  }

  async flushall(): Promise<'OK'> {
    const client = this.getClient();
    return client.flushall();
  }
}