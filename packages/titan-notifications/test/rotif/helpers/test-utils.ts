import { Redis } from 'ioredis';
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
  // Endpoint published by a globalSetup, if one ran.
  let globalRedis: { url?: string } | undefined;
  try {
    const infoFile = join(process.cwd(), '.redis-test-info.json');
    globalRedis = JSON.parse(readFileSync(infoFile, 'utf-8'));
  } catch {
    // No info file — fall through to the environment defaults below.
  }

  const defaultPort = process.env.TEST_REDIS_PORT ?? '16379';
  const baseUrl = process.env['REDIS_URL'] || process.env['TEST_REDIS_URL'] || globalRedis?.url || `redis://localhost:${defaultPort}`;
  return db !== undefined ? `${baseUrl}/${toTestDb(db)}` : baseUrl;
}

/**
 * Host/port/db form of the same endpoint, for specs that build an ioredis
 * client by parts rather than from a URL.
 */
export function getTestRedisConfig(db = 0): { url: string; host: string; port: number; db: number } {
  const url = new URL(getTestRedisUrl(db));
  return {
    url: url.toString(),
    host: url.hostname,
    port: Number(url.port || 6379),
    db: toTestDb(db),
  };
}

/**
 * Create test configuration for NotificationManager
 * @param db - Database number (default: 1)
 * @param additionalConfig - Additional configuration options
 * @returns Configuration object for NotificationManager
 */
/**
 * Pick this worker's Redis database.
 *
 * Redis logical DBs 0-4 belong to the apps/omnitron suites; rotif gets 5-12.
 *
 * The db number a spec asks for is deliberately IGNORED. Nearly every suite
 * here calls `flushdb()` in beforeEach, and 22 of them asked for db 0 with 31
 * asking for db 1 — so in parallel they erased each other's streams mid-test
 * and subscribers appeared to receive nothing. Every file uses exactly one
 * database, so partitioning by worker rather than by requested number removes
 * the collision without giving up parallelism: files that share a worker run
 * one after another, which is precisely when `flushdb` is safe.
 *
 * Capped at 8 to match `maxWorkers` in vitest.config.ts — that pairing is what
 * guarantees two concurrently running files never land on the same database.
 */
const WORKER_DB_SLOTS = 8;
const WORKER_ID = Number(process.env['VITEST_POOL_ID'] ?? process.env['VITEST_WORKER_ID'] ?? 1);

export function toTestDb(_requestedDb: number): number {
  return 5 + ((Math.max(1, WORKER_ID) - 1) % WORKER_DB_SLOTS);
}

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
export async function createTestNotificationManager(
  db: number = 1,
  additionalConfig: any = {}
): Promise<NotificationManager> {
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

/** Alias kept for the specs migrated from titan, which import this name. */
export const isRedisInMockMode = isInMockMode;
