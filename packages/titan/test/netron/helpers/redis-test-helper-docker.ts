import * as net from 'net';
import { Redis } from 'ioredis';
import { spawn, ChildProcess } from 'child_process';

/**
 * Alternative Redis test helper that uses Docker if redis-server is not available
 */
export class RedisDockerTestHelper {
  private static instances: Map<number, RedisDockerTestHelper> = new Map();
  private dockerProcess: ChildProcess | null = null;
  private redisClient: Redis | null = null;
  private port: number;
  private containerName: string;
  private isStarted: boolean = false;

  private constructor(port?: number) {
    this.port = port || this.findAvailablePort();
    this.containerName = `redis-test-${process.pid}-${this.port}`;
  }

  static getInstance(port?: number): RedisDockerTestHelper {
    const actualPort = port || 0; // 0 means auto-select
    if (!RedisDockerTestHelper.instances.has(actualPort)) {
      RedisDockerTestHelper.instances.set(actualPort, new RedisDockerTestHelper(port));
    }
    return RedisDockerTestHelper.instances.get(actualPort)!;
  }

  static async stopAllInstances(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const instance of RedisDockerTestHelper.instances.values()) {
      promises.push(instance.stop());
    }
    await Promise.all(promises);
    RedisDockerTestHelper.instances.clear();
  }

  private findAvailablePort(): number {
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

  async start(): Promise<Redis> {
    if (this.isStarted && this.redisClient) {
      return this.redisClient;
    }

    // Try to use redis-server first
    const hasRedisServer = await this.checkRedisServer();
    if (hasRedisServer) {
      return this.startRedisServer();
    }

    // Fall back to Docker
    const hasDocker = await this.checkDocker();
    if (hasDocker) {
      return this.startDockerRedis();
    }

    throw new Error('Neither redis-server nor Docker is available. Please install one of them to run tests.');
  }

  private async checkRedisServer(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('which', ['redis-server']);
      check.on('close', (code) => resolve(code === 0));
      check.on('error', () => resolve(false));
    });
  }

  private async checkDocker(): Promise<boolean> {
    return new Promise((resolve) => {
      const check = spawn('docker', ['--version']);
      check.on('close', (code) => resolve(code === 0));
      check.on('error', () => resolve(false));
    });
  }

  private async startRedisServer(): Promise<Redis> {
    // Use the original redis-test-helper logic
    const helper = await import('./redis-test-helper.js');
    const instance = helper.RedisTestHelper.getInstance({ port: this.port });
    const client = await instance.start();
    this.redisClient = client;
    this.isStarted = true;
    return client;
  }

  private async startDockerRedis(): Promise<Redis> {
    // Start Redis in Docker
    console.log(`Starting Redis in Docker on port ${this.port}...`);

    // Remove any existing container with the same name
    await this.runCommand('docker', ['rm', '-f', this.containerName]).catch(() => { });

    // Start Redis container
    this.dockerProcess = spawn('docker', [
      'run',
      '--rm',
      '--name',
      this.containerName,
      '-p',
      `${this.port}:6379`,
      'redis:7-alpine',
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
    ]);

    this.dockerProcess.on('error', (error) => {
      console.error('Failed to start Redis in Docker:', error);
      throw error;
    });

    // Wait for Redis to be ready
    await this.waitForRedis();

    // Create Redis client
    this.redisClient = new Redis({
      port: this.port,
      host: '127.0.0.1',
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    });

    this.isStarted = true;
    return this.redisClient;
  }

  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command failed with code ${code}`));
      });
      proc.on('error', reject);
    });
  }

  private async waitForRedis(timeout: number = 10000): Promise<void> {
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

    if (this.dockerProcess || this.containerName) {
      // Force stop and remove Docker container
      try {
        await this.runCommand('docker', ['stop', this.containerName]);
      } catch {
        // Ignore errors
      }

      try {
        await this.runCommand('docker', ['rm', '-f', this.containerName]);
      } catch {
        // Ignore errors
      }

      this.dockerProcess = null;
    }

    this.isStarted = false;
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
