import { Redis } from 'ioredis';

import { getTestRedis } from './redis-test-helper';

/**
 * Create a Redis client for tests using the test Redis instance
 * @param db - Database number (default: 0)
 * @returns Redis client instance
 */
export function createTestRedisClient(db: number = 0): Redis {
  // Use environment variable if available, otherwise use test Redis helper
  if (process.env['REDIS_URL'] && !process.env['USE_TEST_REDIS_HELPER']) {
    const url = process.env['REDIS_URL'];
    const finalUrl = db !== 0 ? `${url}/${db}` : url;
    return new Redis(finalUrl);
  }

  const redisHelper = getTestRedis();
  return redisHelper.createClient(db);
}

/**
 * Get the test Redis connection string
 * @param db - Database number to append (optional)
 * @returns Redis connection string
 */
export function getTestRedisUrl(db?: number): string {
  // Use environment variable if available, otherwise use test Redis helper
  if (process.env['REDIS_URL'] && !process.env['USE_TEST_REDIS_HELPER']) {
    const baseUrl = process.env['REDIS_URL'];
    return db !== undefined ? `${baseUrl}/${db}` : baseUrl;
  }

  const redisHelper = getTestRedis();
  const baseUrl = redisHelper.getConnectionString();
  return db !== undefined ? `${baseUrl}/${db}` : baseUrl;
}

/**
 * Clean up Redis database for a test
 * @param redis - Redis client instance
 */
export async function cleanupRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}

/**
 * Create a unique test namespace to avoid conflicts
 * @param prefix - Prefix for the namespace
 * @returns Unique namespace string
 */
export function createTestNamespace(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
