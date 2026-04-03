/**
 * Health Monitor Worker — Shared Types
 *
 * Types shared between the health-monitor worker process and the daemon master.
 * All types are serializable (no class instances, functions, or symbols).
 */

// =============================================================================
// Health Check Result (PG row shape + IPC payload)
// =============================================================================

export interface IHealthCheckResult {
  nodeId: string;
  checkedAt: string;
  checkDurationMs: number;

  pingReachable: boolean;
  pingLatencyMs: number | null;
  pingError: string | null;

  sshConnected: boolean;
  sshLatencyMs: number | null;
  sshError: string | null;

  omnitronConnected: boolean;
  omnitronVersion: string | null;
  omnitronPid: number | null;
  omnitronUptime: number | null;
  omnitronRole: string | null;
  omnitronError: string | null;

  os: { platform: string; arch: string; hostname: string; release: string } | null;
}

// =============================================================================
// Node Check Target (master → worker, serializable)
// =============================================================================

export interface INodeCheckTarget {
  id: string;
  name: string;
  host: string;
  sshPort: number;
  sshUser: string;
  sshAuthMethod: 'password' | 'key';
  sshPrivateKey?: string;
  sshPassphrase?: string;
  runtime: 'node' | 'bun';
  daemonPort: number;
  isLocal: boolean;
  offlineTimeout: number | null;
}

// =============================================================================
// Health Monitor Config
// =============================================================================

export interface IHealthMonitorConfig {
  /** Check interval in ms (default: 30_000) */
  intervalMs: number;
  /** Max concurrent node checks (default: 20) */
  concurrency: number;
  /** Offline timeout in ms — node considered offline after this (default: 90_000) */
  offlineTimeoutMs: number;
  /** Ping timeout per node (ms) */
  pingTimeout: number;
  /** SSH timeout per node (ms) */
  sshTimeout: number;
  /** Omnitron check timeout per node (ms) */
  omnitronCheckTimeout: number;
  /** Whether ping is enabled */
  pingEnabled: boolean;
  /** PG connection URL for writing check history */
  dbUrl: string;
  /** Retention in days for check history (default: 7) */
  retentionDays: number;
}

// =============================================================================
// Node Health Summary (aggregated status)
// =============================================================================

export type NodeHealthStatus = 'online' | 'degraded' | 'offline' | 'unknown';

export interface INodeHealthSummary {
  nodeId: string;
  status: NodeHealthStatus;
  lastCheck: IHealthCheckResult | null;
  lastSeenOnline: string | null;
  consecutiveFailures: number;
}

// =============================================================================
// IPC Messages (worker → master)
// =============================================================================

export interface IHealthStatusBatchMessage {
  type: 'health:status_batch';
  summaries: INodeHealthSummary[];
}

export interface IHealthWorkerReadyMessage {
  type: 'health:ready';
}

export type HealthWorkerMessage = IHealthStatusBatchMessage | IHealthWorkerReadyMessage;
