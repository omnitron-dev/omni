/**
 * Generic Docker Test Manager for Titan Framework
 *
 * Provides a unified interface for managing Docker containers in tests
 */

import { execSync, execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as net from 'net';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  port?: number;
  host: string;
  ports: Map<number, number>; // container port -> host port
  environment: Record<string, string>;
  labels: Record<string, string>;
  networks: string[];
  cleanup: () => Promise<void>;
}

export interface DockerTestManagerOptions {
  dockerPath?: string;
  basePort?: number;
  maxRetries?: number;
  startupTimeout?: number;
  cleanup?: boolean;
  verbose?: boolean;
  network?: string;
}

export interface ContainerOptions {
  name?: string;
  image: string;
  command?: string;
  ports?: Record<number, number | 'auto'>; // container port -> host port or 'auto'
  environment?: Record<string, string>;
  labels?: Record<string, string>;
  volumes?: string[];
  networks?: string[];
  healthcheck?: {
    test: string[];
    interval?: string;
    timeout?: string;
    retries?: number;
    startPeriod?: string;
  };
  waitFor?: {
    port?: number;
    timeout?: number;
    healthcheck?: boolean;
  };
}

export class DockerTestManager {
  private static instance: DockerTestManager;
  private containers: Map<string, DockerContainer> = new Map();
  private usedPorts: Set<number> = new Set();
  private networks: Set<string> = new Set();

  private dockerPath: string;
  private basePort: number;
  private maxRetries: number;
  private startupTimeout: number;
  private cleanup: boolean;
  private verbose: boolean;
  private defaultNetwork?: string;

  private constructor(options: DockerTestManagerOptions = {}) {
    this.dockerPath = options.dockerPath || '/usr/local/bin/docker';
    this.basePort = options.basePort || 10000;
    this.maxRetries = options.maxRetries || 20;
    this.startupTimeout = options.startupTimeout || 30000;
    this.cleanup = options.cleanup !== false;
    this.verbose = options.verbose || false;
    this.defaultNetwork = options.network;

    // Verify Docker is available
    this.verifyDocker();

    // Register cleanup handlers
    if (this.cleanup) {
      process.on('exit', () => this.cleanupSync());
      process.on('SIGINT', () => this.cleanupAllAsync().then(() => process.exit(0)));
      process.on('SIGTERM', () => this.cleanupAllAsync().then(() => process.exit(0)));
    }
  }

  static getInstance(options?: DockerTestManagerOptions): DockerTestManager {
    if (!DockerTestManager.instance) {
      DockerTestManager.instance = new DockerTestManager(options);
    }
    return DockerTestManager.instance;
  }

  private verifyDocker(): void {
    try {
      execSync(`${this.dockerPath} version`, { stdio: 'ignore' });
    } catch (error) {
      throw new Error('Docker is not available. Please install Docker to run tests.');
    }
  }

  private async findAvailablePort(): Promise<number> {
    for (let i = 0; i < this.maxRetries; i++) {
      const port = this.basePort + Math.floor(Math.random() * 10000);
      if (!this.usedPorts.has(port) && await this.isPortAvailable(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('Could not find available port for container');
  }

  private async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });
  }

