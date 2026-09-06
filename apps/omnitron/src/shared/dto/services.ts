/**
 * Omnitron Daemon RPC Service Interfaces
 *
 * Defines the contract between CLI client and daemon server.
 */

import type {
  ProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
} from '../../config/types.js';

export type {
  ProcessInfoDto,
  DaemonStatusDto,
  AggregatedMetricsDto,
  AggregatedHealthDto,
  LogEntryDto,
  AppDiagnosticsDto,
};
export type { AppStatus, SubProcessInfoDto } from '../../config/types.js';

// ============================================================================
// Daemon Service Interface
// ============================================================================

export interface IDaemonService {
  // --- Process Management ---
  startApp(data: { name: string }): Promise<ProcessInfoDto>;
  startAll(): Promise<ProcessInfoDto[]>;
  stopApp(data: { name: string; force?: boolean; timeout?: number }): Promise<{ success: boolean; error?: string }>;
  stopAll(data: { force?: boolean }): Promise<{ count: number }>;
  restartApp(data: { name: string }): Promise<ProcessInfoDto>;
  restartAll(): Promise<ProcessInfoDto[]>;
  reloadApp(data: { name: string }): Promise<ProcessInfoDto>;

  // --- Information ---
  list(): Promise<ProcessInfoDto[]>;
  getApp(data: { name: string }): Promise<ProcessInfoDto>;
  status(): Promise<DaemonStatusDto>;

  // --- Monitoring ---
  getMetrics(data: { name?: string }): Promise<AggregatedMetricsDto>;
  getHealth(data: { name?: string }): Promise<AggregatedHealthDto>;
  getLogs(data: { name?: string; lines?: number }): Promise<LogEntryDto[]>;

  // --- Scaling ---
  scale(data: { name: string; instances: number }): Promise<ProcessInfoDto>;

  // --- Lifecycle ---
  ping(): Promise<{ uptime: number; version: string; pid: number }>;
  shutdown(data: { force?: boolean }): Promise<{ success: boolean }>;
  reloadConfig(): Promise<{ success: boolean }>;
  setMetricsEnabled(data: { name?: string; enabled: boolean }): Promise<{ success: boolean }>;

  // --- Diagnostics ---
  inspect(data: { name: string }): Promise<AppDiagnosticsDto>;
  /**
   * Live DI dependency graph for the app — used by
   * `omnitron inspect <app> --graph`. Returns null if the app
   * isn't running or doesn't expose `getDependencyGraph` (legacy
   * bootstrap workers).
   */
  getDependencyGraph(data: { name: string }): Promise<{
    nodes: Array<{ id: string; label?: string; type?: string }>;
    edges: Array<{ from: string; to: string; type?: 'dependency' | 'parent' }>;
  } | null>;
  exec(data: { name: string; service: string; method: string; args: unknown[] }): Promise<unknown>;
  getEnv(data: { name: string }): Promise<Record<string, string>>;

  // --- Watch Mode ---
  enableWatch(data: { apps?: string[] }): Promise<{ watching: Array<{ name: string; directory: string }> }>;
  disableWatch(): Promise<{ success: boolean }>;
  getWatchStatus(): Promise<{ enabled: boolean; apps: Array<{ name: string; directory: string }> }>;
}

// ============================================================================
// Auth Service Interface (OmnitronAuth)
// ============================================================================

import type { OmnitronSignInResult, OmnitronAuthUser, OmnitronActiveSession } from './auth.js';
import type { AlertRule, AlertEvent, AlertSummary, ActiveAlert, CreateAlertRuleInput } from './alerts.js';
import type { DeployResult, DeploymentRecord } from './deploy.js';
import type { ContainerState, InfrastructureState } from '../../infrastructure/types.js';
import type { FleetNode, FleetSummary, NodeRegistration, NodeRole } from './fleet.js';
import type { Pipeline, PipelineDef, PipelineRun } from './pipelines.js';
import type { Trace, TraceSpan, TraceFilter, ServiceMapEntry } from './traces.js';
import type { SystemSnapshot } from './system-info.js';
import type { BackupInfo } from './backups.js';
import type { K8sPod, K8sDeployment, K8sService } from './kubernetes.js';
import type { HealthReport, PlatformHealthReport } from './health.js';
import type { OmnitronDiscoveredTarget, DiscoveryScanResult } from './discovery.js';
import type { INode, INodeStatus, INodeWithStatus, AddNodeInput, UpdateNodeInput, SshKeyInfo } from './nodes.js';
import type { INodeHealthSummary } from '../../workers/types.js';
import type { MetricsSnapshot, MetricsQueryFilter, MetricsTimeSeries } from './metrics.js';

