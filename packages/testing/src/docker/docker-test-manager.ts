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

import { execSync, execFileSync, execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { hostname } from 'os';
import * as net from 'net';
import { EventEmitter } from 'events';
import type { DockerContainer, DockerContainerStatus, DockerTestManagerOptions, ContainerOptions } from './types.js';

/**
 * `docker ps --format '{{.Labels}}'` renders labels as `k=v,k=v`. Values here
 * are manager ids and hostnames, neither of which contains a comma.
 */
function parseDockerLabels(labels: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of labels.split(',')) {
    const eq = pair.indexOf('=');
    if (eq > 0) out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** Docker's CLI evaluates --health-cmd in a shell. Preserve literal CMD arguments. */
function dockerHealthCommand(test: string | string[]): string {
  if (typeof test === 'string') return test;
  const [mode, ...args] = test;
  if (mode === 'CMD-SHELL') return args.join(' ');
  const argv = mode === 'CMD' ? args : test;
  return argv.map(arg => "'" + arg.replaceAll("'", "'\\''") + "'").join(' ');
}

/** The pid the manager id starts with, or null when it is not one. */
function pidFromManagerId(managerId: string): number | null {
  const pid = Number.parseInt(managerId.split('-')[0] ?? '', 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/**
 * Signal 0 asks the kernel whether the process exists without delivering
 * anything. EPERM means it exists and belongs to another user, which is still
 * alive; only ESRCH means gone.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * `docker ps --format '{{.CreatedAt}}'` prints `2026-09-06 01:07:22 +0300 MSK`
 * — not ISO 8601, and the trailing abbreviation is ambiguous between zones.
 * The numeric offset in front of it is not, so the abbreviation is dropped and
 * the rest is rewritten into a form `Date.parse` is specified to accept.
 * Returns null when the shape is anything else, and a null age is never old
 * enough to reap.
 */
function parseDockerTimestamp(createdAt: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.\d+)? ([+-]\d{2})(\d{2})/.exec(createdAt.trim());
  if (!m) return null;
  const parsed = Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);
  return Number.isNaN(parsed) ? null : parsed;
}

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
  private networks = new Map<string, string>();
  private activeCleanup?: Promise<void>;

  private dockerPath: string;

  /**
   * How many times a `docker run` may be re-attempted with freshly drawn `auto`
   * host ports after docker refuses the published port. Small on purpose: this
   * covers losing a race, not a machine with no free ports.
   */
  private static readonly PORT_COLLISION_RETRIES = 3;

  private basePort: number;
  private maxRetries: number;
  private startupTimeout: number;
  private gracefulShutdownTimeout: number;
  private maxCleanupRetries: number;
  private cleanup: boolean;
  private verbose: boolean;
  private defaultNetwork?: string;

  /**
   * Identifies the resources THIS manager created.
   *
   * Cleanup used to select by the shared `test.cleanup=true` label, i.e. every
   * test container on the host. Vitest gives each spec file its own worker
   * process, each with its own manager and its own `process.on('exit')` hook,
   * so the first worker to finish stopped and removed containers the others
   * were still using. `docker stop` sends SIGTERM and Redis exits 0 on SIGTERM
   * — which is exactly the "Container exited with status 'exited' and exit code
   * 0" that made titan-redis, titan-database and titan-notifications flaky
   * under parallel runs.
   */
  private readonly managerId = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /**
   * The machine the pid in `managerId` belongs to. Tests that talk to a docker
   * daemon on another host would otherwise read that host's pid table as their
   * own. Containers created before this label existed carry no host, which is
   * absence of information rather than a mismatch, so they fall through to the
   * pid and age rules below.
   */
  private static readonly hostId = hostname();

  /** Orphan reaping is a property of the process, not of a manager instance. */
  private static orphanReapDone = false;

  /**
   * How old an unclaimed container must be before it is reaped.
   *
   * Pids are reused. A container created seconds ago belongs to a run that is
   * starting, whatever the pid table now says about the process that created
   * it, and this is what makes the reaper safe to run while other test
   * processes are working.
   */
  private static readonly orphanGraceMs = 10 * 60 * 1000;

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

      // Runs before any container of this process exists, so a reaped port is
      // free by the time this manager draws one.
      this.reapOrphanedResources();

      process.on('exit', () => this.cleanupSync());
      process.on('SIGINT', () => {
        this.log('SIGINT received - initiating graceful shutdown');
        this.cleanupAllAsync()
          .then(() => {
            this.log('Cleanup completed, exiting');
            process.exit(130);
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
            process.exit(143);
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
   * Remove containers and networks left behind by test processes that no
   * longer exist.
   *
   * `cleanupSync` and the signal handlers cover every ending the process gets
   * to observe. SIGKILL is not one of them, and it is the ending vitest uses
   * for a worker that overruns teardown — so a killed run leaves its
   * containers running, holding their ports, their memory and their anonymous
   * volumes, with nothing left on the machine that refers to them.
   *
   * A container is reaped only when BOTH hold:
   *
   *   - the pid recorded in `test.manager` is not alive. Pids are reused, so
   *     this alone can name a live manager's container as an orphan;
   *   - it is older than `orphanGraceMs`. A container seconds old belongs to a
   *     run that is starting, whatever the pid table says.
   *
   * Each condition failing leaves a container behind for the next run to
   * collect. Neither can remove a container that is in use.
   *
   * Errors are swallowed: this runs from a constructor, and a machine whose
   * docker is unreachable should fail on the first container command with that
   * command's message, not on construction.
   *
   * @private
   */
  private reapOrphanedResources(): void {
    if (DockerTestManager.orphanReapDone) return;
    DockerTestManager.orphanReapDone = true;

    try {
      const listed = execFileSync(
        this.dockerPath,
        ['ps', '-a', '--filter', 'label=test.cleanup=true', '--format', '{{.ID}}\t{{.CreatedAt}}\t{{.Labels}}'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();

      const orphans: string[] = [];
      for (const line of listed ? listed.split('\n') : []) {
        const [id, createdAt, labels] = line.split('\t');
        if (!id || !createdAt || !labels) continue;
        if (!this.isOrphaned(labels, createdAt)) continue;
        orphans.push(id);
      }

      if (orphans.length > 0) {
        this.log(`Reaping ${orphans.length} container(s) left by processes that no longer exist`);
        // One call, not one per container: a stalled machine can hold dozens,
        // and every worker of a parallel run pays this before its first test.
        try {
          execFileSync(this.dockerPath, ['rm', '-f', '-v', ...orphans], { stdio: 'ignore' });
        } catch (error) {
          // A concurrent worker reaping the same container makes `docker rm`
          // exit non-zero for that id and continue with the rest. Both wanted
          // it gone.
          this.logError('Some orphaned containers could not be removed', error);
        }
      }

      this.reapOrphanedNetworks();
    } catch (error) {
      this.logError('Could not scan for orphaned test containers', error);
    }
  }

  /**
   * The same rule for networks, minus the age condition: `docker network rm`
   * refuses a network that still has an endpoint attached, so an in-use
   * network is protected by docker itself rather than by a grace period. A
   * leaked one is not free — the address pool it comes from is what
   * `createNetwork` already has to recover from when it runs out.
   *
   * @private
   */
  private reapOrphanedNetworks(): void {
    try {
      const listed = execFileSync(
        this.dockerPath,
        ['network', 'ls', '--filter', 'label=test.cleanup=true', '--format', '{{.ID}}\t{{.Labels}}'],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      ).trim();

      const orphans: string[] = [];
      for (const line of listed ? listed.split('\n') : []) {
        const [id, labels] = line.split('\t');
        if (!id || !labels) continue;
        if (!this.isOrphaned(labels, null)) continue;
        orphans.push(id);
      }

      if (orphans.length > 0) {
        this.log(`Reaping ${orphans.length} network(s) left by processes that no longer exist`);
        try {
          execFileSync(this.dockerPath, ['network', 'rm', ...orphans], { stdio: 'ignore' });
        } catch (error) {
          // Refused for a network still in use, which is the answer we want.
          this.logError('Some orphaned test networks could not be removed', error);
        }
      }
    } catch (error) {
      this.logError('Could not scan for orphaned test networks', error);
    }
  }

  /**
   * Whether a labelled resource belongs to a test process that is gone.
   *
   * @param createdAt - `{{.CreatedAt}}`, or null to skip the age condition.
   * @private
   */
  private isOrphaned(labels: string, createdAt: string | null): boolean {
    const parsed = parseDockerLabels(labels);

    const owner = parsed['test.manager'];
    // No owner recorded: created by a manager older than the label, or by
    // something else entirely. Either way this reaper cannot say whose it is.
    if (!owner || owner === this.managerId) return false;

    const host = parsed['test.host'];
    if (host && host !== DockerTestManager.hostId) return false;

    const pid = pidFromManagerId(owner);
    if (pid === null || isPidAlive(pid)) return false;

    if (createdAt !== null) {
      const created = parseDockerTimestamp(createdAt);
      if (created === null) return false;
      if (Date.now() - created < DockerTestManager.orphanGraceMs) return false;
    }

    return true;
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
          // `.State.Health` is absent on a container with no HEALTHCHECK, and
          // Go templates fail hard on a missing map key rather than rendering
          // empty: `docker inspect` exited 1 with "map has no entry for key
          // \"Health\"". stderr is ignored here and the catch below reports a
          // default, so every such container was read as NOT RUNNING — and
          // `waitForContainer` rejected with "Container exited with status
          // 'undefined' and exit code undefined" for a container that was
          // running perfectly. That made `waitFor` unusable with any image
          // lacking a healthcheck, which is precisely the case
          // `waitFor.healthcheck: false` exists to serve; callers worked around
          // it by always declaring one.
          '{{.State.Running}}\t{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}\t{{.State.ExitCode}}',
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
    const resources = options.resources;
    if (resources?.memoryBytes !== undefined && (!Number.isSafeInteger(resources.memoryBytes) || resources.memoryBytes < 6 * 1024 * 1024))
      throw new RangeError('memoryBytes must be a safe integer of at least 6 MiB');
    if (resources?.cpus !== undefined && (!Number.isFinite(resources.cpus) || resources.cpus <= 0))
      throw new RangeError('cpus must be a finite positive number');
    if (resources?.pidsLimit !== undefined && (!Number.isSafeInteger(resources.pidsLimit) || resources.pidsLimit < 1))
      throw new RangeError('pidsLimit must be a positive safe integer');
    const id = `test-${randomBytes(8).toString('hex')}`; // 8 bytes for better uniqueness in parallel execution
    const name = options.name || `container-${id}`;
    const host = '127.0.0.1';

    // Process port mappings.
    //
    // `auto` ports are re-drawn if docker refuses the run: findAvailablePort()
    // binds, reads the port and releases it, so between that check and
    // `docker run` anything else on the machine can take it — another suite in
    // this repo, another session, a container someone restarted. The window is
    // small and the machine is shared, which is exactly the combination that
    // produces a red test blaming the code under test.
    const autoPorts = new Set<number>();
    const portMappings = new Map<number, number>();
    if (options.ports) {
      for (const [containerPort, hostPort] of Object.entries(options.ports)) {
        const cPort = parseInt(containerPort);
        if (hostPort === 'auto') autoPorts.add(cPort);
        const hPort = hostPort === 'auto' ? await this.findAvailablePort() : hostPort;
        portMappings.set(cPort, hPort);
      }
    }

    // Build docker run command
    const dockerArgs: string[] = ['run', '-d', '--name', name];
    if (resources?.memoryBytes !== undefined) dockerArgs.push('--memory', String(resources.memoryBytes));
    if (resources?.cpus !== undefined) dockerArgs.push('--cpus', String(resources.cpus));
    if (resources?.pidsLimit !== undefined) dockerArgs.push('--pids-limit', String(resources.pidsLimit));

    // Add ports. The slice is remembered so a collision retry can rewrite just
    // these entries instead of rebuilding the whole command.
    const portArgsStart = dockerArgs.length;
    const writePortArgs = () => {
      const args: string[] = [];
      portMappings.forEach((hostPort, containerPort) => {
        // The loopback only: a bare `-p host:container` publishes on 0.0.0.0,
        // past the host firewall, and a test database with its default
        // credentials is then a database the LAN can log into
        // (scripts/a-port-the-network-could-reach.mjs). `isPortAvailable`
        // probes the same address.
        args.push('-p', `127.0.0.1:${hostPort}:${containerPort}`);
      });
      return args;
    };
    dockerArgs.push(...writePortArgs());
    const portArgsLength = dockerArgs.length - portArgsStart;
    const rebuildPortArgs = () => {
      dockerArgs.splice(portArgsStart, portArgsLength, ...writePortArgs());
    };

    // Add environment variables
    const environment = options.environment || {};
    for (const [key, value] of Object.entries(environment)) {
      dockerArgs.push('-e', `${key}=${value}`);
    }

    // Add labels
    const labels = {
      ...options.labels,
      'test.id': id,
      'test.cleanup': 'true',
      // Ownership, so cleanup can select this manager's containers instead of
      // every test container on the machine.
      'test.manager': this.managerId,
      'test.host': DockerTestManager.hostId,
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
      dockerArgs.push('--health-cmd', dockerHealthCommand(options.healthcheck.test));
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
      if (Array.isArray(options.command)) dockerArgs.push(...options.command);
      else dockerArgs.push('sh', '-c', options.command);
    }

    let containerId: string;
    for (let attempt = 0; ; attempt++) {
      this.log(`Starting container: ${name}`, { image: options.image });
      // A synchronous Docker start blocks every peer's readiness timer while
      // Docker creates the next container. Keep cluster startup concurrent.
      const result = await new Promise<{ status: number | null; stdout: string; stderr: string; error?: { code?: string | number | null } }>(resolve => {
        execFile(this.dockerPath, dockerArgs, { encoding: 'utf8', timeout: this.startupTimeout, maxBuffer: 2 * 1024 * 1024 },
          (error, stdout, stderr) => resolve({ status: error ? (typeof error.code === 'number' ? error.code : null) : 0,
            stdout, stderr, ...(error && typeof error.code !== 'number' ? { error } : {}) }));
      });
      containerId = (result.stdout ?? '').trim();
      if (result.status === 0 && /^[a-f0-9]{64}$/.test(containerId)) break;
      portMappings.forEach(port => this.usedPorts.delete(port));
      let diagnostic = (result.stderr ?? '').trim();
      for (const value of Object.values(environment)) {
        if (value) diagnostic = diagnostic.replaceAll(value, '[redacted]');
      }
      if (/container name .*already in use|name is already in use/i.test(diagnostic)) {
        throw new Error(`Container name conflict: ${name} already exists`);
      }
      // A failed bind can leave a container in "created". Resolve this
      // attempt's labels and remove only the Docker ID they identify.
      const residue = execFileSync(this.dockerPath, ['ps', '-aq', '--no-trunc',
        '--filter', `label=test.id=${id}`, '--filter', `label=test.manager=${this.managerId}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (/^[a-f0-9]{64}$/.test(residue)) {
        execFileSync(this.dockerPath, ['rm', '-f', '-v', residue], { stdio: 'ignore' });
      }
      if (result.error) throw new Error(`Could not execute Docker for ${name}: ${result.error.code ?? 'unknown'}`);
      if (!/port is already allocated|address already in use|Bind for /.test(diagnostic)
        || !autoPorts.size || attempt >= DockerTestManager.PORT_COLLISION_RETRIES) {
        throw new Error(`Failed to start container ${name} (${options.image}), exit ${result.status ?? 'unknown'}: ${diagnostic.slice(0, 2000) || 'Docker did not confirm creation'}`);
      }
      for (const port of autoPorts) portMappings.set(port, await this.findAvailablePort());
      rebuildPortArgs();
      this.log(`Host port collision for ${name}, retrying with fresh ports`, { attempt: attempt + 1 });
    }

    // Wait for container to be ready
    if (options.waitFor) {
      try {
        await this.waitForContainer(containerId, options.waitFor, portMappings);
        this.log(`Container ready: ${name}`);
      } catch (error) {
        // Container failed to start, attempt cleanup
        this.logError(`Container ${name} failed to become ready, cleaning up`, error);
        try {
          execFileSync(this.dockerPath, ['stop', '-t', '5', containerId], { stdio: 'ignore' });
          execFileSync(this.dockerPath, ['rm', '-f', '-v', containerId], { stdio: 'ignore' });
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
      getStatus: async () => this.getContainerStatus(containerId),
      isHealthy: async () => this.isContainerHealthy(containerId),
      cleanup: async () => {
        await this.cleanupContainerWithRetry(containerId, id, portMappings);
      },
    };

    this.containers.set(id, container);
    return container;
  }

  /**
   * Clean up a container with retry logic
   * @private
   */
  private async cleanupContainerWithRetry(containerId: string, id: string, portMappings: Map<number, number>): Promise<void> {
    if (!this.containers.has(id)) return;
    const seconds = Math.ceil(this.gracefulShutdownTimeout / 1000).toString();
    try {
      execFileSync(this.dockerPath, ['stop', '-t', seconds, containerId], {
        stdio: 'ignore', timeout: this.gracefulShutdownTimeout + 5000,
      });
    } catch (error) {
      this.logError(`Could not stop test container ${containerId} gracefully`, error);
    }
    for (let attempt = 1; ; attempt++) {
      try {
        execFileSync(this.dockerPath, ['rm', '-f', '-v', containerId], { stdio: ['ignore', 'ignore', 'pipe'] });
        break;
      } catch (error) {
        if (/no such (container|object)/i.test(String((error as { stderr?: Buffer }).stderr))) break;
        if (attempt >= this.maxCleanupRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    portMappings.forEach(port => this.usedPorts.delete(port));
    this.containers.delete(id);
  }

  /**
   * Create a labelled network or join an existing network under its current owner.
   */
  async ensureNetwork(network: string): Promise<void> {
    const create = () => {
      const networkId = execFileSync(this.dockerPath, ['network', 'create', network,
        '--label', 'test.cleanup=true', '--label', `test.manager=${this.managerId}`,
        '--label', `test.host=${DockerTestManager.hostId}`], { stdio: 'pipe', encoding: 'utf8' }).trim();
      this.networks.set(network, networkId);
    };
    try { create(); }
    catch (error) {
      const reason = String((error as { stderr?: string }).stderr ?? error);
      if (reason.includes('already exists')) return;
      if (!reason.includes('all predefined address pools have been fully subnetted')) throw error;
      execFileSync(this.dockerPath, ['network', 'prune', '-f', '--filter', `label=test.manager=${this.managerId}`], { stdio: 'ignore' });
      create();
    }
  }

  /** Remove a network created by this manager, even if its name has since been reused. */
  async removeNetwork(network: string): Promise<void> {
    const id = this.networks.get(network);
    if (!id) return;
    try {
      execFileSync(this.dockerPath, ['network', 'rm', id], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      if (!/not found|no such network/i.test(String((error as { stderr?: Buffer }).stderr))) throw error;
    }
    this.networks.delete(network);
  }

  /**
   * Wait for a container to be ready
   * @private
   */
  private async waitForContainer(name: string, options: ContainerOptions['waitFor'], ports: Map<number, number>): Promise<void> {
    const startTime = Date.now();
    const timeout = options?.timeout || this.startupTimeout;

    let lastError: Error | undefined;

    while (Date.now() - startTime < timeout) {
      try {
        // First check if container is still running
        const status = await this.getContainerStatus(name);
        if (!status.state) throw new Error('Container status is unavailable');
        if (!status.isRunning) {
          throw new Error(
            `Container ${name} exited with status '${status.state}' and exit code ${status.exitCode}`
          );
        }

        if (options?.healthcheck && status.health === 'unhealthy') {
          const probes = execFileSync(this.dockerPath, ['inspect', '--format',
            '{{with .State.Health}}{{.FailingStreak}} failed probes{{range .Log}}; exit={{.ExitCode}} at {{.End}}{{end}}{{end}}', name],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
          throw new Error(`Container ${name} health check failed after ${Date.now() - startTime} ms (${probes})`);
        }
        const hostPort = options?.port && ports.get(options.port);
        if ((!options?.healthcheck || status.health === 'healthy') &&
            (!options?.port || (hostPort && await this.isPortListening('127.0.0.1', hostPort)))) return;
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
  cleanupAll(): Promise<void> {
    return this.activeCleanup ??= this.cleanupOwnedResources().finally(() => { this.activeCleanup = undefined; });
  }

  private async cleanupOwnedResources(): Promise<void> {
    const results = await Promise.allSettled(Array.from(this.containers.values(), container => container.cleanup()));
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    for (const network of this.networks.keys()) {
      try { await this.removeNetwork(network); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Some Docker test resources could not be removed');
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
      const containerIds = execFileSync(this.dockerPath, ['ps', '-a', '--filter', `label=test.manager=${this.managerId}`, '-q'], {
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
            execFileSync(this.dockerPath, ['rm', '-f', '-v', trimmedId], { stdio: 'ignore' });
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
          ['network', 'ls', '--filter', `label=test.manager=${this.managerId}`, '-q'],
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
      const containerCmd = `"${this.dockerPath}" ps -a --filter "label=test.manager=${this.managerId}" -q`;
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
              execFileSync(this.dockerPath, ['rm', '-f', '-v', trimmedId], { stdio: 'ignore' });
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
        const networkCmd = `"${this.dockerPath}" network ls --filter "label=test.manager=${this.managerId}" -q`;
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
        const volumeCmd = `"${this.dockerPath}" volume ls --filter "label=test.manager=${this.managerId}" -q`;
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
