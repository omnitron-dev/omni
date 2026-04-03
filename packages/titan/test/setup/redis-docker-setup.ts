/**
 * Global Redis Docker Setup for Tests
 *
 * Automatically starts a Docker Redis container for tests that need Redis
 * Falls back to localhost if Docker is not available
 */

import { DockerTestManager } from '../utils/docker-test-manager.js';
import type { DockerContainer } from '../utils/docker-test-manager.js';

let globalRedisContainer: DockerContainer | null = null;
let globalRedisPort: number | null = null;

/**
 * Start global Redis container for tests
 * @returns Redis connection URL
 */
export async function startGlobalRedis(): Promise<{ url: string; port: number; isDocker: boolean }> {
  // Check if already started
  if (globalRedisContainer && globalRedisPort) {
    return {
      url: `redis://localhost:${globalRedisPort}`,
      port: globalRedisPort,
      isDocker: true,
    };
  }

  // Try to start Docker container
  try {
    const dockerManager = DockerTestManager.getInstance();

    // Remove existing container if it exists (from previous failed test run)
    try {
      const { execFileSync } = await import('node:child_process');
      // Try common Docker paths
      const dockerPath = process.platform === 'win32' ? 'docker' : '/usr/local/bin/docker';
      execFileSync(dockerPath, ['rm', '-f', 'test-redis-global'], {
        stdio: 'ignore',
      });
    } catch {
      // Ignore if container doesn't exist or docker not available
    }

    globalRedisContainer = await dockerManager.createContainer({
      name: 'test-redis-global',
      image: 'redis:7-alpine',
      ports: { 6379: 'auto' },
      healthcheck: {
        test: ['CMD', 'redis-cli', 'ping'],
        interval: '1s',
        timeout: '3s',
        retries: 5,
        startPeriod: '2s',
      },
      waitFor: {
        healthcheck: true,
        timeout: 30000,
      },
    });

    globalRedisPort = globalRedisContainer.ports.get(6379)!;

    console.log(`[Redis Setup] Started Docker Redis on port ${globalRedisPort}`);

    return {
      url: `redis://localhost:${globalRedisPort}`,
      port: globalRedisPort,
      isDocker: true,
    };
  } catch (error) {
    console.warn(`[Redis Setup] Failed to start Docker Redis, falling back to localhost:6379`, error);

    // Fall back to localhost
    return {
      url: 'redis://localhost:6379',
      port: 6379,
      isDocker: false,
    };
  }
}

/**
 * Stop global Redis container
 */
export async function stopGlobalRedis(): Promise<void> {
  if (globalRedisContainer) {
    console.log('[Redis Setup] Stopping global Redis container');
    try {
      await globalRedisContainer.cleanup();
    } catch (error) {
      console.error('[Redis Setup] Error stopping Redis container:', error);
    }
    globalRedisContainer = null;
    globalRedisPort = null;
  }
}

/**
 * Get global Redis connection info
 */
export function getGlobalRedisInfo(): { url: string; port: number } | null {
  if (!globalRedisPort) {
    return null;
  }

  return {
    url: `redis://localhost:${globalRedisPort}`,
    port: globalRedisPort,
  };
}

/**
 * Check if global Redis is available
 */
export function isGlobalRedisAvailable(): boolean {
  return globalRedisPort !== null;
}
