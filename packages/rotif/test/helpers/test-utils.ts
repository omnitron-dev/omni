import { Redis } from 'ioredis';

/**
 * Get the test Redis URL from environment or use default
 * @param db - Database number to append (optional)
 * @returns Redis connection string
 */
export function getTestRedisUrl(db?: number): string {
  const baseUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
  return db !== undefined ? `${baseUrl}/${db}` : baseUrl;
}

/**
 * Create test configuration for NotificationManager
 * @param db - Database number (default: 1)
 * @param additionalConfig - Additional configuration options
 * @returns Configuration object for NotificationManager
 */
export function createTestConfig(db: number = 1, additionalConfig: any = {}) {
  return {
    redis: getTestRedisUrl(db),
    ...additionalConfig
  };
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