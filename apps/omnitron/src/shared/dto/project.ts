/**
 * Project & Stack DTOs — Wire types for RPC communication
 *
 * These DTOs define the contract between webapp/CLI clients
 * and the daemon's ProjectService.
 */

import type {
  DaemonRole,
  IStackConfig,
  AppStatus,
} from '../../config/types.js';

// =============================================================================
// Project DTOs
// =============================================================================

export interface IProjectInfo {
  /** Registry name (directory-based, e.g. 'omni') */
  name: string;
  /** Display name from omnitron.config.ts `project` field (e.g. 'daos') */
  displayName: string;
  /** Absolute path to monorepo root */
  path: string;
  /** When the project was registered */
  registeredAt: string;
  /** Stacks that are enabled (running or auto-start) */
  enabledStacks: string[];
  /** Number of running stacks */
  runningStacks: number;
  /** Total number of configured stacks */
  totalStacks: number;
}

// =============================================================================
// Stack DTOs
// =============================================================================

export type StackStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'degraded' | 'error';

export interface IStackInfo {
  /** Stack name (e.g., 'dev', 'test', 'prod') */
  name: string;
  /** Stack deployment type */
  type: 'local' | 'remote' | 'cluster';
  /** Current runtime status */
  status: StackStatus;
  /** Stack configuration */
  config: IStackConfig;
  /** Nodes participating in this stack (remote/cluster) */
  nodes: IStackNodeStatus[];
  /** Apps running in this stack */
  apps: IStackAppStatus[];
  /** Infrastructure services provisioned for this stack */
  infrastructure: IStackInfraStatus;
  /** Port range allocated to this stack */
  portRange: { start: number; end: number } | null;
  /** When this stack was last started */
  startedAt: string | null;
  /** Uptime in ms (0 if not running) */
  uptime: number;
}

export interface IStackNodeStatus {
  /** Node host */
  host: string;
  /** Node port */
  port: number;
  /** Node role */
  role: string;
  /** Node label */
  label: string | null;
  /** Daemon role on this node */
  daemonRole: DaemonRole;
  /** Whether the node's daemon is reachable */
  connected: boolean;
  /** Last heartbeat timestamp */
  lastSeen: number | null;
  /** Sync status (for slave nodes) */
  syncStatus: ISyncStatus | null;
}

/**
 * Sync status for a slave daemon.
 * Tracks local buffer state and last successful sync to master.
 */
export interface ISyncStatus {
  /** Whether sync is currently active */
  connected: boolean;
  /** Last successful sync timestamp */
  lastSyncAt: number | null;
  /** Number of buffered items pending sync */
  pendingItems: number;
  /** Local buffer size in bytes */
  bufferSize: number;
  /** Last sync error (null if last sync succeeded) */
  lastError: string | null;
  /** Number of consecutive failed sync attempts */
  failedAttempts: number;
}

export interface IStackAppStatus {
  /** App name */
  name: string;
  /** Namespaced handle key: project/stack/app */
  handleKey: string;
  /** Current status */
  status: AppStatus;
  /** PID (null if not running) */
  pid: number | null;
  /** Number of instances */
  instances: number;
  /** Uptime in ms */
  uptime: number;
}

export interface IStackInfraStatus {
  /** Whether infrastructure is provisioned and healthy */
  ready: boolean;
  /** Individual service statuses */
  services: Record<string, {
    status: 'running' | 'stopped' | 'error';
    containerName: string;
    port: number | null;
  }>;
}

// =============================================================================
// Stack Runtime (detailed runtime state for a stack)
// =============================================================================

export interface StackRuntime {
  /** Stack name */
  name: string;
  /** Stack type */
  type: 'local' | 'remote' | 'cluster';
  /** Current status */
  status: StackStatus;
  /** Total apps */
  totalApps: number;
  /** Online apps */
  onlineApps: number;
  /** Total nodes (1 for local) */
  totalNodes: number;
  /** Connected nodes */
  connectedNodes: number;
  /** Aggregate CPU across all apps in this stack */
  totalCpu: number;
  /** Aggregate memory across all apps in this stack */
  totalMemory: number;
  /** Sync status summary (for remote/cluster stacks) */
  syncSummary: {
    /** Total slave nodes */
    totalSlaves: number;
    /** Slaves currently syncing successfully */
    syncedSlaves: number;
    /** Total pending items across all slaves */
    totalPending: number;
  } | null;
}

// =============================================================================
// Project Requirements (from static analysis)
// =============================================================================

export interface IProjectRequirements {
  /** Per-app infrastructure requirements */
  apps: Record<string, {
    postgres: boolean;
    redis: boolean;
    s3: boolean;
    discovery: boolean;
    notifications: boolean;
    custom: string[];
  }>;
  /** Aggregated: does any app need postgres? */
  needsPostgres: boolean;
  /** Aggregated: does any app need redis? */
  needsRedis: boolean;
  /** Aggregated: does any app need S3? */
  needsS3: boolean;
}
