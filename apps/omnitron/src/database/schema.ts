/**
 * Omnitron Internal Database Schema
 *
 * Kysely type-safe schema for Omnitron's own PostgreSQL database (port 5480).
 * Stores logs, metrics, alerts, portal users, deployments, and cluster state.
 * Completely separate from app databases (main, storage, messaging, etc.).
 */

import type { Generated, ColumnType } from 'kysely';

// =============================================================================
// Common Column Types
// =============================================================================

type CreatedAt = ColumnType<Date, Date | undefined, never>;
type UpdatedAt = ColumnType<Date, Date | undefined, Date>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type JsonB<T = Record<string, unknown>> = ColumnType<T, string | T, string | T>;

// =============================================================================
// Database Interface
// =============================================================================

export interface OmnitronDatabase {
  /** Cluster nodes — leader/follower/worker topology */
  nodes: NodesTable;
  /** Portal users — Omnitron dashboard access */
  omnitron_users: OmnitronUsersTable;
  /** User sessions — JWT/token-based portal sessions */
  omnitron_sessions: OmnitronSessionsTable;
  /** Structured logs — partitioned by day in production */
  logs: LogsTable;
  /** Time-series metrics — CPU, memory, request rates, custom gauges */
  metrics_raw: MetricsRawTable;
  /** Alert rules — metric/log/health alert definitions */
  alert_rules: AlertRulesTable;
  /** Alert events — fired/resolved alert instances */
  alert_events: AlertEventsTable;
  /** Deployment history — app version rollouts */
  deployments: DeploymentsTable;
  /** Audit log — who did what when */
  omnitron_audit_log: OmnitronAuditLogTable;
  /** CI/CD pipeline definitions */
  pipelines: PipelinesTable;
  /** CI/CD pipeline execution runs */
  pipeline_runs: PipelineRunsTable;
  /** Distributed trace spans (OTLP-compatible) */
  traces: TracesTable;
  /** Sync WAL buffer — slave→master replication (slave-only) */
  sync_buffer: SyncBufferTable;
  /** Node health check history — written by health-monitor worker */
  node_health_checks: NodeHealthChecksTable;
}

// =============================================================================
// Nodes — Cluster Topology
// =============================================================================

