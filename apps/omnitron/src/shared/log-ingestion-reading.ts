import type { LogIngestionStats } from './dto/logs.js';

/** One operational verdict for Console and CLI; absence is never a healthy zero. */
export function readLogIngestion(stats: LogIngestionStats | null): { severity: 'success' | 'warning' | 'error'; title: string; detail: string } {
  if (!stats?.journal) return { severity: 'warning', title: 'Log persistence unverified', detail: 'This backend does not expose durable capture diagnostics.' };
  if (stats.lastError || stats.journal.error || stats.ownerError) return { severity: 'error', title: 'Log persistence delayed',
    detail: `${stats.lastError ?? stats.journal.error ?? stats.ownerError}. ${stats.journal.pending} local records await confirmation; unacknowledged records are retained.` };
  if (stats.capture === 'legacy-owner') return { severity: 'warning', title: 'Legacy log capture',
    detail: 'Database delivery is checked; the running owner cannot prove original capture time or durable replay. An owner update is required.' };
  const pending = stats.journal.pending + (stats.ownerPending ?? 0);
  if (stats.durability !== 'persistent' || !stats.lastCommitAt) return { severity: 'warning', title: 'Awaiting a durable log commit',
    detail: `${pending} records pending. Database durability: ${stats.durability}.` };
  return { severity: pending > 5000 || (pending > 0 && Date.now() - Date.parse(stats.lastCommitAt) > 10000) ? 'warning' : 'success', title: pending ? `${pending} logs pending` : 'Logs committed',
    detail: `Last database commit: ${stats.lastCommitAt}. Capture: ${stats.capture}. Dropped: ${stats.droppedTotal}.` };
}

export function readLogTime(metadata: Record<string, unknown> | null): string | null {
  const capture = metadata?.['_omnitron'];
  if (!capture || typeof capture !== 'object') return null;
  const value = capture as Record<string, unknown>;
  return `Time: ${String(value['timeBasis'] ?? 'unknown')}; event: ${String(value['eventTime'] ?? value['reportedTime'] ?? 'unspecified')}; captured: ${String(value['capturedAt'] ?? 'unknown')}; ${String(value['stream'] ?? '')}; sequence: ${String(value['sequence'] ?? '')}`;
}
