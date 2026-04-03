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
  stopApp(data: { name: string; force?: boolean; timeout?: number }): Promise<{ success: boolean }>;
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

import type {
  OmnitronSignInResult,
  OmnitronAuthUser,
  OmnitronActiveSession,
} from '../../services/auth.service.js';

import type {
  LogQueryResult,
  LogStats,
  LogEntryRow,
} from '../../services/log-collector.service.js';

export type { OmnitronSignInResult, OmnitronAuthUser, OmnitronActiveSession };
export type { LogQueryResult, LogStats, LogEntryRow };

export interface IOmnitronAuthService {
  signIn(data: {
    username: string;
    password: string;
    ipAddress?: string;
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
