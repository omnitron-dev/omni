/**
 * Generic Docker Test Manager for Titan Framework
 *
 * Provides a unified interface for managing Docker containers in tests
 * with robust lifecycle management, graceful shutdown, and reliable cleanup
 */

import { execSync, execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as net from 'net';
import { EventEmitter } from 'events';

export interface DockerContainerStatus {
  isRunning: boolean;
  state?: string;
  health?: string;
  exitCode?: number;
}

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
  createdAt: Date;
  cleanup: () => Promise<void>;
  getStatus: () => Promise<DockerContainerStatus>;
  isHealthy: () => Promise<boolean>;
}

export interface DockerTestManagerOptions {
  dockerPath?: string;
  basePort?: number;
  maxRetries?: number;
  startupTimeout?: number;
  cleanup?: boolean;
  verbose?: boolean;
  network?: string;
  gracefulShutdownTimeout?: number;
  maxCleanupRetries?: number;
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

export class DockerTestManager extends EventEmitter {
  private static instance: DockerTestManager;
  private containers: Map<string, DockerContainer> = new Map();
  private usedPorts: Set<number> = new Set();
  private networks: Set<string> = new Set();
  private cleanupInProgress = false;

  private dockerPath: string;
  private basePort: number;
  private maxRetries: number;
  private startupTimeout: number;
  private gracefulShutdownTimeout: number;
  private maxCleanupRetries: number;
  private cleanup: boolean;
  private verbose: boolean;
  private defaultNetwork?: string;

  private constructor(options: DockerTestManagerOptions = {}) {
    super();
    this.dockerPath = options.dockerPath || this.findDockerPath();
    this.basePort = options.basePort || 10000;
    this.maxRetries = options.maxRetries || 20;
    this.startupTimeout = options.startupTimeout || 30000;
    this.gracefulShutdownTimeout = options.gracefulShutdownTimeout || 10000;
    this.maxCleanupRetries = options.maxCleanupRetries || 3;
    this.cleanup = options.cleanup !== false;
    this.verbose = options.verbose || false;
    this.defaultNetwork = options.network;

    // Verify Docker is available
    this.verifyDocker();

    // Register cleanup handlers with graceful shutdown
    if (this.cleanup) {
      // Increase max listeners to avoid warnings when multiple test managers are instantiated
      // This is safe because signal handlers should be idempotent and cleanup is managed by the singleton pattern
      process.setMaxListeners(Math.max(20, process.getMaxListeners()));

      process.on('exit', () => this.cleanupSync());
      process.on('SIGINT', () => {
        this.log('SIGINT received - initiating graceful shutdown');
        this.cleanupAllAsync()
          .then(() => {
            this.log('Cleanup completed, exiting');
            process.exit(0);
          })
          .catch((error) => {
            this.logError('Cleanup failed during SIGINT', error);
            process.exit(1);
          });
      });
      process.on('SIGTERM', () => {
        this.log('SIGTERM received - initiating graceful shutdown');
        this.cleanupAllAsync()
          .then(() => {
            this.log('Cleanup completed, exiting');
            process.exit(0);
          })
          .catch((error) => {
            this.logError('Cleanup failed during SIGTERM', error);
            process.exit(1);
          });
      });
    }
  }

  static getInstance(options?: DockerTestManagerOptions): DockerTestManager {
    if (!DockerTestManager.instance) {
      DockerTestManager.instance = new DockerTestManager(options);
    }
    return DockerTestManager.instance;
  }

