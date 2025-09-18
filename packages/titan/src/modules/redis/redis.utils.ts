import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Redis, Cluster } from 'ioredis';

import { RedisClient, RedisClientOptions } from './redis.types.js';

export function isCluster(client: RedisClient): client is Cluster {
  return client instanceof Cluster;
}

export function getClientNamespace(options: RedisClientOptions): string {
  return options.namespace || 'default';
}

export function createRedisClient(options: RedisClientOptions = {}): RedisClient {
  if (options.cluster) {
    return new Cluster(options.cluster.nodes, {
      ...options,
      ...options.cluster.options,
      lazyConnect: options.lazyConnect ?? true,
    });
  }

  // Set default options
  const redisOptions = {
    host: options.host || 'localhost',
    port: options.port || 6379,
    ...options,
    lazyConnect: options.lazyConnect ?? true,
  };

  return new Redis(redisOptions);
}

export function generateScriptSha(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

export function loadScriptContent(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function createRetryStrategy(maxRetries = 10, maxDelay = 5000) {
  return (times: number) => {
    if (times > maxRetries) {
      return undefined;
    }

    const baseDelay = 100;
    const jitter = Math.random() * 100;
    const delay = Math.min(baseDelay * Math.pow(2, times - 1) + jitter, maxDelay);

    return delay;
  };
}

export function mergeOptions(
  commonOptions?: Partial<RedisClientOptions>,
  clientOptions?: RedisClientOptions,
): RedisClientOptions {
  if (!commonOptions) {
    return clientOptions || {};
  }

  const merged = { ...commonOptions };

  if (clientOptions) {
    Object.keys(clientOptions).forEach((key) => {
      const value = clientOptions[key as keyof RedisClientOptions];
      if (value !== undefined) {
        (merged as any)[key] = value;
      }
    });
  }

  return merged;
}

export async function waitForConnection(
  client: RedisClient,
  timeout = 5000,
): Promise<void> {
  // If already ready, return immediately
  if (client.status === 'ready') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Redis connection timeout after ${timeout}ms`));
    }, timeout);

    const onReady = () => {
      clearTimeout(timer);
      client.removeListener('error', onError);
      resolve();
    };

    const onError = (err: Error) => {
      clearTimeout(timer);
      client.removeListener('ready', onReady);
      reject(err);
    };

    client.once('ready', onReady);
    client.once('error', onError);
  });
}