export type { MetricsSnapshot, MetricsQueryFilter, MetricsTimeSeries, MetricsAppSnapshot } from './metrics.js';
import type { HealthCheckRow, UptimeBucket } from '../../services/node-health.repository.js';

export type { INode, INodeStatus, INodeWithStatus, AddNodeInput, UpdateNodeInput, SshKeyInfo } from './nodes.js';

export type { BackupInfo } from './backups.js';
export type { K8sPod, K8sDeployment, K8sService } from './kubernetes.js';
export type { HealthCheckResult, HealthReport, PlatformHealthReport } from './health.js';
export type { OmnitronDiscoveredTarget, DiscoveryScanResult } from './discovery.js';

export type { Pipeline, PipelineDef, PipelineStep, PipelineRun, PipelineRunStepResult } from './pipelines.js';
export type { Trace, TraceSpan, TraceFilter, ServiceMapEntry } from './traces.js';
export type { SystemSnapshot } from './system-info.js';

export type { FleetNode, FleetSummary, NodeRegistration, NodeRole };
export type { NodeStatus } from './fleet.js';

export type { ContainerState, InfrastructureState };

export type { DeployResult, DeploymentRecord };

export type { AlertRule, AlertEvent, AlertSummary, ActiveAlert, CreateAlertRuleInput };
export type { AlertSeverity, AlertRuleType, AlertEventStatus } from './alerts.js';

import type { LogQueryResult, LogStats, LogEntryRow } from './logs.js';

export type { OmnitronSignInResult, OmnitronAuthUser, OmnitronActiveSession };
export type { LogQueryResult, LogStats, LogEntryRow };

export interface IOmnitronAuthService {
  signIn(data: {
    username: string;
    password: string;
    userAgent?: string;
  }): Promise<OmnitronSignInResult>;

  validateToken(data: { token: string }): Promise<{
    valid: boolean;
    userId?: string;
    sessionId?: string;
  }>;

  signOut(data: { sessionId: string }): Promise<{ success: boolean }>;

  validateSession(data: { sessionId: string }): Promise<{
    valid: boolean;
    user?: OmnitronAuthUser;
    /**
     * Session expiry, when the session exists. The implementation has always
     * returned it — the console reads it to schedule a refresh — but the
     * contract omitted it, so that read was unchecked.
     */
    session?: { expiresAt: string };
  }>;

  /** Auth context derived from JWT — no token param needed */
  getActiveSessions(): Promise<OmnitronActiveSession[]>;

  refreshSession(data: { sessionId: string }): Promise<{
    success: boolean;
    result?: OmnitronSignInResult;
  }>;