  /**
   * Find Docker executable path across different platforms
   *
   * Detection strategy:
   * 1. Try 'which docker' (Unix) or 'where docker' (Windows) to find in PATH
   * 2. Check platform-specific common locations
   * 3. Validate the found path works with 'docker version'
   *
   * Supported platforms:
   * - macOS: /usr/local/bin/docker, /opt/homebrew/bin/docker, docker in PATH
   * - Linux: /usr/bin/docker, /usr/local/bin/docker, /snap/bin/docker, docker in PATH
   * - Windows: docker.exe in PATH, C:\Program Files\Docker\Docker\resources\bin\docker.exe
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
      // Take the first one
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

    for (const path of fallbackPaths) {
      if (this.testDockerPath(path)) {
        if (this.verbose) {
          console.log(`Found Docker at fallback path: ${path}`);
        }
        return path;
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
        `\n` +
        `Platform: ${process.platform}\n` +
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
        // Unknown platform, try generic paths
        return ['/usr/local/bin/docker', '/usr/bin/docker', 'docker'];
    }
  }

  /**
   * Test if a Docker path is valid by running 'docker version'
   */
  private testDockerPath(dockerPath: string): boolean {
    try {
      // Use execFileSync to avoid shell quoting issues
      execFileSync(dockerPath, ['version'], {
        stdio: 'ignore',
        timeout: 5000, // 5 second timeout
      });
      return true;
    } catch {
      return false;
    }
  }

  private verifyDocker(): void {
    try {
      // Use execFileSync to avoid shell quoting issues
      execFileSync(this.dockerPath, ['version'], { stdio: 'ignore' });
    } catch {
      throw new Error(
        `Docker is not available at path: ${this.dockerPath}\n` +
          `Please install Docker or verify it's properly configured.\n` +
          `Visit: https://docs.docker.com/get-docker/`
      );
    }
  }

