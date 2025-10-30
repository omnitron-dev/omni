/**
 * Jest Global Teardown
 * Runs once after all test suites
 *
 * Note: This runs in CommonJS context
 */

const { execFileSync } = require('child_process');
const { unlinkSync, readFileSync } = require('fs');
const { join } = require('path');

module.exports = async function globalTeardown() {
  console.log('[Global Teardown] Stopping global Redis container...');

  try {
    // Read Redis info to see if we created a Docker container
    let redisInfo;
    try {
      const infoFile = join(__dirname, '.redis-test-info.json');
      redisInfo = JSON.parse(readFileSync(infoFile, 'utf-8'));
    } catch {
      redisInfo = global.__REDIS_INFO__;
    }

    // If we created a Docker container, stop it
    if (redisInfo && redisInfo.isDocker) {
      const dockerPath = process.platform === 'win32' ? 'docker' : '/usr/local/bin/docker';

      try {
        console.log('[Global Teardown] Stopping Redis container...');
        execFileSync(dockerPath, ['stop', 'test-redis-global'], { stdio: 'ignore' });
        execFileSync(dockerPath, ['rm', 'test-redis-global'], { stdio: 'ignore' });
        console.log('[Global Teardown] Redis container stopped');
      } catch (error) {
        console.warn('[Global Teardown] Error stopping container:', error.message);
      }
    }

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
};
