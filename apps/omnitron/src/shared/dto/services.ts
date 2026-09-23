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
  /** Secrets replaced — see `redactEnv`. */
  getEnv(data: { name: string }): Promise<Record<string, string>>;
  /** Clear values: admin only, audited as `app.env.reveal`. */
  revealEnv(data: { name: string }): Promise<Record<string, string>>;

  // --- Watch Mode ---
  enableWatch(data: { apps?: string[] }): Promise<{ watching: Array<{ name: string; directory: string }> }>;
  disableWatch(): Promise<{ success: boolean }>;
  getWatchStatus(): Promise<{ enabled: boolean; watching: boolean; reason?: string; apps: Array<{ name: string; directory: string }> }>;
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
import type { INode, INodeStatus, INodeWithStatus, AddNodeInput, UpdateNodeInput, SshKeyInfo, NodeCheckConfig, FleetHistoryConfig,
  IMeshNodeStatus, INodeIndicators, INodeSyncStatus, INodeRelayStats, INodeClusterState, INodeDaemonAnswer,
  INodeUpgradePlan, INodeRolloutStart,
} from './nodes.js';
import type { INodeHealthSummary } from '../../workers/types.js';
import type { MetricsSnapshot, MetricsQueryFilter, MetricsTimeSeries } from './metrics.js';

export type { MetricsSnapshot, MetricsQueryFilter, MetricsTimeSeries, MetricsAppSnapshot } from './metrics.js';
import type { HealthCheckRow, UptimeBucket } from '../../services/node-health.repository.js';

export type { INode, INodeStatus, INodeWithStatus, AddNodeInput, UpdateNodeInput, SshKeyInfo, NodeCheckConfig, FleetHistoryConfig, IMeshNodeStatus, INodeIndicators, INodeSyncStatus, INodeRelayStats, INodeClusterState, INodeDaemonAnswer, INodeUpgradePlan, INodeUpgradePlanRow, INodeRolloutStart } from './nodes.js';

/** Where a node's upgrade got to — see `NodeUpgradeService`. */
export type { NodeUpgradeProgress, UpgradePhase } from '../../services/node-upgrade.service.js';

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

import type { LogQueryResult, LogStats, LogEntryRow, LevelCount } from './logs.js';

export type { OmnitronSignInResult, OmnitronAuthUser, OmnitronActiveSession };
export type { LogQueryResult, LogStats, LogEntryRow, LevelCount };

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
  IProjectAppStatus,
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
  IProjectAppStatus,
  IStackInfraStatus,
  IProjectRequirements,
};

/**
 * One app's current state in a deployment, as the daemon last saw it.
 *
 * A remote deployment has phases that take minutes each — transferring the
 * artifact, installing its dependencies on the node, starting it, verifying
 * it — and every one of them was published to an event handler and to nobody
 * else. The console polls, so an event with nowhere to wait is an event the
 * console never sees: a quarter-hour deployment showed one row reading
 * `deploying` from start to finish, including the message naming the step
 * that failed.
 */
export interface DeployProgressRecord {
  /** `host:port` of the node. */
  node: string;
  app: string;
  status: 'pending' | 'transferring' | 'extracting' | 'installing' | 'restarting' | 'verifying' | 'success' | 'failed';
  /** 0–100. */
  progress: number;
  message: string;
  /** ISO 8601. */
  at: string;
}

export interface IProjectRpcService {
  // --- Projects (Viewer) ---
  listProjects(): Promise<IProjectInfo[]>;
  getProject(data: { name: string }): Promise<IProjectInfo>;
  getDeployProgress(): Promise<DeployProgressRecord[]>;
  scanRequirements(data: { project: string }): Promise<IProjectRequirements>;

  // --- Projects (Admin) ---
  addProject(data: { name: string; path: string }): Promise<IProjectInfo>;
  updateProject(data: { name: string; path?: string }): Promise<IProjectInfo>;
  removeProject(data: { name: string }): Promise<{ success: boolean }>;

