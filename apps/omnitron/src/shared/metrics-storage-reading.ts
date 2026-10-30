import type { MetricsStorageStatus } from './dto/metrics.js';

/** One reading for CLI, Console and daemon health. Missing evidence is not success. */
export function metricsStorageReading(status: MetricsStorageStatus | null | undefined, now = Date.now()) {
  if (!status) return { severity: 'warning' as const, summary: 'Metrics persistence is not reported', detail: 'This daemon cannot report database write confirmation.' };
  const issues: string[] = [];
  if (status.durability !== 'persistent') issues.push(status.durability === 'volatile' ? 'History is volatile and will be lost on restart' : 'Storage durability is unknown');
  if (status.lastError) issues.push(`Write failed: ${status.lastError}`);
  if (status.cleanupError) issues.push(`Retention failed: ${status.cleanupError}`);
  if (status.syncError) issues.push(`Post-write callback failed: ${status.syncError}`);
  if (status.droppedSamples > 0) issues.push(`${status.droppedSamples} samples lost before persistence in this process`);
  const oldest = status.oldestPendingAt ? Date.parse(status.oldestPendingAt) : NaN;
  if (status.pendingSamples > 0 && Number.isFinite(oldest) && now - oldest >= 60_000) issues.push('Database write queue is more than 60s behind');
  const commit = status.lastWriteAt ? `Last completed write ${status.lastWriteAt}` : 'No completed write in this process yet';
  return {
    severity: issues.length ? 'warning' as const : status.lastWriteAt ? 'success' as const : 'info' as const,
    summary: issues.length ? `Metrics storage needs attention · ${status.type}` : `${status.type} · ${status.lastWriteAt ? 'database writes confirmed' : 'awaiting first write'}`,
    detail: [...issues, `${status.pendingSamples}/${status.capacity} samples awaiting write`, commit,
      'Acknowledgements cover database commit, not backup or replica availability'].join('. '),
  };
}
