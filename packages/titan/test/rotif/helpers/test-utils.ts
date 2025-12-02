import { Redis } from 'ioredis';
import { getGlobalRedisInfo } from '../../setup/redis-docker-setup.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NotificationManager } from '../../../src/rotif/rotif.js';

/**
 * Check if we're in mock mode
 */
export function isInMockMode(): boolean {
  // Check environment variable first
  if (process.env.USE_MOCK_REDIS === 'true') {
    return true;
  }

  // Check .redis-test-info.json
  try {
    const infoFile = join(process.cwd(), '.redis-test-info.json');
    if (existsSync(infoFile)) {
      const info = JSON.parse(readFileSync(infoFile, 'utf-8'));
      if (info.isMock === true) {
        return true;
      }
    }
  } catch {
    // Ignore
  }

  return false;
}

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
      // File is in the titan package root - use process.cwd() for portability
      // This works because Jest runs from the package directory
      const infoFile = join(process.cwd(), '.redis-test-info.json');
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
 * Create a NotificationManager for testing
 * Returns MockNotificationManager when in mock mode, real NotificationManager otherwise
 * @param db - Database number (default: 1)
 * @param additionalConfig - Additional configuration options
 * @returns NotificationManager or MockNotificationManager
 */
export async function createTestNotificationManager(db: number = 1, additionalConfig: any = {}): Promise<NotificationManager> {
  const config = createTestConfig(db, additionalConfig);

  if (isInMockMode()) {
    const { MockNotificationManager } = await import('./mock-rotif.js');
    return new MockNotificationManager(config) as unknown as NotificationManager;
  }

  const { NotificationManager } = await import('../../../src/rotif/rotif.js');
  return new NotificationManager(config);
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
