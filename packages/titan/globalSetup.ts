/**
 * Jest Global Setup
 * Runs once before all test suites
 *
 * Note: This runs in CommonJS context, so we inline the Docker logic
 */

const { execFileSync, execSync } = require('child_process');
const { writeFileSync } = require('fs');
const { join } = require('path');

module.exports = async function globalSetup() {
  console.log('[Global Setup] Starting global Redis container...');

  try {
    const dockerPath = process.platform === 'win32' ? 'docker' : '/usr/local/bin/docker';

    // Remove existing container if it exists
    try {
      execFileSync(dockerPath, ['rm', '-f', 'test-redis-global'], {
        stdio: 'ignore',
      });
    } catch {
      // Ignore if doesn't exist
    }

    // Generate random port
    const port = 10000 + Math.floor(Math.random() * 10000);

    // Start Redis container
    const containerId = execFileSync(
      dockerPath,
      [
        'run',
        '-d',
        '--name',
        'test-redis-global',
        '-p',
        `${port}:6379`,
        '--health-cmd',
        'redis-cli ping',
        '--health-interval',
        '1s',
        '--health-timeout',
        '3s',
        '--health-retries',
        '5',
        '--health-start-period',
        '2s',
        'redis:7-alpine',
      ],
      { encoding: 'utf-8' }
    ).trim();

    console.log(`[Global Setup] Started Redis container ${containerId.substring(0, 12)} on port ${port}`);

    // Wait for health check
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      try {
        const health = execFileSync(dockerPath, ['inspect', '--format={{.State.Health.Status}}', 'test-redis-global'], {
          encoding: 'utf-8',
        }).trim();

        if (health === 'healthy') {
          healthy = true;
          break;
        }
      } catch {
        // Container not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!healthy) {
      throw new Error('Redis container failed to become healthy within 30 seconds');
    }

    const redisInfo = {
      url: `redis://localhost:${port}`,
      port: port,
      isDocker: true,
      containerId: containerId,
    };

    // Write Redis info to file
    const infoFile = join(__dirname, '.redis-test-info.json');
    writeFileSync(infoFile, JSON.stringify(redisInfo, null, 2));

    console.log(`[Global Setup] Global Redis ready at redis://localhost:${port}`);

    // Store in global for teardown
    global.__REDIS_INFO__ = redisInfo;
  } catch (error) {
    console.warn('[Global Setup] Failed to start Docker Redis, falling back to localhost:6379');
    console.warn(error.message);

    // Write fallback info
    const redisInfo = {
      url: 'redis://localhost:6379',
      port: 6379,
      isDocker: false,
    };

    const infoFile = join(__dirname, '.redis-test-info.json');
    writeFileSync(infoFile, JSON.stringify(redisInfo, null, 2));

    console.log('[Global Setup] Tests will use localhost:6379');
  }
};
