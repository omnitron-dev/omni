/**
 * Redis Docker Test Helper
 * Manages Redis containers for testing
 */

import { execSync } from 'child_process';
import Redis from 'ioredis';

export class RedisDockerTestHelper {
  private static containerName = 'test-redis-notifications';
  private static port = 36379; // Use a different port to avoid conflicts
  private static redis?: Redis;
  private static dockerPath?: string;

  /**
   * Find Docker executable path across different platforms
   */
  private static findDockerPath(): string {
    if (this.dockerPath) {
      return this.dockerPath;
    }

    const isWindows = process.platform === 'win32';
    const whichCommand = isWindows ? 'where' : 'which';
    const dockerBinary = isWindows ? 'docker.exe' : 'docker';

    // Strategy 1: Try to find Docker in PATH
    try {
      const result = execSync(`${whichCommand} ${dockerBinary}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      const dockerPath = result.split('\n')[0].trim();
      if (dockerPath && this.testDockerPath(dockerPath)) {
        this.dockerPath = dockerPath;
        return dockerPath;
      }
    } catch {
      // Continue to fallback paths
    }

    // Strategy 2: Check platform-specific common locations
    const fallbackPaths = this.getDockerFallbackPaths();
    for (const path of fallbackPaths) {
      if (this.testDockerPath(path)) {
        this.dockerPath = path;
        return path;
      }
    }

    // Strategy 3: Try just 'docker' and hope it's in PATH
    if (this.testDockerPath(dockerBinary)) {
      this.dockerPath = dockerBinary;
      return dockerBinary;
    }

    throw new Error(
      `Docker not found. Please install Docker and ensure it's in your PATH.\n` +
        `Platform: ${process.platform}\n` +
        `Visit: https://docs.docker.com/get-docker/`
    );
  }

  private static getDockerFallbackPaths(): string[] {
    switch (process.platform) {
      case 'darwin':
        return [
          '/usr/local/bin/docker',
          '/opt/homebrew/bin/docker',
          '/Applications/Docker.app/Contents/Resources/bin/docker',
        ];
      case 'linux':
        return [
          '/usr/bin/docker',
          '/usr/local/bin/docker',
          '/snap/bin/docker',
        ];
      case 'win32':
        return [
          'docker.exe',
          'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
        ];
      default:
        return ['/usr/local/bin/docker', '/usr/bin/docker', 'docker'];
    }
  }

  private static testDockerPath(path: string): boolean {
    try {
      execSync(`"${path}" version`, { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Start Redis container for testing
   */
  static async startRedis(): Promise<Redis> {
    try {
      const docker = this.findDockerPath();

      // Check if container already exists
      try {
        execSync(`"${docker}" inspect ${this.containerName}`, { stdio: 'ignore' });
        // Container exists, remove it
        execSync(`"${docker}" rm -f ${this.containerName}`, { stdio: 'ignore' });
      } catch {
        // Container doesn't exist, continue
      }

      // Start new Redis container
      console.log('Starting Redis container for testing...');
      execSync(
        `"${docker}" run -d --name ${this.containerName} -p ${this.port}:6379 redis:7-alpine`,
        { stdio: 'pipe' }
      );

      // Wait for Redis to be ready
      await this.waitForRedis();

      // Create and return Redis client
      this.redis = new Redis({
        host: 'localhost',
        port: this.port,
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => {
          if (times > 3) return null;
          return Math.min(times * 100, 2000);
        }
      });

      await this.redis.ping();
      console.log('Redis container started successfully');
      return this.redis;
    } catch (error) {
      console.error('Failed to start Redis container:', error);
      throw error;
    }
  }

  /**
   * Stop and remove Redis container
   */
  static async stopRedis(): Promise<void> {
    try {
      if (this.redis) {
        this.redis.disconnect();
        this.redis = undefined;
      }

      const docker = this.findDockerPath();

      console.log('Stopping Redis container...');
      execSync(`"${docker}" stop ${this.containerName}`, { stdio: 'ignore' });
      execSync(`"${docker}" rm ${this.containerName}`, { stdio: 'ignore' });
      console.log('Redis container stopped');
    } catch (error) {
      // Ignore errors when stopping
      console.warn('Warning: Failed to stop Redis container:', error);
    }
  }

  /**
   * Wait for Redis to be ready
   */
  private static async waitForRedis(maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const testClient = new Redis({
          host: 'localhost',
          port: this.port,
          retryStrategy: () => null,
          lazyConnect: false
        });

        await testClient.ping();
        testClient.disconnect();
        return;
      } catch (error) {
        if (i === maxAttempts - 1) {
          throw new Error('Redis container failed to start in time');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Create Redis clients for testing
   */
  static createClients() {
    const options = {
      host: 'localhost',
      port: this.port,
      maxRetriesPerRequest: 3
    };

    return {
      redis: new Redis(options),
      pubRedis: new Redis(options),
      subRedis: new Redis(options)
    };
  }

  /**
   * Clean up test data
   */
  static async cleanup(redis: Redis, pattern: string): Promise<void> {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}