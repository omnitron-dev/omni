/**
 * Jest Global Teardown
 * Runs once after all test suites
 */

import { stopGlobalRedis } from './test/setup/redis-docker-setup.js';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';

export default async function globalTeardown() {
  console.log('[Global Teardown] Stopping global Redis container...');

  try {
    await stopGlobalRedis();

    // Clean up info file
    try {
      const infoFile = join(__dirname, '.redis-test-info.json');
      unlinkSync(infoFile);
    } catch {
      // Ignore if file doesn't exist
    }

    console.log('[Global Teardown] Cleanup complete');
  } catch (error) {
    console.error('[Global Teardown] Error during cleanup:', error);
  }
}
