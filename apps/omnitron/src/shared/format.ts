/**
 * Shared formatting utilities for CLI output
 */

import { prism } from '@xec-sh/kit';

export function formatUptime(ms: number): string {
  if (ms === 0) return '-';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatMemory(bytes: number): string {
  if (bytes === 0) return '-';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)}MB`;
  return `${(mb / 1024).toFixed(1)}GB`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0B';
  const mb = bytes / 1024 / 1024;
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)}KB`;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  return `${(mb / 1024).toFixed(2)}GB`;
}

export function formatStatus(status: string): string {
  switch (status) {
    case 'online':
      return prism.green('online');
    case 'starting':
      return prism.yellow('starting');
    case 'stopping':
      return prism.yellow('stopping');
    case 'stopped':
      return prism.dim('stopped');
    case 'errored':
      return prism.red('errored');
    case 'crashed':
      return prism.red('crashed');
    case 'offline':
      return prism.red('offline');
    default:
      return prism.dim(status);
  }
}

/** Color-coded CPU percentage with threshold highlighting */
export function formatCpu(cpu: number): string {
  const text = `${cpu.toFixed(1)}%`;
  if (cpu >= 90) return prism.red(text);
  if (cpu >= 70) return prism.yellow(text);
  return text;
}

/** Color-coded memory with threshold highlighting */
export function formatMemoryColored(bytes: number): string {
  const text = formatMemory(bytes);
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return prism.red(text);
  if (mb >= 512) return prism.yellow(text);
  return text;
}

/** Format restart count — highlight if restarts > 0 */
export function formatRestarts(count: number): string {
  if (count === 0) return '0';
  if (count >= 5) return prism.red(String(count));
  return prism.yellow(String(count));
}

/** Format port number or dash */
export function formatPort(port: number | null): string {
  return port ? String(port) : '-';
}

/** Critical badge */
export function formatCritical(critical: boolean): string {
  return critical ? prism.red('*') : ' ';
}