  // --- Apps (Viewer) ---
  getProjectApps(data: { project: string }): Promise<IProjectAppStatus[]>;

  // --- Stacks (Viewer) ---
  listStacks(data: { project: string }): Promise<IStackInfo[]>;
  getStack(data: { project: string; stack: string }): Promise<IStackInfo>;
  getStackStatus(data: { project: string; stack: string }): Promise<StackRuntime>;

  // --- Stacks (Operator) ---
  startStack(data: { project: string; stack: string; allowDirty?: boolean; release?: string }): Promise<IStackInfo>;
  /** Would this stack take this release? The deployment's own decision, asked in advance. */
  checkRelease(data: { project: string; stack: string; release: string }): Promise<{ ok: boolean; because: string }>;
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
  /**
   * Bring up a stack's infrastructure on THIS node.
   *
   * The node executes; the master orchestrates. Refused by a daemon that
   * does not host one, rather than quietly doing nothing.
   */
  provisionStack(data: { config: import('../../infrastructure/types.js').InfrastructureConfig }): Promise<{
    ready: boolean;
    detail: string;
    running: string[];
    failed: Array<{ name: string; status: string; error: string | null }>;
    missing: string[];
  }>;
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
  /** Each schedule's last pass and next run, and which stacks this host backs up. */
  getBackupStatus(): Promise<import('../../services/backup.service.js').BackupStatus>;
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
/**
 * The audit trail — who changed this control plane and what they changed.
 *
 * Admin-only: the rows name people, resources and addresses.
 */
export interface IOmnitronAuditService {
  list(data?: import('../../services/audit.service.js').AuditQuery): Promise<
    import('../../services/audit.service.js').AuditRow[]
  >;
  available(): Promise<{ available: boolean }>;
}

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
  removeNode(data: { id: string }): Promise<void>;
  checkNodeStatus(data: { id: string }): Promise<INodeStatus>;
  /**
   * Whether each node is replicating, and how it is being reached.
   *
   * Separate from `checkNodeStatus`, which answers "can this master reach
   * it". A node can pass every reachability check and deliver nothing.
   */
  getMeshStatus(): Promise<IMeshNodeStatus[]>;
  /**
   * The node's OWN titan-health report, asked over the mesh.
   *
   * Not a second health mechanism: every omnitron daemon already answers
   * `Health@1.0.0`, and `SlaveConnector.invokeOnSlave` already reaches any
   * service on any node. This joins the two.
   */
  getNodeIndicators(data: { nodeId: string }): Promise<INodeIndicators>;
  /**
   * Whether the node's data is MOVING, asked over the mesh.
   *
   * `OmnitronSync.getSyncStatus` has answered this since it was written — its
   * docblock says "for webapp monitoring" — and the console never knew the
   * service existed.
   */
  getNodeSyncStatus(data: { nodeId: string }): Promise<INodeSyncStatus>;
  /**
   * The node's telemetry relay, asked over the mesh — including the only
   * counter in the fleet that reports LOSS.
   */
  getNodeRelayStats(data: { nodeId: string }): Promise<INodeRelayStats>;
  /** Which node this node believes is the leader — a split brain is only visible across nodes. */
  getNodeClusterState(data: { nodeId: string }): Promise<INodeClusterState>;
  /**
   * What the node's own daemon says it is running, asked over the mesh.
   *
   * The fleet commands dial `host:9700` themselves, which a hardened node
   * does not answer — that is the reason the mesh tunnels over SSH. These
   * three put the same questions through the connection that works.
   */
  getNodeDaemonStatus(data: { nodeId: string }): Promise<INodeDaemonAnswer<DaemonStatusDto>>;
  getNodeDaemonHealth(data: { nodeId: string }): Promise<INodeDaemonAnswer<AggregatedHealthDto>>;
  getNodeDaemonMetrics(data: { nodeId: string }): Promise<INodeDaemonAnswer<AggregatedMetricsDto>>;
  /**
   * Upgrade a node's omnitron to the one this daemon is built from — the
   * same thing `fleet upgrade` does, startable from the console.
   *
   * Started and polled: a build is minutes.
   */
  upgradeNode(data: { nodeId: string }): Promise<{ started: boolean; reason?: string }>;
  getUpgradeProgress(): Promise<import('../../services/node-upgrade.service.js').NodeUpgradeProgress[]>;

