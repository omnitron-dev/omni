import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Redis, Cluster } from 'ioredis';

import { RedisClient, RedisClientOptions } from './redis.types.js';

export function isCluster(client: RedisClient): client is Cluster {
  return client instanceof Cluster;
}

export function getClientNamespace(options: RedisClientOptions): string {
  if (!options || !options.namespace) {
    return 'default';
  }

  // Convert to string if not already
  const namespace = String(options.namespace);

  // Return default if empty or whitespace
  if (namespace.trim() === '') {
    return 'default';
  }

  return namespace;
}

export function createRedisClient(options: RedisClientOptions = {}): RedisClient {
  if (options.cluster) {
    if (!options.cluster.nodes || options.cluster.nodes.length === 0) {
      throw new Error('Cluster configuration requires nodes');
    }
    return new Cluster(options.cluster.nodes, {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      showFriendlyErrorStack: true,
      ...options,
      ...options.cluster.options,
      lazyConnect: options.lazyConnect ?? true,
    });
  }

  // Set default options
  const redisOptions = {
    host: options.host || 'localhost',
    port: options.port || 6379,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    showFriendlyErrorStack: true,
    ...options,
    lazyConnect: options.lazyConnect ?? true,
  };

  return new Redis(redisOptions);
}

export function generateScriptSha(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

export function loadScriptContent(path: string, encoding: BufferEncoding = 'utf-8'): string {
  return readFileSync(path, encoding).trim();
}

export interface RetryStrategyOptions {
  retries?: number;
  minDelay?: number;
  maxDelay?: number;
  factor?: number;
}

export function createRetryStrategy(options: RetryStrategyOptions | number = {}, maxDelay?: number) {
  // Handle legacy calling pattern (maxRetries, maxDelay)
  if (typeof options === 'number') {
    const maxRetries = options;
    const max = maxDelay ?? 5000;
    return (times: number) => {
      if (times <= 0 || times > maxRetries) {
        return undefined;
      }
      const baseDelay = 100;
      const jitter = Math.random() * 100;
      const delay = Math.min(baseDelay * Math.pow(2, times - 1) + jitter, max);
      return delay;
    };
  }

  // New options-based pattern
  const {
    retries = 10,
    minDelay = 100,
    maxDelay: max = 10000,
    factor = 2,
  } = options;

  return (times: number) => {
    if (times <= 0 || times > retries) {
      return null;
    }

    const baseDelay = minDelay;
    const delay = Math.min(baseDelay * Math.pow(factor, times - 1), max);

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

  if (!clientOptions) {
    return { ...commonOptions };
  }

  const merged: any = { ...commonOptions };

  const processKey = (key: string | symbol) => {
    const baseValue = (commonOptions as any)[key];
    const overrideValue = (clientOptions as any)[key];

    if (overrideValue === undefined) {
      // Keep base value if override is undefined
      return;
    }

    if (overrideValue === null) {
      // Null explicitly overrides
      merged[key] = null;
    } else if (Array.isArray(overrideValue)) {
      // Arrays are replaced, not merged
      merged[key] = overrideValue;
    } else if (typeof overrideValue === 'object' && !Array.isArray(overrideValue) &&
               typeof baseValue === 'object' && !Array.isArray(baseValue) && baseValue !== null) {
      // Deep merge objects
      merged[key] = { ...baseValue, ...overrideValue };
    } else {
      // Primitive values or non-matching types - override
      merged[key] = overrideValue;
    }
  };

  // Process regular keys
  Object.keys(clientOptions).forEach(processKey);

  // Process symbol keys
  Object.getOwnPropertySymbols(clientOptions).forEach(processKey);

  return merged;
}

export async function waitForConnection(
  client: RedisClient,
  timeout = 5000,
): Promise<boolean> {
  // If already ready, return immediately
  if ((client as any).status === 'ready') {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let resolved = false;

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    const onReady = () => {
      cleanup();
      clearTimeout(timer);
      resolve(true);
    };

    const onError = (err: Error) => {
      cleanup();
      clearTimeout(timer);
      resolve(false);
    };

    // Set up listeners first, then check status again
    client.once('ready', onReady);
    client.once('error', onError);

    // Double-check status after setting up listeners (race condition fix)
    if (client.status === 'ready') {
      cleanup();
      clearTimeout(timer);
      resolve(true);
      return;
    }

    // Force connection if status is 'wait'
    if (client.status === 'wait') {
      client.connect().catch(() => {
        // Connection attempt failed, but error event will handle cleanup
      });
    }
  });
}