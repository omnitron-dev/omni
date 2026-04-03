/**
 * Docker Test Manager Types
 *
 * Type definitions for Docker container management in tests.
 * These are runtime-agnostic and have no framework dependencies.
 */

/**
 * Status information for a Docker container
 */
export interface DockerContainerStatus {
  /** Whether the container is currently running */
  isRunning: boolean;
  /** Container state (running, exited, paused, etc.) */
  state?: string;
  /** Health check status (healthy, unhealthy, starting) */
  health?: string;
  /** Exit code if container has stopped */
  exitCode?: number;
}

/**
 * Represents a running Docker container instance
 */
export interface DockerContainer {
  /** Unique test identifier */
  id: string;
  /** Container name */
  name: string;
  /** Docker image used */
  image: string;
  /** Primary host port (first mapped port for convenience) */
  port?: number;
  /** Host address (typically 127.0.0.1) */
  host: string;
  /** Map of container port to host port */
  ports: Map<number, number>;
  /** Environment variables set in container */
  environment: Record<string, string>;
  /** Docker labels applied to container */
  labels: Record<string, string>;
  /** Networks the container is connected to */
  networks: string[];
  /** When the container was created */
  createdAt: Date;
  /** Internal IP address within Docker network */
  internalIp?: string;
  /** Clean up and remove this container */
  cleanup: () => Promise<void>;
  /** Get current container status */
  getStatus: () => Promise<DockerContainerStatus>;
  /** Check if container is healthy */
  isHealthy: () => Promise<boolean>;
}

/**
 * Configuration options for DockerTestManager
 */
export interface DockerTestManagerOptions {
  /** Path to docker executable (auto-detected if not provided) */
  dockerPath?: string;
  /** Base port for dynamic port allocation (default: 10000 + worker offset) */
  basePort?: number;
  /** Maximum retries for port allocation (default: 20) */
  maxRetries?: number;
  /** Timeout in ms for container startup (default: 30000) */
  startupTimeout?: number;
  /** Whether to cleanup containers on exit (default: true) */
  cleanup?: boolean;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Default network for containers */
  network?: string;
  /** Timeout in ms for graceful shutdown (default: 10000) */
  gracefulShutdownTimeout?: number;
  /** Maximum retries for container cleanup (default: 3) */
  maxCleanupRetries?: number;
}

/**
 * Options for creating a Docker container
 */
export interface ContainerOptions {
  /** Container name (auto-generated if not provided) */
  name?: string;
  /** Docker image to use */
  image: string;
  /** Command to run in container */
  command?: string;
  /** Port mappings: container port -> host port or 'auto' */
  ports?: Record<number, number | 'auto'>;
  /** Environment variables */
  environment?: Record<string, string>;
  /** Docker labels */
  labels?: Record<string, string>;
  /** Volume mounts (format: "host:container" or "volume:container") */
  volumes?: string[];
  /** Networks to connect to */
  networks?: string[];
  /** Health check configuration */
  healthcheck?: {
    /** Health check command (array format: ['CMD', 'arg1', ...] or ['CMD-SHELL', 'command']) */
    test: string[];
    /** Interval between checks (e.g., "1s") */
    interval?: string;
    /** Timeout for each check (e.g., "3s") */
    timeout?: string;
    /** Number of retries before unhealthy */
    retries?: number;
    /** Start period before checks begin (e.g., "2s") */
    startPeriod?: string;
  };
  /** Wait conditions before considering container ready */
  waitFor?: {
    /** Wait for specific port to be listening */
    port?: number;
    /** Timeout in ms for wait conditions (default: uses startupTimeout) */
    timeout?: number;
    /** Wait for health check to pass */
    healthcheck?: boolean;
  };
}

/**
 * Options for creating a standalone Redis container
 */
export interface RedisContainerOptions {
  /** Container name (auto-generated if not provided) */
  name?: string;
  /** Host port or 'auto' for dynamic allocation */
  port?: number | 'auto';
  /** Redis password (if requirePass is true) */
  password?: string;
  /** Redis database number (default: 0) */
  database?: number;
  /** Maximum memory limit (default: "256mb") */
  maxMemory?: string;
  /** Require password authentication (default: true if password is set) */
  requirePass?: boolean;
}

/**
 * Options for creating a Redis Cluster
 */
export interface RedisClusterOptions {
  /** Number of master nodes (default: 3) */
  masterCount?: number;
  /** Number of replicas per master (default: 1) */
  replicasPerMaster?: number;
  /** Base port for first node (deprecated - uses dynamic allocation) */
  basePort?: number;
  /** Redis password for all nodes */
  password?: string;
  /** Network name (auto-generated if not provided) */
  network?: string;
  /** Timeout in ms for cluster to become ready (default: 120000) */
  readyTimeout?: number;
  /** Pre-initialization delay in ms after containers start (default: 5000) */
  preInitDelay?: number;
}

/**
 * Represents a Redis Cluster with all its components
 */
export interface RedisClusterContainers {
  /** Master node containers */
  masters: DockerContainer[];
  /** Replica node containers */
  replicas: DockerContainer[];
  /** Docker network name */
  network: string;
  /** List of all nodes with their host:port */
  nodes: Array<{ host: string; port: number }>;
  /** NAT mapping for cluster connectivity (internal IP:port -> external host:port) */
  natMap?: Record<string, { host: string; port: number }>;
  /** Clean up all cluster containers and network */
  cleanup: () => Promise<void>;
}

/**
 * Options for creating a Redis Sentinel setup
 */
export interface RedisSentinelOptions {
  /** Sentinel master name (default: "mymaster") */
  masterName?: string;
  /** Number of replica nodes (default: 2) */
  replicaCount?: number;
  /** Number of sentinel nodes (default: 3) */
  sentinelCount?: number;
  /** Base port for first node (deprecated - uses dynamic allocation) */
  basePort?: number;
  /** Redis password for all nodes */
  password?: string;
  /** Network name (auto-generated if not provided) */
  network?: string;
}

/**
 * Represents a Redis Sentinel setup with all its components
 */
export interface RedisSentinelContainers {
  /** Master node container */
  master: DockerContainer;
  /** Replica node containers */
  replicas: DockerContainer[];
  /** Sentinel node containers */
  sentinels: DockerContainer[];
  /** Docker network name */
  network: string;
  /** Sentinel master name */
  masterName: string;
  /** Sentinel ports for connecting */
  sentinelPorts: number[];
  /** Clean up all containers and network */
  cleanup: () => Promise<void>;
}
