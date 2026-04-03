/**
 * Netron Client — Omnitron Console RPC
 *
 * Uses typed Proxy access pattern from netron-browser:
 *   daemonClient.daemon.OmnitronAuth.signIn({ username, password })
 *
 * Same architecture as @apps/portal but with single 'daemon' backend.
 */

import {
  createMultiBackendClient,
  AuthenticationClient,
  SessionTokenStorage,
  type BackendSchema,
} from '@omnitron-dev/prism/netron';

import type {
  IDaemonService,
  IOmnitronAuthService,
  IOmnitronLogsService,
  IProjectRpcService,
} from '@omnitron-dev/omnitron/dto/services';

// =============================================================================
// Backend Schema — typed service map
// =============================================================================

export interface OmnitronConsoleSchema extends BackendSchema {
  daemon: {
    OmnitronDaemon: IDaemonService;
    OmnitronAuth: IOmnitronAuthService;
    OmnitronLogs: IOmnitronLogsService;
    OmnitronFleet: Record<string, (...args: any[]) => any>;
    OmnitronAlerts: Record<string, (...args: any[]) => any>;
    OmnitronMetrics: Record<string, (...args: any[]) => any>;
    OmnitronInfra: Record<string, (...args: any[]) => any>;
    OmnitronDeploy: Record<string, (...args: any[]) => any>;
    OmnitronPipelines: Record<string, (...args: any[]) => any>;
    OmnitronTraces: Record<string, (...args: any[]) => any>;
    OmnitronBackups: Record<string, (...args: any[]) => any>;
    OmnitronKubernetes: Record<string, (...args: any[]) => any>;
    OmnitronHealth: Record<string, (...args: any[]) => any>;
    OmnitronDiscovery: Record<string, (...args: any[]) => any>;
    OmnitronSecrets: Record<string, (...args: any[]) => any>;
    OmnitronProject: IProjectRpcService;
    OmnitronSystemInfo: { getSnapshot: () => Promise<any> };
    OmnitronNodes: Record<string, (...args: any[]) => any>;
  };
}

// =============================================================================
// Auth Client
// =============================================================================

const ACCESS_TOKEN_KEY = 'omnitron_token';

const jwtAuth = new AuthenticationClient({
  storage: new SessionTokenStorage(ACCESS_TOKEN_KEY),
  storageKey: ACCESS_TOKEN_KEY,
  autoRefresh: false,
  autoAttach: true,
  crossTabSync: { enabled: false },
  inactivityConfig: { timeout: 0 },
});

// =============================================================================
// Client Singleton
// =============================================================================

export const daemonClient = createMultiBackendClient<OmnitronConsoleSchema>({
  baseUrl: '',
  backends: {
    daemon: { path: '', auth: jwtAuth },
  },
  defaultBackend: 'daemon',
});

// =============================================================================
// Typed Service Proxies — call methods directly
//
// Usage:
//   import { auth, daemon, logs } from 'src/netron/client';
//   await auth.signIn({ username: 'admin', password: 'admin' });
//   await daemon.list();
//   const result = await logs.queryLogs({ app: 'main', limit: 50 });
// =============================================================================

/** Daemon process management */
export const daemon = daemonClient.daemon.OmnitronDaemon;

/** Portal authentication */
export const auth = daemonClient.daemon.OmnitronAuth;

/** Structured log queries */
export const logs = daemonClient.daemon.OmnitronLogs;

/** Fleet node management */
export const fleet = daemonClient.daemon.OmnitronFleet;

/** Alert rules + events */
export const alerts = daemonClient.daemon.OmnitronAlerts;

/** Prometheus metrics + time-series */
export const metrics = daemonClient.daemon.OmnitronMetrics;

/** Infrastructure containers */
export const infra = daemonClient.daemon.OmnitronInfra;

/** Deployment management */
export const deploy = daemonClient.daemon.OmnitronDeploy;

/** CI/CD pipelines */
export const pipelines = daemonClient.daemon.OmnitronPipelines;

/** Distributed traces */
export const traces = daemonClient.daemon.OmnitronTraces;

/** Database backups */
export const backups = daemonClient.daemon.OmnitronBackups;

/** Kubernetes management */
export const kubernetes = daemonClient.daemon.OmnitronKubernetes;

/** Health checks */
export const health = daemonClient.daemon.OmnitronHealth;

/** Discovery scanning */
export const discovery = daemonClient.daemon.OmnitronDiscovery;

/** Secrets management */
export const secrets = daemonClient.daemon.OmnitronSecrets;

/** Project + Stack management */
export const project = daemonClient.daemon.OmnitronProject;

/** System information (OS, CPU, memory, disks, network) */
export const systemInfo = daemonClient.daemon.OmnitronSystemInfo;

/** Infrastructure node management */
export const nodes = daemonClient.daemon.OmnitronNodes;

// =============================================================================
// Legacy RPC helpers — use typed proxies above instead
//
// These exist for backward compatibility. New code should import the typed
// proxy (e.g. `daemon`, `auth`, `logs`) and call methods directly:
//   import { daemon } from 'src/netron/client';
//   await daemon.list();
// =============================================================================

/** @deprecated Use `daemon` typed proxy instead */
export function daemonRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronDaemon', method, args);
}

/** @deprecated Use `auth` typed proxy instead */
export function authRpc(method: string, ...args: any[]): Promise<any> {
  const noAuth = method === 'signIn' || method === 'validateToken' || method === 'refreshSession';
  return daemonClient.invoke('daemon', 'OmnitronAuth', method, args, noAuth ? { skipAuth: true } : undefined);
}

/** @deprecated Use `logs` typed proxy instead */
export function logsRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronLogs', method, args);
}

/** @deprecated Use `fleet` typed proxy instead */
export function fleetRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronFleet', method, args);
}

/** @deprecated Use `alerts` typed proxy instead */
export function alertsRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronAlerts', method, args);
}

/** @deprecated Use `infra` typed proxy instead */
export function infraRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronInfra', method, args);
}

/** @deprecated Use `deploy` typed proxy instead */
export function deployRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronDeploy', method, args);
}

/** @deprecated Use `metrics` typed proxy instead */
export function metricsRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronMetrics', method, args);
}

/** @deprecated Use `pipelines` typed proxy instead */
export function pipelinesRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronPipelines', method, args);
}

/** @deprecated Use `traces` typed proxy instead */
export function tracesRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronTraces', method, args);
}

/** @deprecated Use `backups` typed proxy instead */
export function backupsRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronBackups', method, args);
}

/** @deprecated Use `kubernetes` typed proxy instead */
export function kubernetesRpc(method: string, ...args: any[]): Promise<any> {
  return daemonClient.invoke('daemon', 'OmnitronKubernetes', method, args);
}

// =============================================================================
// JWT Helpers
// =============================================================================

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function getSessionId(): string | null {
  const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return (payload?.sid as string) ?? null;
}

export function setStorageToken(token: string): void {
  jwtAuth.setToken(token);
}

export function clearSession(): void {
  jwtAuth.clearAuth();
}

/** @alias clearSession */
export const clearStorageToken = clearSession;

export function getStorageToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}
