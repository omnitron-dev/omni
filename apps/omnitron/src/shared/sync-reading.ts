/** Replication evidence shared by the CLI and Console; safe to import in a browser. */
import type { ISyncStatus, ReplicationEvidence } from './dto/project.js';
import type { IMeshNodeStatus } from './dto/nodes.js';

/** Four missed default heartbeat sweeps. */
export const PULL_OVERDUE_MS = 60_000;

type PendingFinding = { readonly pending: number; readonly lastPullMs: number | null; readonly oldestPendingMs: number | null };
type QueueFinding =
  | { readonly state: 'synced' }
  | (PendingFinding & { readonly state: 'pulling' | 'catching-up' | 'behind' | 'unknown' });
export type SyncFinding = QueueFinding & { readonly evidence?: ReplicationEvidence; readonly reconciliationError?: string; readonly history?: ISyncStatus['history'] };

type SyncEvidence = Pick<ISyncStatus, 'pendingItems' | 'lastSyncAt' | 'lastSyncAgeMs' | 'oldestPendingAgeMs' | 'evidence' | 'reconciliationError' | 'history'>;

export function syncFinding(status: SyncEvidence, now: number = Date.now()): SyncFinding {
  return { ...queueFinding(status, now), ...(status.evidence && { evidence: status.evidence }),
    ...(status.reconciliationError && { reconciliationError: status.reconciliationError }), ...(status.history && { history: status.history }) };
}

function queueFinding(status: SyncEvidence, now: number): QueueFinding {
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
  finding.reconciliationError || (finding.evidence && finding.evidence.discardedRows + finding.evidence.evictedRows > 0) ? 'warning'
    : finding.state === 'behind' ? 'warning' : finding.evidence?.unverifiedRows ? 'info' : inSync(finding) ? 'success' : 'info';

export function syncWords(finding: SyncFinding): string {
  const words = [queueWords(finding)];
  if (finding.evidence) {
    const { discardedRows, evictedRows, unverifiedRows } = finding.evidence;
    if (discardedRows) words.push(`${discardedRows} rejected permanently`);
    if (evictedRows) words.push(`${evictedRows} lost to buffer limits`);
    if (unverifiedRows) words.push(`${unverifiedRows} receipts without durable payload proof`);
    const reconciled = finding.evidence.reconciliation;
    if (reconciled?.verifiedRows) words.push(`${reconciled.verifiedRows} historical payloads verified in database`);
    if (reconciled?.restoredRows) words.push(`${reconciled.restoredRows} historical payloads restored on master`);
  }
  if (finding.reconciliationError) words.push(`Reconciliation history unavailable: ${finding.reconciliationError}`);
  if (finding.history?.length) {
    const checked = finding.history.reduce((sum, row) => sum + row.processedRows, 0);
    words.push(`${checked} retained pre-receipt rows checked${finding.history.some(row => row.status === 'partial') ? ' (audit incomplete)' : ''}`);
    if (finding.history.some(row => row.gaps.length)) words.push('earlier history has explicit coverage gaps');
  }
  return words.join(' · ');
}

export function historyWords(history: NonNullable<ISyncStatus['history']>[number]): string {
  const coverage = `${history.category} before receipts: ${history.processedRows}/${history.expectedRows} retained rows checked` +
    ` (${history.presentRows} present, ${history.restoredRows} restored, ${history.expiredRows} outside retention and kept in source archives), ${history.firstAt}–${history.lastAt}`;
  const state = history.status === 'verified' ? `verified at ${history.verifiedAt}` : 'audit incomplete';
  const precision = history.precision === 'millisecond' ? '; log comparison at retained millisecond precision' : '';
  const gaps = history.gaps.map(gap => `${gap.reason}${gap.rows === null ? ' (unknown row count)' : ` (${gap.rows} rows)`}`).join('; ');
  return `${coverage}; ${state}${precision}${gaps ? `; gaps: ${gaps}` : ''}`;
}

export function syncProgressWords(evidence: ReplicationEvidence): string {
  return `Evidence from #${evidence.firstTrackedId} · produced through #${evidence.producedThrough}` +
    ` · released through #${evidence.releasedThrough} · durably committed through #${evidence.committedThrough}`;
}

function queueWords(finding: QueueFinding): string {
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
  const credentialCurrent = mesh.authenticated && (mesh.credentialExpiresAt == null || mesh.credentialExpiresAt > now);
  const state = !mesh.inMesh ? 'not-joined'
    : mesh.status === 'connecting' ? 'connecting'
      : mesh.status !== 'connected' ? 'reconnecting'
        : !fresh ? 'stale' : !credentialCurrent ? 'unauthenticated' : 'connected';
  const retry = mesh.reconnectAt == null ? 'No retry time reported.'
    : `Retry in ${Math.max(0, Math.ceil((mesh.reconnectAt - now) / 1000))} s (attempt ${mesh.reconnectAttempt ?? 1}).`;
  const connection = state === 'connected' ? `RPC connected ${mesh.via === 'ssh-tunnel' ? 'through SSH' : 'directly'}.`
    : state === 'connecting' ? 'Opening and authenticating RPC connection.'
      : state === 'unauthenticated' ? 'RPC reachable without a verified service credential.'
        : state === 'stale' ? 'RPC heartbeat is stale; current reachability is unknown.'
          : state === 'not-joined' ? 'This node is not joined to the mesh.' : `RPC disconnected. ${retry}`;
  const error = [...new Set([mesh.lastError, mesh.lastCredentialError, mesh.cleanupError].filter(Boolean))].join(' ');
  const measured = mesh.syncStatus && mesh.syncStatusAt != null && now - mesh.syncStatusAt < PULL_OVERDUE_MS;
  const replicationError = mesh.lastPullError ?? mesh.lastSyncStatusError;
  const replication = state !== 'connected' ? 'Unknown: no current authenticated RPC connection.'
    : replicationError ? `Failing: ${replicationError}`
      : !measured ? 'Unknown: no recent replication reading.'
        : syncWords(syncFinding(mesh.syncStatus!, now));
  return { state, connection, error, replication };
}
