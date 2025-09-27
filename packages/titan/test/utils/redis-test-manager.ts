import { execSync, spawn, ChildProcess } from 'child_process';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface RedisTestContainer {
  id: string;
  port: number;
  host: string;
  url: string;
  client?: Redis;
  process?: ChildProcess;
  cleanup: () => Promise<void>;
}

export interface RedisTestManagerOptions {
  basePort?: number;
  maxRetries?: number;
  startupTimeout?: number;
  cleanup?: boolean;
  verbose?: boolean;
}

export class RedisTestManager {
  private static instance: RedisTestManager;
  private containers: Map<string, RedisTestContainer> = new Map();
  private usedPorts: Set<number> = new Set();
  private basePort: number;
  private maxRetries: number;
  private startupTimeout: number;
  private cleanup: boolean;
  private verbose: boolean;
  private dockerComposeFile: string;
  private dockerPath: string = '/usr/local/bin/docker';

  private constructor(options: RedisTestManagerOptions = {}) {
    this.basePort = options.basePort || 16379; // Start from port 16379 for tests
    this.maxRetries = options.maxRetries || 10;
    this.startupTimeout = options.startupTimeout || 30000;
    this.cleanup = options.cleanup !== false;
    this.verbose = options.verbose || false;
    this.dockerComposeFile = path.join(__dirname, '../docker/docker-compose.test.yml');

    // Register cleanup on process exit
    if (this.cleanup) {
      process.on('exit', () => this.cleanupSync());
      process.on('SIGINT', () => this.cleanupAllAsync().then(() => process.exit(0)));
      process.on('SIGTERM', () => this.cleanupAllAsync().then(() => process.exit(0)));
    }
  }

  static getInstance(options?: RedisTestManagerOptions): RedisTestManager {
    if (!RedisTestManager.instance) {
      RedisTestManager.instance = new RedisTestManager(options);
    }
    return RedisTestManager.instance;
  }

  private async findAvailablePort(): Promise<number> {
    for (let i = 0; i < this.maxRetries; i++) {
      const port = this.basePort + Math.floor(Math.random() * 1000);
      if (!this.usedPorts.has(port) && await this.isPortAvailable(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('Could not find available port for Redis container');
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    try {
      const net = await import('net');
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port, '127.0.0.1');
      });
    } catch {
      return false;
    }
  }

  async createContainer(name?: string): Promise<RedisTestContainer> {
    const id = name || `redis-test-${randomBytes(4).toString('hex')}`;
    const port = await this.findAvailablePort();
    const host = '127.0.0.1';

    if (this.verbose) {
      console.log(`Creating Redis container: ${id} on port ${port}`);
    }

    // Create container using Docker
    try {
      // Check if Docker is available
      execSync(`${this.dockerPath} version`, { stdio: 'ignore' });
    } catch (error) {
      throw new Error('Docker is not available. Please install Docker to run Redis tests.');
    }

    const env = {
      ...process.env,
      TEST_SUITE_ID: id,
      REDIS_PORT: port.toString(),
    };

    // Start Redis container using docker-compose (v2 syntax)
    const startCmd = `${this.dockerPath} compose -f ${this.dockerComposeFile} up -d redis-test`;

    try {
      execSync(startCmd, {
        env,
        stdio: this.verbose ? 'inherit' : 'ignore'
      });
    } catch (error) {
      throw new Error(`Failed to start Redis container: ${error}`);
    }

    // Wait for Redis to be ready
    const url = `redis://${host}:${port}`;
    const client = await this.waitForRedis(url);

    const container: RedisTestContainer = {
      id,
      port,
      host,
      url,
      client,
      cleanup: async () => {
        if (this.verbose) {
          console.log(`Cleaning up Redis container: ${id}`);
        }

        // Disconnect client
        if (client && client.status === 'ready') {
          await client.quit();
        }

        // Stop and remove container
        const stopCmd = `${this.dockerPath} compose -f ${this.dockerComposeFile} down -v`;
        try {
          execSync(stopCmd, {
            env,
            stdio: this.verbose ? 'inherit' : 'ignore'
          });
        } catch (error) {
          console.warn(`Failed to stop container ${id}: ${error}`);
        }

        // Remove from tracking
        this.containers.delete(id);
        this.usedPorts.delete(port);
      }
    };

    this.containers.set(id, container);
    return container;
  }