  private async findAvailablePort(): Promise<number> {
    for (let i = 0; i < this.maxRetries; i++) {
      const port = this.basePort + Math.floor(Math.random() * 10000);
      if (!this.usedPorts.has(port) && (await this.isPortAvailable(port))) {
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

  private log(message: string, data?: any): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const msg = data ? `[${timestamp}] ${message}: ${JSON.stringify(data)}` : `[${timestamp}] ${message}`;
      console.log(msg);
    }
  }

  private logError(message: string, error: any): void {
    const timestamp = new Date().toISOString();
    const err = error instanceof Error ? error.message : String(error);
    const msg = `[${timestamp}] ERROR: ${message}: ${err}`;
    if (this.verbose) {
      console.error(msg);
    }
  }

  private async getContainerStatus(name: string): Promise<DockerContainerStatus> {
    try {
      const inspectOutput = execFileSync(
        this.dockerPath,
        [
          'inspect',
          '--format',
          '{{.State.Running}}\t{{.State.Status}}\t{{.State.Health.Status}}\t{{.State.ExitCode}}',
          name,
        ],
        {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }
      ).trim();

      const [running, state, health, exitCode] = inspectOutput.split('\t');

      return {
        isRunning: running === 'true',
        state: state || undefined,
        health: health && health !== '<no value>' ? health : undefined,
        exitCode: exitCode ? parseInt(exitCode) : undefined,
      };
    } catch (error) {
      this.logError(`Failed to get container status for ${name}`, error);
      return { isRunning: false };
    }
  }

  private async isContainerHealthy(name: string): Promise<boolean> {
    try {
      const status = await this.getContainerStatus(name);
      if (!status.isRunning) {
        return false;
      }
      // If container has health check, wait for healthy state
      if (status.health) {
        return status.health === 'healthy';
      }
      // If no health check defined, just check if running
      return true;
    } catch {
      return false;
    }
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
    portMappings.forEach((hostPort, containerPort) => {
      dockerArgs.push('-p', `${hostPort}:${containerPort}`);
    });

    // Add environment variables
    const environment = options.environment || {};
    for (const [key, value] of Object.entries(environment)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }

    // Add labels
    const labels = {
      'test.id': id,
      'test.cleanup': 'true',
      ...options.labels,
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
      this.log(`Starting container: ${name}`, { image: options.image });
      execFileSync(this.dockerPath, dockerArgs, {
        stdio: this.verbose ? 'inherit' : 'ignore',
      });
    } catch (error) {
      // Clean up allocated ports before throwing
      portMappings.forEach((port) => {
        this.usedPorts.delete(port);
      });
      throw new Error(`Failed to start container ${name}: ${error}`);
    }

    // Wait for container to be ready
    if (options.waitFor) {
      try {
        await this.waitForContainer(name, options.waitFor);
        this.log(`Container ready: ${name}`);
      } catch (error) {
        // Container failed to start, attempt cleanup
        this.logError(`Container ${name} failed to become ready, cleaning up`, error);
        try {
          execFileSync(this.dockerPath, ['stop', '-t', '5', name], { stdio: 'ignore' });
          execFileSync(this.dockerPath, ['rm', '-f', name], { stdio: 'ignore' });
        } catch {
          // Ignore cleanup errors during rollback
        }
        // Clean up allocated ports
        portMappings.forEach((port) => {
          this.usedPorts.delete(port);
        });
        throw error;
      }
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
      createdAt: new Date(),
      getStatus: async () => this.getContainerStatus(name),
      isHealthy: async () => this.isContainerHealthy(name),
      cleanup: async () => {
        await this.cleanupContainerWithRetry(name, id, portMappings);
      },
    };

    this.containers.set(id, container);
    return container;
  }

  private async cleanupContainerWithRetry(
    name: string,
    id: string,
    portMappings: Map<number, number>
  ): Promise<void> {
    this.log(`Starting cleanup for container: ${name}`);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxCleanupRetries; attempt++) {
      try {
        // Check if container exists
        try {
          const status = await this.getContainerStatus(name);
          if (!status.isRunning) {
            this.log(`Container ${name} is not running, force removing`, { attempt });
          }
        } catch {
          // Container doesn't exist, nothing to clean up
          this.log(`Container ${name} doesn't exist, skipping stop`, { attempt });
          break;
        }

        // Gracefully stop the container first
        try {
          const stopTimeoutSecs = Math.ceil(this.gracefulShutdownTimeout / 1000).toString();
          this.log(`Stopping container ${name}`, { attempt, timeout: this.gracefulShutdownTimeout });
          execFileSync(this.dockerPath, ['stop', '-t', stopTimeoutSecs, name], {
            stdio: 'ignore',
            timeout: this.gracefulShutdownTimeout + 5000, // Add buffer to docker timeout
          });
          this.log(`Container stopped: ${name}`, { attempt });
        } catch (error) {
          this.logError(`Failed to gracefully stop container ${name}`, error);
          // Continue to force remove
        }

        // Remove container
        try {
          this.log(`Removing container ${name}`, { attempt });
          execFileSync(this.dockerPath, ['rm', '-f', name], { stdio: 'ignore' });
          this.log(`Container removed: ${name}`, { attempt });
          lastError = null; // Clear error on success
          break;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (attempt === this.maxCleanupRetries) {
            throw lastError;
          }
          // Wait before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === this.maxCleanupRetries) {
          this.logError(`Final cleanup attempt failed for container ${name}`, lastError);
          // Don't throw, continue with port cleanup
        } else {
          this.logError(`Cleanup attempt ${attempt} failed for container ${name}, retrying`, lastError);
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    // Always release ports, even if cleanup failed
    try {
      portMappings.forEach((port) => {
        this.usedPorts.delete(port);
        this.log(`Released port: ${port}`);
      });
    } catch (error) {
      this.logError('Failed to release ports', error);
    }

    // Remove from tracking
    this.containers.delete(id);
    this.log(`Container cleanup completed: ${name}`, { attempts: this.maxCleanupRetries });
  }

  private async ensureNetwork(network: string): Promise<void> {
    if (!this.networks.has(network)) {
      try {
        execFileSync(this.dockerPath, ['network', 'create', network, '--label', 'test.cleanup=true'], { stdio: 'ignore' });
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

    let lastError: Error | undefined;

    while (Date.now() - startTime < timeout) {
      try {
        // First check if container is still running
        const status = await this.getContainerStatus(name);
        if (!status.isRunning) {
          throw new Error(
            `Container exited with status '${status.state}' and exit code ${status.exitCode}. ` +
              `Check container logs with 'docker logs ${name}'`
          );
        }

        // Check if container is healthy (if healthcheck is configured)
        if (options?.healthcheck) {
          if (status.health === 'healthy') {
            this.log(`Container ${name} is healthy`);
            return;
          }

          if (status.health === 'unhealthy') {
            throw new Error(
              `Container ${name} health check failed. ` +
                `Check container logs with 'docker logs ${name}'`
            );
          }

          // Health check is still starting
          if (status.health === 'starting') {
            this.log(`Waiting for health check on ${name}...`, { elapsed: Date.now() - startTime });
          }
        }

        // Check if port is accessible
        if (options?.port) {
          const container = this.containers.get(name);
          if (container) {
            const hostPort = container.ports.get(options.port);
            if (hostPort && (await this.isPortListening('127.0.0.1', hostPort))) {
              this.log(`Port ${hostPort} is listening on ${name}`);
              return;
            }
          }
        }

        // If no specific wait condition, just check container is running
        if (!options?.healthcheck && !options?.port) {
          this.log(`Container ${name} is running`);
          return;
        }

        lastError = undefined;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logError(`Error waiting for container ${name}`, lastError);

        // Check if this is a fatal error
        if (
          lastError.message.includes('exited') ||
          lastError.message.includes('unhealthy') ||
          lastError.message.includes('health check failed')
        ) {
          throw lastError;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const elapsed = Date.now() - startTime;
    const errorMsg = lastError ? `: ${lastError.message}` : '';
    throw new Error(`Container ${name} failed to start within ${timeout}ms (${elapsed}ms elapsed)${errorMsg}`);
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
    if (this.cleanupInProgress) {
      this.log('Cleanup already in progress, skipping');
      return;
    }

    this.cleanupInProgress = true;

    try {
      this.log(`Starting cleanup of ${this.containers.size} containers`);

      // Cleanup containers in parallel with Promise.allSettled to handle failures
      const cleanupPromises = Array.from(this.containers.values()).map((container) =>
        container
          .cleanup()
          .then(() => {
            this.log(`Cleanup succeeded: ${container.name}`);
          })
          .catch((error) => {
            this.logError(`Cleanup failed for ${container.name}`, error);
            // Still continue cleaning up other containers
          })
      );

      const results = await Promise.allSettled(cleanupPromises);

      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) {
        this.log(`Cleanup completed with ${failed} failures`);
      } else {
        this.log('All containers cleaned up successfully');
      }

      // Cleanup networks
      this.log(`Cleaning up ${this.networks.size} networks`);
      const networkArray = Array.from(this.networks);
      for (const network of networkArray) {
        try {
          this.log(`Removing network: ${network}`);
          execFileSync(this.dockerPath, ['network', 'rm', network], { stdio: 'ignore' });
          this.log(`Network removed: ${network}`);
        } catch (error) {
          this.logError(`Failed to remove network ${network}`, error);
          // Continue with other networks
        }
      }

      this.containers.clear();
      this.usedPorts.clear();
      this.networks.clear();

      this.log('Final cleanup completed');
    } finally {
      this.cleanupInProgress = false;
    }
  }

  private async cleanupAllAsync(): Promise<void> {
    this.log('Initiating graceful cleanup of all test containers');
    await this.cleanupAll();
  }

  private cleanupSync(): void {
    try {
      this.log('Performing synchronous cleanup of remaining test containers');

      const isWindows = process.platform === 'win32';

      if (isWindows) {
        // Windows-specific cleanup
        this.cleanupSyncWindows();
      } else {
        // Unix-like systems
        this.cleanupSyncUnix();
      }

      this.log('Synchronous cleanup completed');
    } catch (error) {
      this.logError('Error during synchronous cleanup', error);
      // Don't throw during process exit cleanup
    }
  }

  private cleanupSyncWindows(): void {
    try {
      // Get container IDs with test.cleanup label
      const containerIds = execFileSync(this.dockerPath, ['ps', '-a', '--filter', 'label=test.cleanup=true', '-q'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();

      if (containerIds) {
        const ids = containerIds.split('\n').filter((id) => id.trim());
        this.log(`Found ${ids.length} test containers to clean up`);

        for (const id of ids) {
          try {
            const trimmedId = id.trim();
            this.log(`Stopping container: ${trimmedId}`);
            try {
              execFileSync(this.dockerPath, ['stop', '-t', '5', trimmedId], { stdio: 'ignore' });
            } catch {
              // Already stopped
            }

            this.log(`Removing container: ${trimmedId}`);
            execFileSync(this.dockerPath, ['rm', '-f', trimmedId], { stdio: 'ignore' });
            this.log(`Container removed: ${trimmedId}`);
          } catch (error) {
            this.logError(`Failed to cleanup container ${id}`, error);
            // Continue with other containers
          }
        }
      }

      // Remove test networks
      try {
        const networkIds = execFileSync(this.dockerPath, ['network', 'ls', '--filter', 'label=test.cleanup=true', '-q'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();

        if (networkIds) {
          const ids = networkIds.split('\n').filter((id) => id.trim());
          this.log(`Found ${ids.length} test networks to clean up`);

          for (const id of ids) {
            try {
              this.log(`Removing network: ${id.trim()}`);
              execFileSync(this.dockerPath, ['network', 'rm', id.trim()], { stdio: 'ignore' });
              this.log(`Network removed: ${id.trim()}`);
            } catch (error) {
              this.logError(`Failed to cleanup network ${id}`, error);
            }
          }
        }
      } catch (error) {
        this.logError('Failed to cleanup networks', error);
      }
    } catch (error) {
      this.logError('Windows cleanup failed', error);
    }
  }

  private cleanupSyncUnix(): void {
    try {
      // Remove containers
      const containerCmd = `"${this.dockerPath}" ps -a --filter "label=test.cleanup=true" -q`;
      try {
        const ids = execSync(containerCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (ids) {
          const containerIds = ids.split('\n').filter((id) => id.trim());
          this.log(`Found ${containerIds.length} test containers to clean up`);

          for (const id of containerIds) {
            try {
              const trimmedId = id.trim();
              this.log(`Stopping container: ${trimmedId}`);
              try {
                execFileSync(this.dockerPath, ['stop', '-t', '5', trimmedId], { stdio: 'ignore' });
              } catch {
                // Already stopped
              }

              this.log(`Removing container: ${trimmedId}`);
              execFileSync(this.dockerPath, ['rm', '-f', trimmedId], { stdio: 'ignore' });
              this.log(`Container removed: ${trimmedId}`);
            } catch (error) {
              this.logError(`Failed to cleanup container ${id}`, error);
            }
          }
        }
      } catch (error) {
        this.logError('Failed to cleanup containers', error);
      }

      // Remove test networks
      try {
        const networkCmd = `"${this.dockerPath}" network ls --filter "label=test.cleanup=true" -q`;
        const ids = execSync(networkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (ids) {
          const networkIds = ids.split('\n').filter((id) => id.trim());
          this.log(`Found ${networkIds.length} test networks to clean up`);

          for (const id of networkIds) {
            try {
              this.log(`Removing network: ${id.trim()}`);
              execFileSync(this.dockerPath, ['network', 'rm', id.trim()], { stdio: 'ignore' });
              this.log(`Network removed: ${id.trim()}`);
            } catch (error) {
              this.logError(`Failed to cleanup network ${id}`, error);
            }
          }
        }
      } catch (error) {
        this.logError('Failed to cleanup networks', error);
      }

      // Remove test volumes
      try {
        const volumeCmd = `"${this.dockerPath}" volume ls --filter "label=test.cleanup=true" -q`;
        const ids = execSync(volumeCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (ids) {
          const volumeIds = ids.split('\n').filter((id) => id.trim());
          this.log(`Found ${volumeIds.length} test volumes to clean up`);

          for (const id of volumeIds) {
            try {
              this.log(`Removing volume: ${id.trim()}`);
              execFileSync(this.dockerPath, ['volume', 'rm', '-f', id.trim()], { stdio: 'ignore' });
              this.log(`Volume removed: ${id.trim()}`);
            } catch (error) {
              this.logError(`Failed to cleanup volume ${id}`, error);
            }
          }
        }
      } catch (error) {
        this.logError('Failed to cleanup volumes', error);
      }
    } catch (error) {
      this.logError('Unix cleanup failed', error);
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
        POSTGRES_HOST_AUTH_METHOD: 'trust',
      },
      healthcheck: {
        test: ['CMD-SHELL', `pg_isready -U ${user}`],
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
        MYSQL_ALLOW_EMPTY_PASSWORD: 'yes',
      },
      healthcheck: {
        test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
        interval: '1s',
        timeout: '3s',
        retries: 10,
        startPeriod: '5s',
      },
      waitFor: {
        healthcheck: true,
        timeout: 30000,
      },
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
