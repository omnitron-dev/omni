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

  streamLogs(data: {
    app?: string;
    level?: string | string[];
    search?: string;
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
