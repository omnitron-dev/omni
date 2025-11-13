import { execSync, execFileSync, ChildProcess } from 'child_process';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Conditional declarations to avoid conflicts with Jest transform
const __filename = typeof globalThis.__filename !== 'undefined' ? globalThis.__filename : fileURLToPath(import.meta.url);
const __dirname = typeof globalThis.__dirname !== 'undefined' ? globalThis.__dirname : dirname(__filename);

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
  private dockerPath: string;

  private constructor(options: RedisTestManagerOptions = {}) {
    // Worker-aware port allocation to prevent conflicts in parallel test execution
    // Each jest worker gets its own 1000 port range
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    const basePortOffset = (workerId - 1) * 1000;
    this.basePort = options.basePort || (20000 + basePortOffset); // Start at 20000 to avoid overlap with DockerTestManager

    this.maxRetries = options.maxRetries || 10;
    this.startupTimeout = options.startupTimeout || 30000;
    this.cleanup = options.cleanup !== false;
    this.verbose = options.verbose || false;
    this.dockerComposeFile = path.join(__dirname, '../docker/docker-compose.test.yml');
    this.dockerPath = this.findDockerPath();

    if (this.verbose) {
      console.log(`[RedisTestManager] Initialized for Jest worker ${workerId} with port range ${this.basePort}-${this.basePort + 1000}`);
    }

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

  /**
   * Find Docker executable path across different platforms
   * Uses the same strategy as docker-test-manager.ts for consistency
   */
  private findDockerPath(): string {
    const isWindows = process.platform === 'win32';
    const whichCommand = isWindows ? 'where' : 'which';
    const dockerBinary = isWindows ? 'docker.exe' : 'docker';

    // Strategy 1: Try to find Docker in PATH using which/where
    try {
      const result = execSync(`${whichCommand} ${dockerBinary}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      // On Windows, 'where' can return multiple paths (one per line)
      const dockerPath = result.split('\n')[0].trim();

      if (dockerPath && this.testDockerPath(dockerPath)) {
        if (this.verbose) {
          console.log(`Found Docker in PATH: ${dockerPath}`);
        }
        return dockerPath;
      }
    } catch {
      // Command failed, continue to fallback paths
    }

    // Strategy 2: Check platform-specific common locations
    const fallbackPaths = this.getDockerFallbackPaths();

    for (const dockerPath of fallbackPaths) {
      if (this.testDockerPath(dockerPath)) {
        if (this.verbose) {
          console.log(`Found Docker at fallback path: ${dockerPath}`);
        }
        return dockerPath;
      }
    }

    // Strategy 3: If all else fails, try just 'docker' or 'docker.exe' and hope it's in PATH
    if (this.testDockerPath(dockerBinary)) {
      if (this.verbose) {
        console.log(`Using Docker from PATH: ${dockerBinary}`);
      }
      return dockerBinary;
    }

    // No Docker found
    throw new Error(
      `Docker executable not found. Please install Docker and ensure it's in your PATH.\n` +
        `Searched paths:\n` +
        `  - PATH using '${whichCommand} ${dockerBinary}'\n` +
        `  - ${fallbackPaths.join('\n  - ')}\n` +
        `\nPlatform: ${process.platform}\n` +
        `For more information, visit: https://docs.docker.com/get-docker/`
    );
  }

  /**
   * Get platform-specific fallback paths for Docker
   */
  private getDockerFallbackPaths(): string[] {
    switch (process.platform) {
      case 'darwin': // macOS
        return [
          '/usr/local/bin/docker', // Intel Mac / Docker Desktop
          '/opt/homebrew/bin/docker', // Apple Silicon Mac / Homebrew
          '/Applications/Docker.app/Contents/Resources/bin/docker', // Docker Desktop
        ];

      case 'linux':
        return [
          '/usr/bin/docker', // Most common Linux location
          '/usr/local/bin/docker', // Alternative Linux location
          '/snap/bin/docker', // Snap package
          '/var/lib/snapd/snap/bin/docker', // Snap on some distros
          '/opt/docker/bin/docker', // Custom installations
        ];

      case 'win32': // Windows
        return [
          'docker.exe', // Should be in PATH
          'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe',
          'C:\\ProgramData\\DockerDesktop\\version-bin\\docker.exe',
        ];

      default:
        return ['/usr/local/bin/docker', '/usr/bin/docker', 'docker'];
    }
  }

  /**
   * Test if a Docker path is valid by running 'docker version'
   */
  private testDockerPath(dockerPath: string): boolean {
    try {
      execSync(`"${dockerPath}" version`, {
        stdio: 'ignore',
        timeout: 5000, // 5 second timeout
      });
      return true;
    } catch {
      return false;
    }
  }

  private async findAvailablePort(): Promise<number> {
    for (let i = 0; i < this.maxRetries; i++) {
      const port = this.basePort + Math.floor(Math.random() * 1000);
      if (!this.usedPorts.has(port) && (await this.isPortAvailable(port))) {
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
    // Docker availability is already verified in constructor via findDockerPath()

    const env = {
      ...process.env,
      TEST_SUITE_ID: id,
      REDIS_PORT: port.toString(),
    };

    // Start Redis container using docker-compose (v2 syntax)
    // Using execFileSync for security (prevents shell injection)
    try {
      execFileSync(this.dockerPath, ['compose', '-f', this.dockerComposeFile, 'up', '-d', 'redis-test'], {
        env,
        stdio: this.verbose ? 'inherit' : 'ignore',
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
        // Using execFileSync for security (prevents shell injection)
        try {
          execFileSync(this.dockerPath, ['compose', '-f', this.dockerComposeFile, 'down', '-v'], {
            env,
            stdio: this.verbose ? 'inherit' : 'ignore',
          });
        } catch (error) {
          console.warn(`Failed to stop container ${id}: ${error}`);
        }

        // Remove from tracking
        this.containers.delete(id);
        this.usedPorts.delete(port);
      },
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
      const startCmd = `"${this.dockerPath}" compose -f "${this.dockerComposeFile}" up -d redis-cluster-node${i + 1}`;

      try {
        execSync(startCmd, {
          env,
          stdio: this.verbose ? 'inherit' : 'ignore',
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
          const stopCmd = `"${this.dockerPath}" compose -f "${this.dockerComposeFile}" down -v`;
          try {
            execSync(stopCmd, { env, stdio: 'ignore' });
          } catch (error) {
            console.warn(`Failed to stop cluster node ${nodeId}: ${error}`);
          }
          this.usedPorts.delete(nodePort);
        },
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
    const clusterNodes = containers.map((c) => `${c.host}:${c.port}`).join(' ');
    const firstContainer = containers[0];

    try {
      const createClusterCmd = `"${this.dockerPath}" exec redis-test-${firstContainer.id} redis-cli --cluster create ${clusterNodes} --cluster-replicas 0 --cluster-yes`;
      execSync(createClusterCmd, {
        stdio: this.verbose ? 'inherit' : 'ignore',
        timeout: 10000,
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
          lazyConnect: false,
        });
        await client.ping();
        return client;
      } catch (error) {
        await new Promise((resolve) => setTimeout(resolve, 100));
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
    const cleanupPromises = Array.from(this.containers.values()).map((container) => container.cleanup());
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
      const isWindows = process.platform === 'win32';

      if (isWindows) {
        // Windows doesn't have xargs, so we get IDs and remove one by one
        try {
          const containerIds = execSync(`"${this.dockerPath}" ps -a --filter "label=test.cleanup=true" -q`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }).trim();
          if (containerIds) {
            containerIds.split('\n').forEach((id) => {
              try {
                execSync(`"${this.dockerPath}" rm -f ${id.trim()}`, { stdio: 'ignore' });
              } catch {
                // Ignore individual failures
              }
            });
          }
        } catch {
          // Ignore errors
        }
      } else {
        // Unix-like systems with xargs
        // Force remove all test containers
        const cleanupCmd = `"${this.dockerPath}" ps -a --filter "label=test.cleanup=true" -q | xargs -r "${this.dockerPath}" rm -f`;
        execSync(cleanupCmd, { stdio: 'ignore' });

        // Remove test networks
        const networkCleanupCmd = `"${this.dockerPath}" network ls --filter "label=test.cleanup=true" -q | xargs -r "${this.dockerPath}" network rm`;
        execSync(networkCleanupCmd, { stdio: 'ignore' });

        // Remove test volumes
        const volumeCleanupCmd = `"${this.dockerPath}" volume ls --filter "label=test.cleanup=true" -q | xargs -r "${this.dockerPath}" volume rm`;
        execSync(volumeCleanupCmd, { stdio: 'ignore' });
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  // Utility method to create a Redis client with test configuration
  static async createTestClient(url?: string): Promise<Redis> {
    const client = new Redis(url || 'redis://localhost:6379', {
      connectTimeout: 5000,
      retryStrategy: () => null,
      lazyConnect: false,
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
