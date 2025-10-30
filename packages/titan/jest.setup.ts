import { jest, beforeAll, afterAll } from '@jest/globals';
import { startGlobalRedis, stopGlobalRedis } from './test/setup/redis-docker-setup.js';

// Common test setup
jest.setTimeout(30000);

// Global Redis setup for tests
let globalRedisSetup: Awaited<ReturnType<typeof startGlobalRedis>> | null = null;

beforeAll(async () => {
  // Start global Redis container
  try {
    globalRedisSetup = await startGlobalRedis();
    console.log(`[Test Setup] Global Redis available at ${globalRedisSetup.url}`);
  } catch (error) {
    console.warn('[Test Setup] Failed to start global Redis, tests requiring Redis may fail:', error);
  }
}, 60000); // 60s timeout for Docker startup

afterAll(async () => {
  // Stop global Redis container
  if (globalRedisSetup?.isDocker) {
    await stopGlobalRedis();
  }
}, 30000);
