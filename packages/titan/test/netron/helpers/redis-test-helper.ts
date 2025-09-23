import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import * as path from 'path';
import { Redis } from 'ioredis';
import { spawn, ChildProcess } from 'child_process';

export interface RedisTestConfig {
  port?: number;
  maxRetries?: number;
  startupTimeout?: number;
  useMock?: boolean; // Use mock Redis instead of real Redis
}

export class RedisTestHelper {
  private static instance: RedisTestHelper | null = null;
  private redisProcess: ChildProcess | null = null;
  private redisClient: Redis | null = null;
  private port: number;
  private dataDir: string;
  private isStarted: boolean = false;
  private useMock: boolean;

  private constructor(config: RedisTestConfig = {}) {
    this.port = config.port || this.findAvailablePort();
    this.dataDir = path.join(os.tmpdir(), `redis-test-${process.pid}-${this.port}`);
    this.useMock = config.useMock || false;
  }

  static getInstance(config?: RedisTestConfig): RedisTestHelper {
    if (!RedisTestHelper.instance) {
      RedisTestHelper.instance = new RedisTestHelper(config);
    }
    return RedisTestHelper.instance;
  }

  private findAvailablePort(): number {
    // Start from a non-standard port
    let port = 6400 + Math.floor(Math.random() * 100);
    while (this.isPortInUse(port)) {
      port++;
    }
    return port;
  }

  private isPortInUse(port: number): boolean {
    try {
      const server = net.createServer();
      server.listen(port, '127.0.0.1');
      server.close();
      return false;
    } catch {
      return true;
    }
  }

  private async checkRedisServer(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('which', ['redis-server']);
      check.on('close', (code) => resolve(code === 0));
      check.on('error', () => resolve(false));
    });
  }

  async start(): Promise<Redis> {
    if (this.isStarted && this.redisClient) {
      return this.redisClient;
    }

    // Use mock Redis if requested or in CI environment
    if (this.useMock || process.env['CI'] === 'true' || process.env['USE_MOCK_REDIS'] === 'true') {
      console.log('Using mock Redis for tests');
      const { MockRedis } = await import('./mock-redis.js');
      this.redisClient = new MockRedis() as any;
      this.isStarted = true;
      return this.redisClient as Redis;
    }

    // Check if redis-server is available
    const hasRedisServer = await this.checkRedisServer();
    if (!hasRedisServer) {
      // Try Docker alternative
      console.warn('redis-server not found, trying Docker alternative...');
      try {
        const dockerHelper = await import('./redis-test-helper-docker.js');
        const instance = dockerHelper.RedisDockerTestHelper.getInstance(this.port);
        this.redisClient = await instance.start();
        this.isStarted = true;
        return this.redisClient;
      } catch (error) {
        console.warn('Docker not available, falling back to mock Redis');
        const { MockRedis } = await import('./mock-redis.js');
        this.redisClient = new MockRedis() as any;
        this.isStarted = true;
        return this.redisClient as Redis;
      }
    }

    // Create data directory
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Start Redis server
    this.redisProcess = spawn(
      'redis-server',
      [
        '--port',
        this.port.toString(),
        '--bind',
        '127.0.0.1',
        '--dir',
        this.dataDir,
        '--save',
        '', // Disable persistence for tests
        '--appendonly',
        'no',
        '--loglevel',
        'warning',
      ],
      {
        stdio: 'pipe',
      }
    );

    this.redisProcess.on('error', (error) => {
      console.error('Failed to start Redis:', error);
      throw new Error(`Failed to start Redis: ${error.message}`);
    });

    // Wait for Redis to be ready
    await this.waitForRedis();

    // Create Redis client
    this.redisClient = new Redis({
      port: this.port,
      host: '127.0.0.1',
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 50, 200);
      },
    });

    this.isStarted = true;
    return this.redisClient;
  }

  private async waitForRedis(timeout: number = 5000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const testClient = new Redis({
          port: this.port,
          host: '127.0.0.1',
          lazyConnect: true,
          retryStrategy: () => null,
        });

        await testClient.connect();
        await testClient.ping();
        testClient.disconnect();
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Redis failed to start within ${timeout}ms`);
  }

  async stop(): Promise<void> {
    if (this.redisClient) {
      this.redisClient.disconnect();
      this.redisClient = null;
    }

    if (this.redisProcess) {
      await new Promise<void>((resolve) => {
        this.redisProcess!.on('exit', () => resolve());
        this.redisProcess!.kill('SIGTERM');

        // Force kill after 2 seconds if not terminated
        setTimeout(() => {
          if (this.redisProcess && !this.redisProcess.killed) {
            this.redisProcess.kill('SIGKILL');
          }
          resolve();
        }, 2000);
      });

      this.redisProcess = null;
    }

    // Stop any docker helper instances
    try {
      const dockerHelper = await import('./redis-test-helper-docker.js');
      const instance = dockerHelper.RedisDockerTestHelper.getInstance(this.port);
      await instance.stop();
    } catch {
      // Ignore if docker helper not used
    }

    // Clean up data directory
    if (fs.existsSync(this.dataDir)) {
      fs.rmSync(this.dataDir, { recursive: true, force: true });
    }

    this.isStarted = false;
    RedisTestHelper.instance = null;
  }

  async cleanup(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.flushall();
    }
  }

  getPort(): number {
    return this.port;
  }

  getConnectionString(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  getClient(): Redis | null {
    return this.redisClient;
  }

  createClient(db: number = 0): Redis {
    return new Redis({
      port: this.port,
      host: '127.0.0.1',
      db,
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });
  }
}

// Global setup and teardown helpers
let globalRedisHelper: RedisTestHelper | null = null;

export async function setupRedisForTests(): Promise<RedisTestHelper> {
  globalRedisHelper = RedisTestHelper.getInstance();
  await globalRedisHelper.start();
  return globalRedisHelper;
}

export async function teardownRedisForTests(): Promise<void> {
  if (globalRedisHelper) {
    await globalRedisHelper.stop();
    globalRedisHelper = null;
  }

  // Also stop any Docker instances
  try {
    const dockerHelper = await import('./redis-test-helper-docker.js');
    await dockerHelper.RedisDockerTestHelper.stopAllInstances();
  } catch {
    // Ignore if docker helper is not available
  }
}

export function getTestRedis(): RedisTestHelper {
  if (!globalRedisHelper) {
    throw new Error('Redis test helper not initialized. Call setupRedisForTests() first.');
  }
  return globalRedisHelper;
}
