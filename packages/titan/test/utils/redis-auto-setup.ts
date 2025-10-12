/**
 * Universal Redis auto-setup utility for tests
 *
 * This utility provides automatic Docker Redis container management for tests.
 * It eliminates the need to manually start Redis before running tests.
 *
 * Usage:
 *
 * ```typescript
 * import { setupRedisContainer } from '../utils/redis-auto-setup.js';
 *
 * describe('My Redis Test', () => {
 *   const redis = setupRedisContainer();
 *
 *   it('should use Redis', async () => {
 *     const client = redis.getClient();
 *     await client.set('key', 'value');
 *     expect(await client.get('key')).toBe('value');
 *   });
 * });
 * ```
 */

import { RedisTestManager, RedisTestContainer } from './redis-test-manager.js';
import type Redis from 'ioredis';

export interface RedisContainerSetup {
  /**
   * Get the Redis client for the current test container
   */
  getClient(): Redis;

  /**
   * Get the container URL
   */
  getUrl(): string;

  /**
   * Get the full container info
   */
  getContainer(): RedisTestContainer;

  /**
   * Get connection details
   */
  getConnection(): { host: string; port: number };
}

/**
 * Setup automatic Redis container for a test suite
 *
 * Creates a new isolated Redis container before each test and cleans up after.
 * Returns an object with helper methods to access the container.
 *
 * @param options - Optional configuration
 * @returns Object with helper methods to access Redis
 *
 * @example
 * ```typescript
 * describe('My Test Suite', () => {
 *   const redis = setupRedisContainer();
 *
 *   it('should work', async () => {
 *     const client = redis.getClient();
 *     await client.set('test', 'value');
 *   });
 * });
 * ```
 */
export function setupRedisContainer(options?: {
  /**
   * Container name prefix
   */
  name?: string;

  /**
   * Verbose logging
   */
  verbose?: boolean;

  /**
   * Timeout for beforeEach/afterEach (default: 30000ms)
   */
  timeout?: number;
}): RedisContainerSetup {
  let container: RedisTestContainer | null = null;
  let manager: RedisTestManager | null = null;

  // Initialize manager once
  beforeAll(() => {
    manager = RedisTestManager.getInstance({
      verbose: options?.verbose || process.env.REDIS_VERBOSE === 'true',
    });
  });

  // Create new container for each test
  beforeEach(async () => {
    if (!manager) {
      throw new Error('RedisTestManager not initialized');
    }
    container = await manager.createContainer(options?.name);
  }, options?.timeout || 30000);

  // Cleanup after each test
  afterEach(async () => {
    if (container) {
      await container.cleanup();
      container = null;
    }
  });

  // Return helper object
  return {
    getClient() {
      if (!container?.client) {
        throw new Error('Redis container not initialized. This method must be called inside a test (it/test block).');
      }
      return container.client;
    },

    getUrl() {
      if (!container) {
        throw new Error('Redis container not initialized. This method must be called inside a test (it/test block).');
      }
      return container.url;
    },

    getContainer() {
      if (!container) {
        throw new Error('Redis container not initialized. This method must be called inside a test (it/test block).');
      }
      return container;
    },

    getConnection() {
      if (!container) {
        throw new Error('Redis container not initialized. This method must be called inside a test (it/test block).');
      }
      return {
        host: container.host,
        port: container.port,
      };
    },
  };
}

/**
 * Setup automatic Redis container for a test suite (shared across all tests)
 *
 * Creates ONE Redis container for the entire suite and cleans up after all tests.
 * Use this when tests don't need isolation.
 *
 * @param options - Optional configuration
 * @returns Object with helper methods to access Redis
 *
 * @example
 * ```typescript
 * describe('My Test Suite', () => {
 *   const redis = setupSharedRedisContainer();
 *
 *   it('test 1', async () => {
 *     await redis.getClient().set('key1', 'value1');
 *   });
 *
 *   it('test 2', async () => {
 *     // Can see data from test 1 (shared container)
 *     const value = await redis.getClient().get('key1');
 *   });
 * });
 * ```
 */
export function setupSharedRedisContainer(options?: {
  name?: string;
  verbose?: boolean;
  timeout?: number;
}): RedisContainerSetup {
  let container: RedisTestContainer | null = null;
  let manager: RedisTestManager | null = null;

  // Create container once for the entire suite
  beforeAll(async () => {
    manager = RedisTestManager.getInstance({
      verbose: options?.verbose || process.env.REDIS_VERBOSE === 'true',
    });
    container = await manager.createContainer(options?.name);
  }, options?.timeout || 30000);

  // Cleanup after all tests
  afterAll(async () => {
    if (container) {
      await container.cleanup();
      container = null;
    }
  });

  // Return helper object
  return {
    getClient() {
      if (!container?.client) {
        throw new Error('Redis container not initialized. Ensure tests run after beforeAll completes.');
      }
      return container.client;
    },

    getUrl() {
      if (!container) {
        throw new Error('Redis container not initialized. Ensure tests run after beforeAll completes.');
      }
      return container.url;
    },

    getContainer() {
      if (!container) {
        throw new Error('Redis container not initialized. Ensure tests run after beforeAll completes.');
      }
      return container;
    },

    getConnection() {
      if (!container) {
        throw new Error('Redis container not initialized. Ensure tests run after beforeAll completes.');
      }
      return {
        host: container.host,
        port: container.port,
      };
    },
  };
}

/**
 * Alternative setup for compatibility with existing test patterns
 *
 * Returns connection config directly for use in constructors.
 *
 * @example
 * ```typescript
 * describe('My Test Suite', () => {
 *   const { getRedisUrl, getRedisConfig } = setupRedisForTests();
 *
 *   beforeEach(async () => {
 *     manager = new NotificationManager({
 *       redis: getRedisUrl(),
 *       // ... other config
 *     });
 *   });
 * });
 * ```
 */
export function setupRedisForTests(options?: { name?: string; verbose?: boolean; timeout?: number }) {
  const setup = setupRedisContainer(options);

  return {
    getRedisUrl: () => setup.getUrl(),
    getRedisConfig: () => setup.getConnection(),
    getRedisClient: () => setup.getClient(),
    getContainer: () => setup.getContainer(),
  };
}