  /** Auth context derived from JWT — no userId/token param needed */
  changePassword(data: {
    oldPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean }>;
}

// ============================================================================
// Logs Service Interface (OmnitronLogs)
// ============================================================================

export interface IOmnitronLogsService {
  queryLogs(data: {
    app?: string;
    level?: string | string[];
    search?: string;
    labels?: Record<string, string>;
    traceId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<LogQueryResult>;

  getLogStats(): Promise<LogStats>;

  /** In-memory ingestion counters — no database work, safe to poll. */
  getIngestionStats(): Promise<{ ingestedTotal: number; droppedTotal: number; bufferSize: number }>;

  streamLogs(data: {
    app?: string;
    level?: string | string[];
    search?: string;
    nodeId?: string;
    labels?: Record<string, string>;
    tail?: number;
    since?: string;
  }): Promise<LogEntryRow[]>;
}

// ============================================================================
// Infrastructure Service Interface
// ============================================================================

export interface ServerInfoDto {
  alias: string;
  host: string;
  port: number;
  tags: string[];
  status: 'online' | 'offline' | 'unknown';
  lastSeen: number;
}

export interface FleetStatusDto {
  servers: ServerInfoDto[];
  totalApps: number;
  healthyApps: number;
}

export interface IInfraService {
  addServer(data: { alias: string; host: string; port?: number; tags?: string[] }): Promise<ServerInfoDto>;
  removeServer(data: { alias: string }): Promise<{ success: boolean }>;
  listServers(): Promise<ServerInfoDto[]>;
  getServer(data: { alias: string }): Promise<ServerInfoDto>;
  fleetStatus(): Promise<FleetStatusDto>;
}

// ============================================================================
// Project Service Interface (OmnitronProject)
// ============================================================================

import type {
  IProjectInfo,
  IStackInfo,
  IStackNodeStatus,
  ISyncStatus,
  StackRuntime,
  StackStatus,
  IStackAppStatus,
  IStackInfraStatus,
  IProjectRequirements,
} from './project.js';

export type {
  IProjectInfo,
  IStackInfo,
  IStackNodeStatus,
  ISyncStatus,
  StackRuntime,
  StackStatus,
  IStackAppStatus,
  IStackInfraStatus,
  IProjectRequirements,
};

export interface IProjectRpcService {
  // --- Projects (Viewer) ---
  listProjects(): Promise<IProjectInfo[]>;
  getProject(data: { name: string }): Promise<IProjectInfo>;
  scanRequirements(data: { project: string }): Promise<IProjectRequirements>;

  // --- Projects (Admin) ---
  addProject(data: { name: string; path: string }): Promise<IProjectInfo>;
  updateProject(data: { name: string; path?: string }): Promise<IProjectInfo>;
  removeProject(data: { name: string }): Promise<{ success: boolean }>;

  // --- Apps (Viewer) ---
  getProjectApps(data: { project: string }): Promise<IStackAppStatus[]>;

  // --- Stacks (Viewer) ---
  listStacks(data: { project: string }): Promise<IStackInfo[]>;
  getStack(data: { project: string; stack: string }): Promise<IStackInfo>;
  getStackStatus(data: { project: string; stack: string }): Promise<StackRuntime>;

  // --- Stacks (Operator) ---
  startStack(data: { project: string; stack: string }): Promise<IStackInfo>;
  stopStack(data: { project: string; stack: string }): Promise<IStackInfo>;

  // --- Stacks (Admin) ---
  createStack(data: {
    project: string;
    name: string;
    type: 'local' | 'remote' | 'cluster';
    apps: string[] | 'all';
    nodeIds?: string[];  // for remote (1 node) and cluster (multiple nodes)
  }): Promise<IStackInfo>;

  deleteStack(data: { project: string; stack: string }): Promise<{ success: boolean }>;
}

// ============================================================================
// Alerts Service Interface
// ============================================================================

/**
 * Alert rule and event management.
 *
 * The console used to reach this service through
 * `Record<string, (...args: any[]) => any>`, so nothing checked that the
 * calls existed. They did not: the alerts page called `listRules()` and
 * `listActiveAlerts()` (neither exists anywhere in the codebase) and passed
 * positional arguments to `updateRule` / `deleteRule` / `acknowledgeAlert`,
 * which take a single object. Every request 404'd — reproduced in the
 * browser before this interface was introduced.
 */
export interface IOmnitronAlertsService {
  getRules(): Promise<AlertRule[]>;
  createRule(data: CreateAlertRuleInput): Promise<AlertRule>;
  updateRule(data: { id: string; updates: Partial<AlertRule> }): Promise<AlertRule>;
  deleteRule(data: { id: string }): Promise<{ success: boolean }>;
  getEvents(data?: { ruleId?: string; status?: string; limit?: number }): Promise<AlertEvent[]>;
  getActiveAlerts(data?: { limit?: number }): Promise<ActiveAlert[]>;
  acknowledgeAlert(data: { alertId: string; acknowledgedBy: string }): Promise<{ success: boolean }>;
  getSummary(): Promise<AlertSummary>;
}

// ============================================================================
// Deploy Service Interface
// ============================================================================

/**
 * Application deployment, rollback and history.
 *
 * Another contract the console reached through `Record<string, any>`: the
 * deployments page called `listDeployments()` and `listDeployableApps()`
 * (the first is named `getHistory` here, the second did not exist) and
 * `deploy()` (named `deployApp`). All three 404'd.
 */
export interface IOmnitronDeployService {
  deployApp(data: { app: string; version: string; strategy?: string; deployedBy?: string }): Promise<DeployResult>;
  rollback(data: { app: string; deployedBy?: string }): Promise<DeployResult>;
  getHistory(data?: { app?: string; limit?: number }): Promise<DeploymentRecord[]>;
  listDeployableApps(): Promise<string[]>;
}

// ============================================================================
// Infrastructure Service Interface
// ============================================================================

/**
 * Managed infrastructure containers.
 *
 * `ContainerState` / `InfrastructureState` come from the infrastructure
 * module's own type file, which is types-only — no decorators, safe for the
 * console's build.
 */
export interface IOmnitronInfraService {
  getState(): Promise<InfrastructureState | null>;
  listContainers(): Promise<ContainerState[]>;
  getConnectionInfo(data: { service: string }): Promise<Record<string, unknown> | null>;
  startContainer(data: { name: string }): Promise<{ success: boolean }>;
  stopContainer(data: { name: string; timeout?: number }): Promise<{ success: boolean }>;
  removeContainer(data: { name: string }): Promise<{ success: boolean }>;
  getContainerLogs(data: { name: string; tail?: number }): Promise<{ logs: string }>;
}

// ============================================================================
// Fleet Service Interface
// ============================================================================

/** Remote node registration and fleet topology. */
export interface IOmnitronFleetService {
  listNodes(): Promise<FleetNode[]>;
  getSummary(): Promise<FleetSummary>;
  registerNode(data: NodeRegistration): Promise<FleetNode>;
  removeNode(data: { nodeId: string }): Promise<{ success: boolean }>;
  getNode(data: { nodeId: string }): Promise<FleetNode | null>;
  setRole(data: { nodeId: string; role: NodeRole }): Promise<FleetNode>;
  drainNode(data: { nodeId: string }): Promise<{ success: boolean }>;
  heartbeat(data: { nodeId: string }): Promise<{ ok: boolean }>;
}

// ============================================================================
// Pipelines / Traces / System Info Service Interfaces
// ============================================================================

/** CI/CD pipeline definitions and runs. */
export interface IOmnitronPipelinesService {
  createPipeline(data: PipelineDef): Promise<Pipeline>;
  getPipeline(data: { id: string }): Promise<Pipeline | null>;
  listPipelines(): Promise<Pipeline[]>;
  deletePipeline(data: { id: string }): Promise<{ success: boolean }>;
  executePipeline(data: { id: string; params?: Record<string, unknown> }): Promise<PipelineRun>;
  cancelRun(data: { runId: string }): Promise<{ success: boolean }>;
  getRunStatus(data: { runId: string }): Promise<PipelineRun | null>;
  listRuns(data?: { pipelineId?: string; limit?: number }): Promise<PipelineRun[]>;
}

/** Distributed trace ingestion and query. */
export interface IOmnitronTracesService {
  ingestSpan(data: TraceSpan): Promise<{ success: boolean }>;
  ingestBatch(data: { spans: TraceSpan[] }): Promise<{ success: boolean }>;
  getTrace(data: { traceId: string }): Promise<Trace | null>;
  queryTraces(data: TraceFilter): Promise<Trace[]>;
  getServiceMap(): Promise<ServiceMapEntry[]>;
}

/** Host snapshot: OS, CPU, memory, disks, network, daemon runtime. */
export interface IOmnitronSystemInfoService {
  getSnapshot(): Promise<SystemSnapshot>;
}

// ============================================================================
// Backups / Kubernetes / Health / Discovery / Secrets
// ============================================================================
//
// These four were the last services the console could only reach as
// `Record<string, (...args: any[]) => any>`. None of them is called from the
// UI yet — which is exactly why the contract is worth writing down now,
// while nothing has had a chance to drift against it.

/** Database and volume backups, plus their schedules. */
export interface IOmnitronBackupsService {
  createBackup(data: { database: string; compress?: boolean }): Promise<BackupInfo>;
  createAllBackups(): Promise<Array<{ database: string; ok: boolean; id?: string; size?: number; error?: string }>>;
  createFullBackup(): Promise<Array<{ target: string; ok: boolean; id?: string; size?: number; error?: string }>>;
  listBackups(data?: { database?: string }): Promise<BackupInfo[]>;
  restoreBackup(data: { backupId: string }): Promise<{ success: boolean }>;
  deleteBackup(data: { backupId: string }): Promise<{ success: boolean }>;
  setSchedule(data: { database: string; cron: string }): Promise<{ success: boolean }>;
  getSchedule(data: { database: string }): Promise<string | null>;
  listSchedules(): Promise<Record<string, string>>;
  removeSchedule(data: { database: string }): Promise<{ success: boolean }>;
}

/** Kubernetes workloads on the cluster this daemon is pointed at. */
export interface IOmnitronKubernetesService {
  listPods(data?: { namespace?: string; labelSelector?: string }): Promise<K8sPod[]>;
  getPod(data: { name: string; namespace?: string }): Promise<K8sPod | null>;
  deletePod(data: { name: string; namespace?: string }): Promise<{ success: boolean }>;
  getPodLogs(data: { name: string; namespace?: string; tail?: number }): Promise<string>;
  listDeployments(data?: { namespace?: string }): Promise<K8sDeployment[]>;
  scaleDeployment(data: { name: string; replicas: number; namespace?: string }): Promise<{ success: boolean }>;
  restartDeployment(data: { name: string; namespace?: string }): Promise<{ success: boolean }>;
  listServices(data?: { namespace?: string }): Promise<K8sService[]>;
  execInPod(data: { pod: string; command: string[]; namespace?: string }): Promise<string>;
}

/** Application and infrastructure health probes. */
export interface IOmnitronHealthService {
  checkApp(data: { appName: string; port?: number }): Promise<HealthReport>;
  checkApps(): Promise<HealthReport>;
  checkInfrastructure(): Promise<HealthReport>;
  checkAll(): Promise<PlatformHealthReport>;
}

/** Scanning for containers and nodes this daemon could adopt. */
export interface IOmnitronDiscoveryService {
  discoverContainers(): Promise<OmnitronDiscoveredTarget[]>;
  discoverNodes(data: { hosts: string[] }): Promise<OmnitronDiscoveredTarget[]>;
  scanAll(): Promise<DiscoveryScanResult>;
}

/** Encrypted secret storage. */
export interface IOmnitronSecretsService {
  get(data: { key: string }): Promise<{ key: string; value: string | null }>;
  set(data: { key: string; value: string }): Promise<{ success: boolean }>;
  delete(data: { key: string }): Promise<{ success: boolean; existed: boolean }>;
  list(): Promise<{ keys: string[] }>;
}

/**
 * Fleet node inventory and health history.
 *
 * The setter methods the RPC class also exposes (`setHealthWorkerProxy`,
 * `setHealthRepository`) are wiring, not contract — they take server-side
 * objects and are deliberately absent here.
 */
export interface IOmnitronNodesService {
  listNodes(): INodeWithStatus[];
  getNode(data: { id: string }): INodeWithStatus | null;
  addNode(data: AddNodeInput): Promise<INode>;
  updateNode(data: { id: string } & UpdateNodeInput): Promise<INode>;
  removeNode(data: { id: string }): void;
  checkNodeStatus(data: { id: string }): Promise<INodeStatus>;
  checkAllNodes(): Promise<INodeStatus[]>;
  getCheckHistory(data: { nodeId: string; limit?: number }): Promise<HealthCheckRow[]>;
  getUptimeBar(data: { nodeId: string; bucketCount?: number; intervalMs?: number }): Promise<UptimeBucket[]>;
  getNodeHealthSummaries(): Promise<INodeHealthSummary[]>;
  triggerNodeCheck(data: { nodeId?: string }): Promise<INodeHealthSummary[]>;
  listSshKeys(): SshKeyInfo[];
}

/**
 * Metrics snapshots and time series.
 *
 * `OmnitronMetrics` is implemented by `MetricsRpcService` in
 * `@omnitron-dev/titan-metrics`, so the `implements` half of this contract
 * lives in that package. Declared here so the console is type-checked against
 * it rather than reaching for `any` — the dashboard and the metrics page are
 * its only callers.
 */
export interface IOmnitronMetricsService {
  getSnapshot(): Promise<MetricsSnapshot>;
  querySeries(data: MetricsQueryFilter): Promise<MetricsTimeSeries[]>;
  getPrometheusText(): Promise<string>;
}