  // ---------------------------------------------------------------------------
  // Fleet rollout — many nodes, from the console
  //
  // The queue lives in the DAEMON, not in the browser. A rollout across a
  // dozen servers outlives the tab that started it, and a page that closes
  // must not be able to leave half a fleet on one version and half on
  // another. So the console asks for a rollout and then watches one.
  // ---------------------------------------------------------------------------

  /**
   * What a rollout WOULD do, without doing any of it.
   *
   * The plan is the `--dry-run` of `fleet upgrade`, which builds a bundle to
   * learn the target version and then decides per node. Costly enough to be
   * worth showing, and cheap compared with finding out afterwards.
   *
   * `nodeIds` narrows it; absent means the whole registry.
   */
  planUpgrade(data?: { nodeIds?: string[] }): Promise<INodeUpgradePlan>;

  /**
   * Queue a rollout and return immediately.
   *
   * `concurrency` is how many nodes are touched at once; the rest wait in
   * `queued` with a position. Default 1, because an upgrade restarts the
   * daemon it lands on and a fleet that restarts together has no witness
   * left.
   *
   * What is refused here is refused BEFORE anything ships — an unknown node,
   * one already running, one held by another deployment's lease — and each
   * refusal carries its reason so the console can show it beside the node
   * rather than as a count.
   */
  upgradeNodes(data: { nodeIds: string[]; concurrency?: number }): Promise<INodeRolloutStart>;

