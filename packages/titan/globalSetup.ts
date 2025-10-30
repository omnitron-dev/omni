/**
 * Jest Global Setup
 * Runs once before all test suites
 */

import { startGlobalRedis } from './test/setup/redis-docker-setup.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function globalSetup() {
  console.log('[Global Setup] Starting global Redis container...');

  try {
    const redisInfo = await startGlobalRedis();

    // Write Redis info to a file so individual tests can read it
    const infoFile = join(__dirname, '.redis-test-info.json');
    writeFileSync(infoFile, JSON.stringify(redisInfo, null, 2));

    console.log(`[Global Setup] Global Redis ready at ${redisInfo.url}`);

    // Store in global for teardown
    (global as any).__REDIS_INFO__ = redisInfo;
  } catch (error) {
    console.error('[Global Setup] Failed to start Redis:', error);
    // Don't fail setup - tests will fall back to localhost
  }
}
