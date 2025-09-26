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

  /**
   * Start Redis container for testing
   */
  static async startRedis(): Promise<Redis> {
    try {
      // Check if container already exists
      try {
        execSync(`/usr/local/bin/docker inspect ${this.containerName}`, { stdio: 'ignore' });
        // Container exists, remove it
        execSync(`/usr/local/bin/docker rm -f ${this.containerName}`, { stdio: 'ignore' });
      } catch {
        // Container doesn't exist, continue
      }

      // Start new Redis container
      console.log('Starting Redis container for testing...');
      execSync(
        `/usr/local/bin/docker run -d --name ${this.containerName} -p ${this.port}:6379 redis:7-alpine`,
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

      console.log('Stopping Redis container...');
      execSync(`/usr/local/bin/docker stop ${this.containerName}`, { stdio: 'ignore' });
      execSync(`/usr/local/bin/docker rm ${this.containerName}`, { stdio: 'ignore' });
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