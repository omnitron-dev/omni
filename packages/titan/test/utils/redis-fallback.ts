import Redis from 'ioredis';
import { execSync } from 'child_process';

/**
 * Fallback Redis connection for environments without Docker
 */
export class RedisFallback {
  static async getConnection(): Promise<{
    client: Redis;
    url: string;
    cleanup: () => Promise<void>;
  } | null> {
    // Try different connection methods in order of preference

    // 1. Try Docker if available
    if (await this.isDockerAvailable()) {
      console.log('Docker detected, use npm run redis:start');
      return null;
    }

    // 2. Try local Redis server
    const localRedis = await this.tryLocalRedis();
    if (localRedis) {
      console.log('Using local Redis server at localhost:6379');
      return localRedis;
    }

    // 3. Try Redis in common development locations
    const devRedis = await this.tryDevelopmentRedis();
    if (devRedis) {
      console.log(`Using development Redis at ${devRedis.url}`);
      return devRedis;
    }

    // No Redis available
    console.log(`
      ⚠️  Redis is required for these tests but not available.

      To run Redis tests, you need one of the following:

      1. Docker (recommended):
         - Install Docker: https://docs.docker.com/get-docker/
         - Run: npm run redis:start

      2. Local Redis:
         - macOS: brew install redis && brew services start redis
         - Ubuntu: sudo apt-get install redis-server
         - Windows: Use WSL2 or Docker Desktop

      3. Remote Redis:
         - Set REDIS_URL environment variable
         - Example: REDIS_URL=redis://localhost:6379 npm test
    `);

    return null;
  }

  private static async isDockerAvailable(): Promise<boolean> {
    try {
      // Use 'docker' command which will search PATH
      // Works cross-platform (docker on Unix, docker.exe on Windows)
      execSync('docker version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private static async tryLocalRedis(): Promise<{
    client: Redis;
    url: string;
    cleanup: () => Promise<void>;
  } | null> {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      const client = new Redis(url, {
        connectTimeout: 1000,
        retryStrategy: () => null,
        lazyConnect: false,
      });

      await client.ping();

      return {
        client,
        url,
        cleanup: async () => {
          if (client.status === 'ready') {
            await client.quit();
          }
        },
      };
    } catch (error) {
      return null;
    }
  }

  private static async tryDevelopmentRedis(): Promise<{
    client: Redis;
    url: string;
    cleanup: () => Promise<void>;
  } | null> {
    // Common development Redis ports
    const ports = [6379, 6380, 16379, 26379, 36379];

    for (const port of ports) {
      const url = `redis://localhost:${port}`;
      try {
        const client = new Redis(url, {
          connectTimeout: 500,
          retryStrategy: () => null,
          lazyConnect: false,
        });

        await client.ping();

        return {
          client,
          url,
          cleanup: async () => {
            if (client.status === 'ready') {
              await client.quit();
            }
          },
        };
      } catch {
        // Try next port
        continue;
      }
    }

    return null;
  }

  static async checkRedisCommand(): Promise<boolean> {
    try {
      execSync('redis-cli ping', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  static getSetupInstructions(): string {
    const platform = process.platform;

    if (platform === 'darwin') {
      return `
        macOS Setup:
        1. Install Homebrew: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
        2. Install Redis: brew install redis
        3. Start Redis: brew services start redis
        4. Verify: redis-cli ping
      `;
    } else if (platform === 'linux') {
      return `
        Linux Setup (Ubuntu/Debian):
        1. Update packages: sudo apt-get update
        2. Install Redis: sudo apt-get install redis-server
        3. Start Redis: sudo systemctl start redis-server
        4. Enable on boot: sudo systemctl enable redis-server
        5. Verify: redis-cli ping

        Linux Setup (RHEL/CentOS):
        1. Install EPEL: sudo yum install epel-release
        2. Install Redis: sudo yum install redis
        3. Start Redis: sudo systemctl start redis
        4. Enable on boot: sudo systemctl enable redis
        5. Verify: redis-cli ping
      `;
    } else if (platform === 'win32') {
      return `
        Windows Setup:

        Option 1 - WSL2 (Recommended):
        1. Install WSL2: wsl --install
        2. Open Ubuntu in WSL2
        3. Run: sudo apt-get update && sudo apt-get install redis-server
        4. Start Redis: sudo service redis-server start

        Option 2 - Docker Desktop:
        1. Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/
        2. Run: docker run -d -p 6379:6379 redis:alpine

        Option 3 - Native Windows (Memurai):
        1. Download Memurai: https://www.memurai.com/get-memurai
        2. Install and run Memurai
        3. Verify: redis-cli ping
      `;
    } else {
      return `
        Generic Setup:
        1. Install Docker: https://docs.docker.com/get-docker/
        2. Run: docker run -d -p 6379:6379 redis:alpine
        3. Verify: docker exec <container-id> redis-cli ping
      `;
    }
  }
}
