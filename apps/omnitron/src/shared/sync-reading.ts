/** Replication evidence shared by the CLI and Console; safe to import in a browser. */
import type { ISyncStatus } from './dto/project.js';
import type { IMeshNodeStatus } from './dto/nodes.js';

/** Four missed default heartbeat sweeps. */
export const PULL_OVERDUE_MS = 60_000;

type PendingFinding = { readonly pending: number; readonly lastPullMs: number | null; readonly oldestPendingMs: number | null };
export type SyncFinding =
  | { readonly state: 'synced' }
  | (PendingFinding & { readonly state: 'pulling' | 'catching-up' | 'behind' | 'unknown' });

type SyncEvidence = Pick<ISyncStatus, 'pendingItems' | 'lastSyncAt' | 'lastSyncAgeMs' | 'oldestPendingAgeMs'>;

export function syncFinding(status: SyncEvidence, now: number = Date.now()): SyncFinding {
  if (status.pendingItems === 0) return { state: 'synced' };
  // Prefer durations measured on the node, not subtraction across host clocks.
  const lastPullMs = status.lastSyncAgeMs !== undefined ? status.lastSyncAgeMs
    : status.lastSyncAt === null ? null : Math.max(0, now - status.lastSyncAt);
  const oldestPendingMs = status.oldestPendingAgeMs ?? null;
  const pending = { pending: status.pendingItems, lastPullMs, oldestPendingMs };
  if (lastPullMs === null || lastPullMs >= PULL_OVERDUE_MS) return { ...pending, state: 'behind' };
  // An older peer's recent acknowledgement proves activity, not an up-to-date queue.
  if (oldestPendingMs === null) return { ...pending, state: 'unknown' };
  return { ...pending, state: oldestPendingMs >= PULL_OVERDUE_MS ? 'catching-up' : 'pulling' };
}

/** Only verified empty or young queues count as keeping up. */
export const inSync = (finding: SyncFinding): boolean => finding.state === 'synced' || finding.state === 'pulling';
export const syncSeverity = (finding: SyncFinding): 'success' | 'info' | 'warning' =>
  inSync(finding) ? 'success' : finding.state === 'behind' ? 'warning' : 'info';

export function syncWords(finding: SyncFinding): string {
  if (finding.state === 'synced') return 'in sync';
  if (finding.state === 'unknown') return `delivery active · ${finding.pending} waiting, queue age unavailable`;
  if (finding.state === 'pulling' || finding.state === 'catching-up') {
    const label = finding.state === 'pulling' ? 'keeping up' : 'catching up';
    return `${label} · ${finding.pending} waiting, oldest ${Math.round(finding.oldestPendingMs! / 1000)} s`;
  }
  return finding.lastPullMs === null
    ? `behind · ${finding.pending} waiting, never pulled`
    : `behind · ${finding.pending} waiting, last pull ${Math.round(finding.lastPullMs / 1000)} s ago`;
}

/** Shared by Console and CLI: transport reachability is separate from delivery. */
export function meshReading(mesh: IMeshNodeStatus, now = Date.now()): {
  state: 'not-joined' | 'connecting' | 'reconnecting' | 'stale' | 'unauthenticated' | 'connected';
  connection: string;
  error: string;
  replication: string;
} {
  const fresh = mesh.lastHeartbeat !== null && now - mesh.lastHeartbeat < PULL_OVERDUE_MS;
  const state = !mesh.inMesh ? 'not-joined'
    : mesh.status === 'connecting' ? 'connecting'
      : mesh.status !== 'connected' ? 'reconnecting'
        : !fresh ? 'stale' : !mesh.authenticated ? 'unauthenticated' : 'connected';
  const retry = mesh.reconnectAt == null ? 'No retry time reported.'
    : `Retry in ${Math.max(0, Math.ceil((mesh.reconnectAt - now) / 1000))} s (attempt ${mesh.reconnectAttempt ?? 1}).`;
  const connection = state === 'connected' ? `RPC connected ${mesh.via === 'ssh-tunnel' ? 'through SSH' : 'directly'}.`
    : state === 'connecting' ? 'Opening and authenticating RPC connection.'
      : state === 'unauthenticated' ? 'RPC reachable without a verified service credential.'
        : state === 'stale' ? 'RPC heartbeat is stale; current reachability is unknown.'
          : state === 'not-joined' ? 'This node is not joined to the mesh.' : `RPC disconnected. ${retry}`;
  const error = [mesh.lastError, mesh.cleanupError].filter(Boolean).join(' ');
  const measured = mesh.syncStatus && mesh.syncStatusAt != null && now - mesh.syncStatusAt < PULL_OVERDUE_MS;
  const replicationError = mesh.lastPullError ?? mesh.lastSyncStatusError;
  const replication = state !== 'connected' ? 'Unknown: no current authenticated RPC connection.'
    : replicationError ? `Failing: ${replicationError}`
      : !measured ? 'Unknown: no recent replication reading.'
        : syncWords(syncFinding(mesh.syncStatus!, now));
  return { state, connection, error, replication };
}