  async createCluster(name?: string, nodes: number = 3): Promise<RedisTestContainer[]> {
    const clusterId = name || `redis-cluster-${randomBytes(4).toString('hex')}`;
    const containers: RedisTestContainer[] = [];

    // Create cluster nodes
    for (let i = 0; i < nodes; i++) {
      const nodePort = await this.findAvailablePort();
      const nodeId = `${clusterId}-node${i + 1}`;

      const env = {
        ...process.env,
        TEST_SUITE_ID: clusterId,
        [`REDIS_CLUSTER_PORT_${i + 1}`]: nodePort.toString(),
      };

      // Start cluster node
      const startCmd = `${this.dockerPath} compose -f ${this.dockerComposeFile} up -d redis-cluster-node${i + 1}`;

      try {
        execSync(startCmd, {
          env,
          stdio: this.verbose ? 'inherit' : 'ignore'
        });
      } catch (error) {
        // Cleanup already started nodes on failure
        for (const container of containers) {
          await container.cleanup();
        }
        throw new Error(`Failed to start Redis cluster node ${i + 1}: ${error}`);
      }

      const url = `redis://127.0.0.1:${nodePort}`;
      const client = await this.waitForRedis(url);

      const container: RedisTestContainer = {
        id: nodeId,
        port: nodePort,
        host: '127.0.0.1',
        url,
        client,
        cleanup: async () => {
          if (client && client.status === 'ready') {
            await client.quit();
          }
          const stopCmd = `${this.dockerPath} compose -f ${this.dockerComposeFile} down -v`;
          try {
            execSync(stopCmd, { env, stdio: 'ignore' });
          } catch (error) {
            console.warn(`Failed to stop cluster node ${nodeId}: ${error}`);
          }
          this.usedPorts.delete(nodePort);
        }
      };

      containers.push(container);
      this.containers.set(nodeId, container);
    }

    // Initialize cluster if needed
    if (nodes >= 3) {
      await this.initializeCluster(containers);
    }

    return containers;
  }

  private async initializeCluster(containers: RedisTestContainer[]): Promise<void> {
    // Create cluster using redis-cli
    const clusterNodes = containers.map(c => `${c.host}:${c.port}`).join(' ');
    const firstContainer = containers[0];

    try {
      const createClusterCmd = `${this.dockerPath} exec redis-test-${firstContainer.id} redis-cli --cluster create ${clusterNodes} --cluster-replicas 0 --cluster-yes`;
      execSync(createClusterCmd, {
        stdio: this.verbose ? 'inherit' : 'ignore',
        timeout: 10000
      });
    } catch (error) {
      if (this.verbose) {
        console.warn('Cluster initialization failed, but nodes are running:', error);
      }
    }
  }

  private async waitForRedis(url: string): Promise<Redis> {
    const startTime = Date.now();

    while (Date.now() - startTime < this.startupTimeout) {
      try {
        const client = new Redis(url, {
          retryStrategy: () => null, // Don't retry during initial connection
          lazyConnect: false
        });
        await client.ping();
        return client;
      } catch (error) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    throw new Error(`Redis container failed to start within ${this.startupTimeout}ms`);
  }

  async getContainer(id: string): Promise<RedisTestContainer | undefined> {
    return this.containers.get(id);
  }

  async cleanupContainer(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (container) {
      await container.cleanup();
    }
  }

  async cleanupAll(): Promise<void> {
    const cleanupPromises = Array.from(this.containers.values()).map(
      container => container.cleanup()
    );
    await Promise.all(cleanupPromises);
    this.containers.clear();
    this.usedPorts.clear();
  }

  private async cleanupAllAsync(): Promise<void> {
    if (this.verbose) {
      console.log('Cleaning up all Redis test containers...');
    }
    await this.cleanupAll();
  }

  private cleanupSync(): void {
    // Synchronous cleanup for process exit
    try {
      // Force remove all test containers
      const cleanupCmd = `${this.dockerPath} ps -a --filter "label=test.cleanup=true" -q | xargs -r ${this.dockerPath} rm -f`;
      execSync(cleanupCmd, { stdio: 'ignore' });

      // Remove test networks
      const networkCleanupCmd = `${this.dockerPath} network ls --filter "label=test.cleanup=true" -q | xargs -r ${this.dockerPath} network rm`;
      execSync(networkCleanupCmd, { stdio: 'ignore' });

      // Remove test volumes
      const volumeCleanupCmd = `${this.dockerPath} volume ls --filter "label=test.cleanup=true" -q | xargs -r ${this.dockerPath} volume rm`;
      execSync(volumeCleanupCmd, { stdio: 'ignore' });
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  // Utility method to create a Redis client with test configuration
  static async createTestClient(url?: string): Promise<Redis> {
    const client = new Redis(url || 'redis://localhost:6379', {
      connectTimeout: 5000,
      retryStrategy: () => null,
      lazyConnect: false
    });

    await client.ping(); // Verify connection
    return client;
  }

  // Helper to run tests with isolated Redis instance
  static async withRedis<T>(
    testFn: (container: RedisTestContainer) => Promise<T>,
    options?: { name?: string; cleanup?: boolean }
  ): Promise<T> {
    const manager = RedisTestManager.getInstance();
    const container = await manager.createContainer(options?.name);

    try {
      return await testFn(container);
    } finally {
      if (options?.cleanup !== false) {
        await container.cleanup();
      }
    }
  }

  // Helper for running tests with Redis cluster
  static async withCluster<T>(
    testFn: (containers: RedisTestContainer[]) => Promise<T>,
    options?: { name?: string; nodes?: number; cleanup?: boolean }
  ): Promise<T> {
    const manager = RedisTestManager.getInstance();
    const containers = await manager.createCluster(options?.name, options?.nodes);

    try {
      return await testFn(containers);
    } finally {
      if (options?.cleanup !== false) {
        for (const container of containers) {
          await container.cleanup();
        }
      }
    }
  }
}