  async createContainer(options: ContainerOptions): Promise<DockerContainer> {
    const id = `test-${randomBytes(4).toString('hex')}`;
    const name = options.name || `container-${id}`;
    const host = '127.0.0.1';

    // Process port mappings
    const portMappings = new Map<number, number>();
    if (options.ports) {
      for (const [containerPort, hostPort] of Object.entries(options.ports)) {
        const cPort = parseInt(containerPort);
        const hPort = hostPort === 'auto' ? await this.findAvailablePort() : hostPort;
        portMappings.set(cPort, hPort);
      }
    }

    // Build docker run command
    const dockerArgs: string[] = ['run', '-d', '--name', name];

    // Add ports
    for (const [containerPort, hostPort] of portMappings) {
      dockerArgs.push('-p', `${hostPort}:${containerPort}`);
    }

    // Add environment variables
    const environment = options.environment || {};
    for (const [key, value] of Object.entries(environment)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }

    // Add labels
    const labels = {
      'test.id': id,
      'test.cleanup': 'true',
      ...options.labels
    };
    for (const [key, value] of Object.entries(labels)) {
      dockerArgs.push('--label', `${key}=${value}`);
    }

    // Add volumes
    if (options.volumes) {
      for (const volume of options.volumes) {
        dockerArgs.push('-v', volume);
      }
    }

    // Add networks
    const networks = options.networks || (this.defaultNetwork ? [this.defaultNetwork] : []);
    for (const network of networks) {
      // Create network if it doesn't exist
      await this.ensureNetwork(network);
      dockerArgs.push('--network', network);
    }

    // Add healthcheck if provided
    if (options.healthcheck) {
      // Docker CLI --health-cmd expects a string, not a JSON array
      // If the test is an array like ['CMD-SHELL', 'command'], extract just the command
      let healthCmd: string;
      if (Array.isArray(options.healthcheck.test)) {
        // If it starts with 'CMD-SHELL' or 'CMD', take the rest as the command
        if (options.healthcheck.test[0] === 'CMD-SHELL' || options.healthcheck.test[0] === 'CMD') {
          healthCmd = options.healthcheck.test.slice(1).join(' ');
        } else {
          // Otherwise join all parts
          healthCmd = options.healthcheck.test.join(' ');
        }
      } else {
        healthCmd = options.healthcheck.test;
      }
      dockerArgs.push('--health-cmd', healthCmd);
      if (options.healthcheck.interval) {
        dockerArgs.push('--health-interval', options.healthcheck.interval);
      }
      if (options.healthcheck.timeout) {
        dockerArgs.push('--health-timeout', options.healthcheck.timeout);
      }
      if (options.healthcheck.retries) {
        dockerArgs.push('--health-retries', options.healthcheck.retries.toString());
      }
      if (options.healthcheck.startPeriod) {
        dockerArgs.push('--health-start-period', options.healthcheck.startPeriod);
      }
    }

    // Add image and command
    dockerArgs.push(options.image);
    if (options.command) {
      dockerArgs.push('sh', '-c', options.command);
    }

    if (this.verbose) {
      console.log(`Starting container ${name}: docker ${dockerArgs.join(' ')}`);
    }

    // Start container using execFileSync to properly handle arguments with spaces
    try {
      execFileSync(this.dockerPath, dockerArgs, {
        stdio: this.verbose ? 'inherit' : 'ignore'
      });
    } catch (error) {
      throw new Error(`Failed to start container ${name}: ${error}`);
    }

    // Wait for container to be ready
    if (options.waitFor) {
      await this.waitForContainer(name, options.waitFor);
    }

    const container: DockerContainer = {
      id,
      name,
      image: options.image,
      host,
      port: portMappings.values().next().value, // First port for convenience
      ports: portMappings,
      environment,
      labels,
      networks,
      cleanup: async () => {
        if (this.verbose) {
          console.log(`Cleaning up container: ${name}`);
        }

        // Stop and remove container
        try {
          execSync(`${this.dockerPath} stop ${name}`, { stdio: 'ignore' });
          execSync(`${this.dockerPath} rm ${name}`, { stdio: 'ignore' });
        } catch (error) {
          console.warn(`Failed to cleanup container ${name}: ${error}`);
        }

        // Release ports
        for (const port of portMappings.values()) {
          this.usedPorts.delete(port);
        }

        // Remove from tracking
        this.containers.delete(id);
      }
    };

    this.containers.set(id, container);
    return container;
  }

  private async ensureNetwork(network: string): Promise<void> {
    if (!this.networks.has(network)) {
      try {
        execSync(
          `${this.dockerPath} network create ${network} --label test.cleanup=true`,
          { stdio: 'ignore' }
        );
        this.networks.add(network);
      } catch {
        // Network might already exist
        this.networks.add(network);
      }
    }
  }

