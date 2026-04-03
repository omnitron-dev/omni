/**
 * Generic Docker Test Manager
 *
 * Provides a unified interface for managing Docker containers in tests
 * with robust lifecycle management, graceful shutdown, and reliable cleanup.
 *
 * Features:
 * - Singleton pattern for centralized container management
 * - Automatic port allocation with worker-aware ranges
 * - Cross-platform Docker executable detection
 * - Graceful shutdown with cleanup on exit
 * - Health check support
 * - Network management
 */

import { execSync, execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as net from 'net';
import { EventEmitter } from 'events';
import type { DockerContainer, DockerContainerStatus, DockerTestManagerOptions, ContainerOptions } from './types.js';

/**
 * Docker Test Manager
 *
 * Manages Docker containers for testing with automatic cleanup and port allocation.
 * Uses singleton pattern to ensure proper cleanup across test suites.
 *
 * @example
 * ```typescript
 * const manager = DockerTestManager.getInstance();
 * const container = await manager.createContainer({
 *   image: 'redis:7-alpine',
 *   ports: { 6379: 'auto' },
 *   healthcheck: {
 *     test: ['CMD', 'redis-cli', 'ping'],
 *     interval: '1s',
 *   },
 *   waitFor: { healthcheck: true },
 * });
 *
 * // Use container...
 * await container.cleanup();
 * ```
 */
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

    // Worker-aware port allocation to prevent conflicts in parallel test execution
    // Each vitest worker gets its own port range within valid TCP port space (10000-65000)
    const workerId = parseInt(process.env['VITEST_POOL_ID'] || process.env['VITEST_WORKER_ID'] || '1', 10);
    const maxBasePort = 55000; // Leave room for 10k range below 65535
    const basePortOffset = ((workerId - 1) * 10000) % (maxBasePort - 10000);
    this.basePort = options.basePort || Math.min(10000 + basePortOffset, maxBasePort);

    this.maxRetries = options.maxRetries || 30;
    this.startupTimeout = options.startupTimeout || 60000;
    this.gracefulShutdownTimeout = options.gracefulShutdownTimeout || 10000;
    this.maxCleanupRetries = options.maxCleanupRetries || 3;
    this.cleanup = options.cleanup !== false;
    this.verbose = options.verbose || false;
    this.defaultNetwork = options.network;

    if (this.verbose) {
      this.log(`Initialized for Vitest worker ${workerId} with port range ${this.basePort}-${this.basePort + 10000}`);
    }

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

  /**
   * Get the singleton instance of DockerTestManager
   *
   * @param options - Configuration options (only used on first call)
   * @returns The singleton DockerTestManager instance
   */
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
   *
   * @throws Error if Docker cannot be found
   * @private
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
      const dockerPath = result.split('\n')[0]?.trim();

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
   * @private
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
   * @private
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

  /**
   * Verify Docker is available and working
   * @throws Error if Docker is not available
   * @private
   */
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

  /**
   * Find an available port for container mapping
   * @private
   */
  private async findAvailablePort(): Promise<number> {
    const portRangeSize = Math.min(10000, 65535 - this.basePort);
    for (let i = 0; i < this.maxRetries; i++) {
      const port = this.basePort + Math.floor(Math.random() * portRangeSize);
      if (port >= 65536) continue; // Safety guard
      if (!this.usedPorts.has(port) && (await this.isPortAvailable(port))) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('Could not find available port for container');
  }

  /**
   * Check if a port is available on localhost
   * @private
   */
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

  /**
   * Log a message if verbose mode is enabled
   * @private
   */
  private log(message: string, data?: any): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      const msg = data ? `[${timestamp}] ${message}: ${JSON.stringify(data)}` : `[${timestamp}] ${message}`;
      console.log(msg);
    }
  }

  /**
   * Log an error message
   * @private
   */
  private logError(message: string, error: any): void {
    const timestamp = new Date().toISOString();
    const err = error instanceof Error ? error.message : String(error);
    const msg = `[${timestamp}] ERROR: ${message}: ${err}`;
    if (this.verbose) {
      console.error(msg);
    }
  }

  /**
   * Get the status of a container
   * @private
   */
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

  /**
   * Check if a container is healthy
   * @private
   */
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

  /**
   * Create and start a Docker container
   *
   * @param options - Container configuration
   * @returns Promise resolving to DockerContainer instance
   *
   * @example
   * ```typescript
   * const container = await manager.createContainer({
   *   image: 'postgres:16-alpine',
   *   ports: { 5432: 'auto' },
   *   environment: { POSTGRES_PASSWORD: 'test' },
   *   healthcheck: {
   *     test: ['CMD', 'pg_isready'],
   *     interval: '1s',
   *   },
   *   waitFor: { healthcheck: true },
   * });
   * ```
   */
  async createContainer(options: ContainerOptions): Promise<DockerContainer> {
    const id = `test-${randomBytes(8).toString('hex')}`; // 8 bytes for better uniqueness in parallel execution
    const name = options.name || `container-${id}`;
    const host = '127.0.0.1';

    // Remove any existing container with the same name to avoid conflicts
    try {
      execFileSync(this.dockerPath, ['rm', '-f', name], { stdio: 'ignore' });
      this.log(`Removed existing container: ${name}`);
    } catch {
      // Container doesn't exist, which is fine
    }

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
      // Docker CLI --health-cmd expects a string that is executed by the shell
      // The healthcheck.test array format from Docker Compose needs to be converted:
      // - ['CMD', 'arg1', 'arg2'] -> execute command directly (no shell)
      // - ['CMD-SHELL', 'command'] -> execute via shell
      let healthCmd: string;
      if (Array.isArray(options.healthcheck.test)) {
        if (options.healthcheck.test[0] === 'CMD-SHELL') {
          // CMD-SHELL format: join everything after the first element
          healthCmd = options.healthcheck.test.slice(1).join(' ');
        } else if (options.healthcheck.test[0] === 'CMD') {
          // CMD format: join command parts without shell
          // Docker CLI expects this as a single string that will be word-split
          // For example: ['CMD', 'redis-cli', 'ping'] -> 'redis-cli ping'
          healthCmd = options.healthcheck.test.slice(1).join(' ');
        } else {
          // No format specifier, join all parts
          healthCmd = options.healthcheck.test.join(' ');
        }
      } else {
        // String format
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
      const result = execFileSync(this.dockerPath, dockerArgs, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'], // Always capture output for better error messages
      });
      if (this.verbose && result) {
        console.log(result);
      }
    } catch (error) {
      // Clean up allocated ports before throwing
      portMappings.forEach((port) => {
        this.usedPorts.delete(port);
      });
      const execError = error as {
        stderr?: Buffer | string;
        stdout?: Buffer | string;
        message?: string;
        status?: number;
      };
      const stderr = execError.stderr ? String(execError.stderr).trim() : '';
      const stdout = execError.stdout ? String(execError.stdout).trim() : '';
      const message = execError.message || String(error);

      // Check if container already exists
      if (stderr.includes('already in use') || stderr.includes('name is already') || stderr.includes('Conflict')) {
        throw new Error(
          `Container name conflict: ${name} already exists.\n` +
            `Please ensure previous test containers are cleaned up.\n` +
            `Stderr: ${stderr}`,
          { cause: error }
        );
      }

      throw new Error(
        `Failed to start container ${name}:\n` +
          `Command: docker ${dockerArgs.join(' ')}\n` +
          `Exit code: ${execError.status || 'unknown'}\n` +
          (stderr ? `Stderr: ${stderr}\n` : '') +
          (stdout ? `Stdout: ${stdout}\n` : '') +
          (message && !stderr && !stdout ? `Error: ${message}` : ''),
        { cause: error }
      );
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

    // Get internal IP if container is on a network
    let internalIp: string | undefined;
    if (networks.length > 0) {
      try {
        const ipOutput = execFileSync(
          this.dockerPath,
          ['inspect', name, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'],
          {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }
        ).trim();
        if (ipOutput) {
          internalIp = ipOutput;
          this.log(`Container ${name} internal IP: ${internalIp}`);
        }
      } catch (error) {
        this.logError(`Failed to get internal IP for ${name}`, error);
        // Continue without internal IP
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
      internalIp,
      getStatus: async () => this.getContainerStatus(name),
      isHealthy: async () => this.isContainerHealthy(name),
      cleanup: async () => {
        await this.cleanupContainerWithRetry(name, id, portMappings);
      },
    };

    this.containers.set(id, container);
    return container;
  }

  /**
   * Clean up a container with retry logic
   * @private
   */
  private async cleanupContainerWithRetry(name: string, id: string, portMappings: Map<number, number>): Promise<void> {
    this.log(`Starting cleanup for container: ${name}`);

    let lastError!: Error | null;

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

  /**
   * Ensure a Docker network exists
   * @private
   */
  private async ensureNetwork(network: string): Promise<void> {
    if (!this.networks.has(network)) {
      try {
        execFileSync(this.dockerPath, ['network', 'create', network, '--label', 'test.cleanup=true'], {
          stdio: 'pipe',
          encoding: 'utf8',
        });
        this.networks.add(network);
        this.log(`Created network: ${network}`);
      } catch (error) {
        const execError = error as { stderr?: string; stdout?: string; message?: string };
        const stderr = execError.stderr || execError.message || String(error);
        // Network might already exist - check if that's the case
        if (stderr.includes('already exists') || stderr.includes('network with name')) {
          this.log(`Network already exists: ${network}`);
          this.networks.add(network);
        } else if (stderr.includes('all predefined address pools have been fully subnetted')) {
          // Docker network pool exhausted - try to clean up unused networks
          this.log('Docker network pool exhausted, attempting cleanup...');
          try {
            // Prune unused networks
            execFileSync(this.dockerPath, ['network', 'prune', '-f'], {
              stdio: 'ignore',
            });
            this.log('Cleaned up unused networks, retrying network creation...');
            // Retry network creation after cleanup
            execFileSync(this.dockerPath, ['network', 'create', network, '--label', 'test.cleanup=true'], {
              stdio: 'pipe',
              encoding: 'utf8',
            });
            this.networks.add(network);
            this.log(`Created network after cleanup: ${network}`);
          } catch (_retryError) {
            throw new Error(`Failed to create network ${network} even after cleanup: ${stderr}`, { cause: _retryError });
          }
        } else {
          // Real error - throw it
          throw new Error(`Failed to create network ${network}: ${stderr}`, { cause: error });
        }
      }
    }
  }

  /**
   * Remove a Docker network
   * @private
   */
  private async removeNetwork(network: string): Promise<void> {
    if (!this.networks.has(network)) {
      return; // Network not tracked by this manager
    }

    try {
      execFileSync(this.dockerPath, ['network', 'rm', network], {
        stdio: 'ignore',
      });
      this.networks.delete(network);
      this.log(`Removed network: ${network}`);
    } catch (error) {
      // Network might still be in use or already removed
      this.networks.delete(network); // Remove from tracking anyway
      this.logError(`Failed to remove network ${network}`, error);
    }
  }

  /**
   * Wait for a container to be ready
   * @private
   */
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
            const elapsed = Date.now() - startTime;
            this.logError(
              `Container ${name} health check failed after ${elapsed}ms`,
              new Error(`Health status: ${status.health}, State: ${status.state}`)
            );
            throw new Error(
              `Container ${name} health check failed. ` + `Check container logs with 'docker logs ${name}'`
            );
          }

          // Health check is still starting
          if (status.health === 'starting') {
            const elapsed = Date.now() - startTime;
            this.log(`Waiting for health check on ${name}...`, {
              elapsed,
              remaining: timeout - elapsed,
              state: status.state,
            });
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

  /**
   * Check if a port is listening
   * @private
   */
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

  /**
   * Get a container by ID
   *
   * @param id - Container ID
   * @returns DockerContainer or undefined if not found
   */
  async getContainer(id: string): Promise<DockerContainer | undefined> {
    return this.containers.get(id);
  }

  /**
   * Clean up a specific container
   *
   * @param id - Container ID to clean up
   */
  async cleanupContainer(id: string): Promise<void> {
    const container = this.containers.get(id);
    if (container) {
      await container.cleanup();
    }
  }

  /**
   * Clean up all containers managed by this instance
   */
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

  /**
   * Async cleanup - for signal handlers
   * @private
   */
  private async cleanupAllAsync(): Promise<void> {
    this.log('Initiating graceful cleanup of all test containers');
    await this.cleanupAll();
  }

  /**
   * Synchronous cleanup - for process exit
   * @private
   */
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

  /**
   * Windows-specific synchronous cleanup
   * @private
   */
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
        const networkIds = execFileSync(
          this.dockerPath,
          ['network', 'ls', '--filter', 'label=test.cleanup=true', '-q'],
          {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          }
        ).trim();

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

  /**
   * Unix-specific synchronous cleanup
   * @private
   */
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

  /**
   * Helper to run tests with a container
   *
   * @param options - Container configuration
   * @param testFn - Test function that receives the container
   * @returns Promise resolving to test function result
   *
   * @example
   * ```typescript
   * await DockerTestManager.withContainer(
   *   { image: 'redis:7-alpine', ports: { 6379: 'auto' } },
   *   async (container) => {
   *     // Use container in tests
   *     const port = container.port!;
   *     // ...
   *   }
   * );
   * ```
   */
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
