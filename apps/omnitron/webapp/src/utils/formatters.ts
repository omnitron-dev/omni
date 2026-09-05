/**
 * Shared formatting utilities for the Omnitron webapp.
 *
 * Centralises formatUptime, formatMemory, formatTimestamp, formatDate, timeAgo
 * so they are not duplicated across pages.
 */

export function formatUptime(ms: number): string {
  // `< 0`, not `<= 0`. An app that started this instant has an uptime of
  // zero, which is a measurement; rendering it as `--` says the opposite —
  // that nothing is known — and during a restart an operator cannot tell
  // "just came up" from "no reading yet".
  if (ms < 0 || !Number.isFinite(ms)) return '--';
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function formatMemory(bytes: number): string {
  // Same distinction. Since the orchestrator stopped overwriting a failed
  // sample with zeros, a zero here means the process really is holding
  // nothing measurable — and `--` would claim the sample never happened.
  if (bytes < 0 || !Number.isFinite(bytes)) return '--';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatMemoryMb(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) return '--';
  return `${(bytes / (1024 * 1024)).toFixed(1)}`;
}

export function formatTimestamp(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  return d.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(ts: Date | string): string {
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  const today = new Date();
  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return formatTimestamp(ts);
  }
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' +
    formatTimestamp(ts)
  );
}

export function formatDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * A duration in ms as `45s` or `3m 20s`.
 *
 * Was copied into deployments.tsx and pipelines.tsx, both with the `<= 0`
 * confusion the other formatters here had: a deployment that finished in
 * under a millisecond, or a pipeline step that was instantaneous, read as
 * `--` — "we do not know how long it took" rather than "no time at all".
 */
export function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return '--';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  return `${mins}m ${seconds % 60}s`;
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Clock skew between the daemon and the browser puts events slightly in the
  // future; without the clamp that reads as `-1m ago`.
  const diff = Math.max(0, Date.now() - d.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
