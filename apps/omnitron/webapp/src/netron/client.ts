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
  MiddlewareStage,
  type BackendSchema,
} from '@omnitron-dev/prism/netron';

import type {
  IDaemonService,
  IOmnitronAuthService,
  IOmnitronLogsService,
  IOmnitronAlertsService,
  IOmnitronDeployService,
  IOmnitronInfraService,
  IOmnitronFleetService,
  IOmnitronPipelinesService,
  IOmnitronTracesService,
  IOmnitronSystemInfoService,
  IOmnitronBackupsService,
  IOmnitronKubernetesService,
  IOmnitronHealthService,
  IOmnitronDiscoveryService,
  IOmnitronSecretsService,
  IOmnitronNodesService,
  IOmnitronMetricsService,
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
    OmnitronFleet: IOmnitronFleetService;
    OmnitronAlerts: IOmnitronAlertsService;
    OmnitronMetrics: IOmnitronMetricsService;
    OmnitronInfra: IOmnitronInfraService;
    OmnitronDeploy: IOmnitronDeployService;
    OmnitronPipelines: IOmnitronPipelinesService;
    OmnitronTraces: IOmnitronTracesService;
    OmnitronBackups: IOmnitronBackupsService;
    OmnitronKubernetes: IOmnitronKubernetesService;
    OmnitronHealth: IOmnitronHealthService;
    OmnitronDiscovery: IOmnitronDiscoveryService;
    OmnitronSecrets: IOmnitronSecretsService;
    OmnitronProject: IProjectRpcService;
    OmnitronSystemInfo: IOmnitronSystemInfoService;
    OmnitronNodes: IOmnitronNodesService;
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

// -----------------------------------------------------------------------------
// Expired-session handling
//
// Without this, an expired JWT produced a console that LOOKED functional: every
// RPC came back 401, and the dashboard rendered "Applications 0 / No apps yet"
// with the status bar showing "Offline". An operator reading that would
// reasonably conclude their applications had died. Reproduced in the browser —
// nine 401s on a single page load, no redirect.
//
// The session manager already handles expiry it can PREDICT (it schedules a
// refresh before the token's expiry). This covers the case it cannot: a token
// that expired while the tab was closed or asleep, where the first request
// after waking is already rejected.
//
// `createSimpleAuthErrorMiddleware` attempts a refresh first and only reports
// expiry when that fails, so a recoverable session is not thrown away.
// -----------------------------------------------------------------------------

// NOTE ON THE IMPLEMENTATION
//
// `createSimpleAuthErrorMiddleware` in netron-browser looks like the right
// tool and is documented for exactly this, but it cannot fire on the HTTP
// client: it is written as a wrapper (`try { await next() } catch`), while
// the client invokes the ERROR stage AFTER catching the failure itself and
// parks it in `ctx.error`. `next()` therefore never throws and the handler's
// catch never runs. Reported to netron-browser's owner; once the shared
// middleware reads `ctx.error`, this collapses into a call to it.
//
// Until then the console carries the minimum that makes the symptom go away,
// and no refresh logic — the session manager already owns that.
daemonClient.use(
  async (ctx, next) => {
    await next();

    const status = errorStatus(ctx.error);
    if (status !== 401) return;

    // Deliberately a full navigation rather than a router push: the whole
    // client state derives from a session that no longer exists.
    if (typeof window === 'undefined') return;
    if (window.location.pathname.startsWith('/auth/')) return;

    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/auth/sign-in?returnTo=${returnTo}`;
  },
  { name: 'session-expired-redirect', priority: 10 },
  MiddlewareStage.ERROR,
);

/**
 * Pull an HTTP status out of the several shapes a Netron error can take.
 *
 * The daemon sends `"code": "401"` as a STRING. One client path already
 * parses it (`http/peer.ts` coerces before building a TitanError); the other
 * (`http/client.ts`, which wraps the raw response in `NetronErrors
 * .invalidResponse({ error: response.error })`) does not. This accepted
 * numbers only, so on the second path an expired session produced no
 * redirect at all — the console stayed on a page whose every request was
 * being refused, which is the symptom the middleware above exists to remove.
 *
 * Numeric strings are accepted, and only those: `Number('')` is 0 and
 * `Number(null)` is 0, either of which would turn a missing code into a
 * status of zero.
 */
export function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as Record<string, any>;
  const candidates = [
    e['status'],
    e['statusCode'],
    e['code'],
    e['response']?.status,
    e['data']?.code,
    // `NetronErrors.invalidResponse` parks the server's payload one level in.
    e['details']?.['error']?.code,
    e['data']?.['error']?.code,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === 'string' && /^\d{3}$/.test(candidate)) return Number(candidate);
  }
  return undefined;
}

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
export function authRpc<M extends keyof IOmnitronAuthService>(
  method: M,
  ...args: Parameters<IOmnitronAuthService[M]>
): Promise<ReturnType<IOmnitronAuthService[M]>> {
  // Typed against the service contract. Untyped (`...args: any[]`), this
  // helper let `refreshSession` be called with a bare string where the
  // contract takes `{ sessionId }` — the server read `undefined`, returned
  // `{ success: false }`, and session refresh silently never worked.
  const noAuth = method === 'signIn' || method === 'validateToken' || method === 'refreshSession';
  return daemonClient.invoke(
    'daemon',
    'OmnitronAuth',
    method as string,
    args,
    noAuth ? { skipAuth: true } : undefined
  ) as Promise<ReturnType<IOmnitronAuthService[M]>>;
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