  private async waitForContainer(name: string, options: ContainerOptions['waitFor']): Promise<void> {
    const startTime = Date.now();
    const timeout = options?.timeout || this.startupTimeout;

    while (Date.now() - startTime < timeout) {
      // Check if container is healthy
      if (options?.healthcheck) {
        try {
          const healthStatus = execSync(
            `${this.dockerPath} inspect --format='{{.State.Health.Status}}' ${name}`,
            { encoding: 'utf8' }
          ).trim();

          if (healthStatus === 'healthy') {
            return;
          }
        } catch {
          // Container might not have health check
        }
      }

      // Check if port is accessible
      if (options?.port) {
        const containerInfo = this.containers.get(name);
        if (containerInfo) {
          const hostPort = containerInfo.ports.get(options.port);
          if (hostPort && await this.isPortListening('127.0.0.1', hostPort)) {
            return;
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Container ${name} failed to start within ${timeout}ms`);
  }

  private async isPortListening(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();

      socket.setTimeout(100);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  async getContainer(id: string): Promise<DockerContainer | undefined> {
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

    // Cleanup networks
    for (const network of this.networks) {
      try {
        execSync(`${this.dockerPath} network rm ${network}`, { stdio: 'ignore' });
      } catch {
        // Ignore errors
      }
    }

    this.containers.clear();
    this.usedPorts.clear();
    this.networks.clear();
  }

  private async cleanupAllAsync(): Promise<void> {
    if (this.verbose) {
      console.log('Cleaning up all test containers...');
    }
    await this.cleanupAll();
  }

  private cleanupSync(): void {
    try {
      // Force remove all test containers
      execSync(
        `${this.dockerPath} ps -a --filter "label=test.cleanup=true" -q | xargs -r ${this.dockerPath} rm -f`,
        { stdio: 'ignore' }
      );

      // Remove test networks
      execSync(
        `${this.dockerPath} network ls --filter "label=test.cleanup=true" -q | xargs -r ${this.dockerPath} network rm`,
        { stdio: 'ignore' }
      );

      // Remove test volumes
      execSync(
        `${this.dockerPath} volume ls --filter "label=test.cleanup=true" -q | xargs -r ${this.dockerPath} volume rm`,
        { stdio: 'ignore' }
      );
    } catch {
      // Ignore errors during cleanup
    }
  }

  // Helper to run tests with a container
  static async withContainer<T>(
    options: ContainerOptions,
    testFn: (container: DockerContainer) => Promise<T>
  ): Promise<T> {
    const manager = DockerTestManager.getInstance();
    const container = await manager.createContainer(options);

    try {
      return await testFn(container);
    } finally {
      await container.cleanup();
    }
  }
}

// Database-specific helpers
export class DatabaseTestManager {
  private static dockerManager = DockerTestManager.getInstance();

  static async createPostgresContainer(options?: {
    name?: string;
    port?: number | 'auto';
    database?: string;
    user?: string;
    password?: string;
  }): Promise<DockerContainer> {
    const port = options?.port || 'auto';
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';

    return DatabaseTestManager.dockerManager.createContainer({
      name: options?.name,
      image: 'postgres:16-alpine',
      ports: { 5432: port },
      environment: {
        POSTGRES_DB: database,
        POSTGRES_USER: user,
        POSTGRES_PASSWORD: password,
        POSTGRES_HOST_AUTH_METHOD: 'trust'
      },
      healthcheck: {
        test: ['CMD-SHELL', `pg_isready -U ${user}`],
        interval: '1s',
        timeout: '3s',
        retries: 5,
        startPeriod: '2s'
      },
      waitFor: {
        healthcheck: true,
        timeout: 30000
      }
    });
  }

  static async createMySQLContainer(options?: {
    name?: string;
    port?: number | 'auto';
    database?: string;
    user?: string;
    password?: string;
    rootPassword?: string;
  }): Promise<DockerContainer> {
    const port = options?.port || 'auto';
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';
    const rootPassword = options?.rootPassword || 'rootpass';

    return DatabaseTestManager.dockerManager.createContainer({
      name: options?.name,
      image: 'mysql:8.0',
      ports: { 3306: port },
      environment: {
        MYSQL_DATABASE: database,
        MYSQL_USER: user,
        MYSQL_PASSWORD: password,
        MYSQL_ROOT_PASSWORD: rootPassword,
        MYSQL_ALLOW_EMPTY_PASSWORD: 'yes'
      },
      healthcheck: {
        test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
        interval: '1s',
        timeout: '3s',
        retries: 10,
        startPeriod: '5s'
      },
      waitFor: {
        healthcheck: true,
        timeout: 30000
      }
    });
  }

  static async withPostgres<T>(
    testFn: (container: DockerContainer, connectionString: string) => Promise<T>,
    options?: Parameters<typeof DatabaseTestManager.createPostgresContainer>[0]
  ): Promise<T> {
    const container = await DatabaseTestManager.createPostgresContainer(options);

    const port = container.ports.get(5432)!;
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';
    const connectionString = `postgresql://${user}:${password}@localhost:${port}/${database}`;

    try {
      return await testFn(container, connectionString);
    } finally {
      await container.cleanup();
    }
  }

  static async withMySQL<T>(
    testFn: (container: DockerContainer, connectionString: string) => Promise<T>,
    options?: Parameters<typeof DatabaseTestManager.createMySQLContainer>[0]
  ): Promise<T> {
    const container = await DatabaseTestManager.createMySQLContainer(options);

    const port = container.ports.get(3306)!;
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';
    const connectionString = `mysql://${user}:${password}@localhost:${port}/${database}`;

    try {
      return await testFn(container, connectionString);
    } finally {
      await container.cleanup();
    }
  }
}