import { RedisTestManager } from '../utils/redis-test-manager.js';
import { beforeAll, afterAll } from '@jest/globals';

// Global Redis test configuration
export interface RedisTestConfig {
  useRealRedis: boolean;
  autoCleanup: boolean;
  verbose: boolean;
  basePort: number;
}

export const redisTestConfig: RedisTestConfig = {
  useRealRedis: process.env.USE_REAL_REDIS === 'true' || process.env.CI === 'true',
  autoCleanup: process.env.REDIS_NO_CLEANUP !== 'true',
  verbose: process.env.REDIS_VERBOSE === 'true',
  basePort: parseInt(process.env.REDIS_BASE_PORT || '16379', 10),
};

// Initialize Redis test manager globally
let globalManager: RedisTestManager | undefined;

export function setupRedisTests(): void {
  beforeAll(async () => {
    if (redisTestConfig.useRealRedis) {
      globalManager = RedisTestManager.getInstance({
        basePort: redisTestConfig.basePort,
        cleanup: redisTestConfig.autoCleanup,
        verbose: redisTestConfig.verbose,
      });
    }
  });

  afterAll(async () => {
    if (globalManager && redisTestConfig.autoCleanup) {
      await globalManager.cleanupAll();
    }
  });
}

// Helper to skip tests if real Redis is not available
export function describeWithRedis(name: string, fn: () => void): void {
  if (!redisTestConfig.useRealRedis) {
    describe.skip(name, fn);
  } else {
    describe(name, fn);
  }
}

// Helper to conditionally run tests with real Redis
export function itWithRedis(name: string, fn: () => void | Promise<void>, timeout?: number): void {
  if (!redisTestConfig.useRealRedis) {
    it.skip(name, fn, timeout);
  } else {
    it(name, fn, timeout);
  }
}

// Export convenience functions
export { RedisTestManager } from '../utils/redis-test-manager';
export type { RedisTestContainer } from '../utils/redis-test-manager';