  /**
   * Take a node out of a running rollout.
   *
   * Honest about what it can do: a node still `queued` is dropped, and one
   * already installing is NOT interrupted — stopping an upgrade between
   * `installBundle` and `activateBundle` is how a node ends up with a
   * half-switched `current`. `stopped: false` with the reason is the answer
   * in that case.
   */
  cancelUpgrade(data: { nodeId: string }): Promise<{ stopped: boolean; because: string }>;
  checkAllNodes(): Promise<INodeStatus[]>;
  getCheckHistory(data: { nodeId: string; limit?: number }): Promise<HealthCheckRow[]>;
  getUptimeBar(data: { nodeId: string; bucketCount?: number; intervalMs?: number }): Promise<UptimeBucket[]>;
  getNodeHealthSummaries(): Promise<INodeHealthSummary[]>;
  triggerNodeCheck(data: { nodeId?: string }): Promise<INodeHealthSummary[]>;
  listSshKeys(): SshKeyInfo[];
  getCheckConfig(): NodeCheckConfig;
  setCheckConfig(data: Partial<NodeCheckConfig>): NodeCheckConfig;
  getHistoryConfig(): FleetHistoryConfig;
  /**
   * Install a locally built omnitron bundle on a node, beside the version it
   * is running. Does not change what the node serves.
   *
   * `archivePath` is a path on the DAEMON's filesystem — the CLI builds the
   * bundle and the daemon ships it, because the node's SSH credentials live
   * in the daemon's vault and must not travel to a caller.
   */
  installBundleOnNode(data: { nodeId: string; archivePath: string; version: string }): Promise<boolean>;
  /** Make an installed version current and restart the node's daemon into it. */
  activateBundleOnNode(data: { nodeId: string; version: string; keepVersions?: number }): Promise<boolean>;
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

// ============================================================================
// Release Service Interface
// ============================================================================

export type {
  ReleaseSummary,
  ReleaseDetail,
  PruneResult,
} from '../../release/store.js';
export type { ReleaseManifest, GateOutcome, ReleaseArtifact, StackReleaseRequirements } from '../../release/manifest.js';
export type { BuildRecord, BuildRequest } from '../../services/release.service.js';
export type { StoredAttestation } from '../../release/attest.js';

/** Whether this master can build a release, and where they are kept. */
export interface ReleasePreflightDto {
  readonly root: string;
  readonly canBuild: boolean;
  /** `git`, `pnpm`, `node` — those not on the daemon's PATH. */
  readonly missingTools: string[];
  readonly path: string[];
  /** The machine's 1, 5 and 15-minute load averages right now. */
  readonly load: [number, number, number];
  readonly cpus: number;
}

/** The last recorded deployment of one stack. */
export interface ReleaseDeploymentDto {
  readonly project: string;
  readonly stack: string;
  readonly at: string;
  readonly actorId: string | null;
  /** `operator`, `boot`, `auto-resume` — who asked for that start. */
  readonly source: string | null;
  /** The release deployed, or `null` when the working tree was — or when the row cannot say. */
  readonly release: string | null;
  /**
   * True when the row recorded a release and cannot name it.
   *
   * Rows written before the audit trail learned to flatten this field hold
   * the literal `[object]`. «A release, name not recorded» and «the working
   * tree» are different facts, and a console that showed the second for the
   * first would be inventing a deployment nobody made.
   */
  readonly releaseUnnamed: boolean;
  readonly projectCommit: string | null;
  readonly omniCommit: string | null;
}

/**
 * What `OmnitronRelease.prune` answers: the store's result, plus what the
 * daemon protected on its own and, when it could not tell, why.
 */
export type ReleasePruneAnswer = import('../../release/store.js').PruneResult & {
  /** Releases a stack runs, by the daemon's audit trail — never removed. */
  readonly protectedByDeployment: readonly string[];
  /** Why the daemon cannot say which releases the stacks run; `null` when it can. */
  readonly unknown: string | null;
};

/**
 * Releases: what was built on this master, and the builds themselves.
 *
 * A build takes a quarter of an hour, so `build` starts one and returns its
 * record; the console follows it with `getBuild`. Everything that reads is a
 * viewer's, starting and stopping is an operator's, and `prune` — the only
 * call that deletes — is an administrator's.
 */
export interface IOmnitronReleaseService {
  preflight(): Promise<ReleasePreflightDto>;
  list(): Promise<{ releases: import('../../release/store.js').ReleaseSummary[]; root: string }>;
  get(data: { id: string }): Promise<import('../../release/store.js').ReleaseDetail>;
  getLog(data: { id: string; name: string; lines?: number }): Promise<{ name: string; bytes: number; tail: string }>;
  builds(): Promise<import('../../services/release.service.js').BuildRecord[]>;
  getBuild(data: { buildId: string }): Promise<import('../../services/release.service.js').BuildRecord | null>;
  build(data: {
    project: string;
    projectCommit?: string;
    omniCommit?: string;
    forStack?: string;
    skipGates?: boolean;
    keepSource?: boolean;
    env?: Record<string, string>;
  }): Promise<import('../../services/release.service.js').BuildRecord>;
  stopBuild(data: { buildId: string }): Promise<import('../../services/release.service.js').BuildRecord>;
  prune(data: { keep?: number; apply?: boolean; protect?: string[]; allowUnprotected?: boolean }): Promise<ReleasePruneAnswer>;
  deployments(data?: { limit?: number }): Promise<ReleaseDeploymentDto[]>;
  /** Take what a stack measured about this release, or refuse it by name. */
  attest(data: { release: string; stack: string; stdout: string }): Promise<{ path: string; gates: number; passed: number }>;
  /** Run this release's probes on the stack's node, over the master's transport, and keep what should be kept. */
  attestOnNode(data: { release: string; stack: string }): Promise<{
    path: string;
    gates: number;
    passed: number;
    node: string;
    scriptsFrom: 'release' | 'history';
    /** Application source files staged beside the probes; 0 when the commit has none. */
    sourceFiles: number;
    /** Where the probes' accounts came from — see `AttestAccounts` in project.service. */
    accounts: 'provisioned' | 'not-declared' | 'producer-cannot';
  }>;
}