export interface NodesTable {
  id: Generated<string>;
  hostname: string;
  address: string;
  port: number;
  role: string; // 'leader' | 'follower' | 'candidate' | 'database' | 'cache' | 'gateway' | 'worker'
  status: string; // 'online' | 'offline' | 'draining'
  lastHeartbeat: Timestamp | null;
  metadata: JsonB | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

// =============================================================================
// Portal Users — Dashboard Access
// =============================================================================

export interface OmnitronUsersTable {
  id: Generated<string>;
  username: string;
  passwordHash: string;
  displayName: string | null;
  role: string; // 'admin' | 'operator' | 'viewer'
  totpSecret: string | null;
  totpEnabled: ColumnType<boolean, boolean, boolean>;
  pgpPublicKey: string | null;
  pgpEnabled: ColumnType<boolean, boolean, boolean>;
  lastLoginAt: Timestamp | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

// =============================================================================
// Sessions — Portal Auth
// =============================================================================

export interface OmnitronSessionsTable {
  id: Generated<string>;
  userId: string;
  token: string;
  expiresAt: Timestamp;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: CreatedAt;
}

// =============================================================================
// Logs — Structured Log Storage
// =============================================================================

export interface LogsTable {
  id: Generated<string>;
  timestamp: Timestamp;
  nodeId: string | null;
  app: string;
  level: string; // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  message: string;
  labels: JsonB | null;
  traceId: string | null;
  spanId: string | null;
  metadata: JsonB | null;
}

// =============================================================================
// Metrics Raw — Time-Series Data
// =============================================================================

export interface MetricsRawTable {
  id: Generated<string>;
  timestamp: Timestamp;
  nodeId: string | null;
  app: string;
  name: string; // metric name: 'cpu', 'memory', 'rpc_requests', 'event_loop_lag', etc.
  value: number;
  labels: JsonB | null; // additional dimensions: { instance: '0', method: 'getUser' }
}

// =============================================================================
// Alert Rules — Alert Definitions
// =============================================================================

export interface AlertRulesTable {
  id: Generated<string>;
  name: string;
  expression: string;
  type: string; // 'metric' | 'log' | 'health'
  severity: string; // 'critical' | 'warning' | 'info'
  forDuration: number | null; // seconds before alert fires
  annotations: JsonB | null;
  labels: JsonB | null;
  enabled: ColumnType<boolean, boolean, boolean>;
  lastEvaluatedAt: Timestamp | null;
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

// =============================================================================
// Alert Events — Fired Alerts
// =============================================================================

export interface AlertEventsTable {
  id: Generated<string>;
  ruleId: string;
  status: string; // 'firing' | 'resolved' | 'silenced'
  value: string | null;
  annotations: JsonB | null;
  firedAt: Timestamp;
  resolvedAt: Timestamp | null;
  acknowledgedAt: Timestamp | null;
  acknowledgedBy: string | null;
}

// =============================================================================
// Deployments — Version Rollout History
// =============================================================================

export interface DeploymentsTable {
  id: Generated<string>;
  app: string;
  version: string;
  previousVersion: string | null;
  strategy: string; // 'rolling' | 'blue-green' | 'canary' | 'all-at-once'
  status: string; // 'pending' | 'deploying' | 'success' | 'failed' | 'rolled_back'
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  deployedBy: string | null;
  nodeId: string | null;
  metadata: JsonB | null;
}

// =============================================================================
// Audit Log — Administrative Actions
// =============================================================================

export interface OmnitronAuditLogTable {
  id: Generated<string>;
  action: string;
  actorId: string | null;
  actorType: string; // 'user' | 'system' | 'automation'
  resourceType: string;
  resourceId: string | null;
  details: JsonB | null;
  ipAddress: string | null;
  createdAt: CreatedAt;
}

// =============================================================================
// Pipelines — CI/CD Pipeline Definitions
// =============================================================================

export interface PipelinesTable {
  id: Generated<string>;
  name: string;
  description: string | null;
  steps: JsonB; // PipelineStep[]
  triggers: JsonB; // PipelineTrigger[]
  createdAt: CreatedAt;
  updatedAt: UpdatedAt;
}

// =============================================================================
// Pipeline Runs — Execution History
// =============================================================================

export interface PipelineRunsTable {
  id: Generated<string>;
  pipelineId: string;
  status: string; // 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  steps: JsonB; // PipelineRunStepResult[]
  startedAt: Timestamp;
  completedAt: Timestamp | null;
  triggeredBy: string;
  params: JsonB | null;
}

// =============================================================================
// Traces — Distributed Trace Spans (OTLP-compatible)
// =============================================================================

export interface TracesTable {
  id: Generated<string>;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operationName: string;
  serviceName: string;
  startTime: Timestamp;
  endTime: Timestamp;
  duration: number; // milliseconds
  status: string; // 'ok' | 'error'
  tags: JsonB;
  logs: JsonB | null;
}

// =============================================================================
// Sync Buffer — Slave→Master WAL (Write-Ahead Log)
// =============================================================================

export interface SyncBufferTable {
  id: Generated<string>;
  /** Data category: metrics, logs, events, alerts, traces, state */
  category: string;
  /** Serialized entry payload */
  payload: JsonB;
  /** When the entry was buffered locally */
  createdAt: CreatedAt;
  /** When the entry was successfully synced to master (null = pending) */
  syncedAt: Timestamp | null;
}

// =============================================================================
// Node Health Checks — Health Monitor Worker Results
// =============================================================================

export interface NodeHealthChecksTable {
  id: Generated<string>;
  nodeId: string;
  checkedAt: Timestamp;
  checkDurationMs: number;

  pingReachable: ColumnType<boolean, boolean, boolean>;
  pingLatencyMs: number | null;
  pingError: string | null;

  sshConnected: ColumnType<boolean, boolean, boolean>;
  sshLatencyMs: number | null;
  sshError: string | null;

  omnitronConnected: ColumnType<boolean, boolean, boolean>;
  omnitronVersion: string | null;
  omnitronPid: number | null;
  omnitronUptime: number | null;
  omnitronRole: string | null;
  omnitronError: string | null;

  os: JsonB<{ platform: string; arch: string; hostname: string; release: string }> | null;
}
