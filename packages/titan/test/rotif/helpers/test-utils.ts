import { Redis } from 'ioredis';
import { getGlobalRedisInfo } from '../../setup/redis-docker-setup.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Get the test Redis URL from environment or use default
 * Automatically uses Docker Redis if available from global setup
 * @param db - Database number to append (optional)
 * @returns Redis connection string
 */
export function getTestRedisUrl(db?: number): string {
  // Try to use global Docker Redis setup first
  let globalRedis = getGlobalRedisInfo();

  // If not in memory, try to read from file (written by globalSetup)
  if (!globalRedis) {
    try {
      // File is in the titan package root
      const infoFile = '/Users/taaliman/projects/luxquant/omnitron-dev/omni/packages/titan/.redis-test-info.json';
      const info = JSON.parse(readFileSync(infoFile, 'utf-8'));
      globalRedis = info;
    } catch {
      // Ignore if file doesn't exist
    }
  }

  const baseUrl = process.env['REDIS_URL'] || globalRedis?.url || 'redis://localhost:6379';
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
    ...additionalConfig,
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
