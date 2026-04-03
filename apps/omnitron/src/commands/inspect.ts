/**
 * omnitron inspect <app> — Deep diagnostics for a single app
 *
 * Shows memory breakdown, services, config, topology, and environment.
 */

import { box, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { formatUptime, formatBytes } from '../shared/format.js';

export async function inspectCommand(appName: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const diag = await client.inspect({ name: appName });

    const statusColor =
      diag.status === 'online'
        ? prism.green
        : diag.status === 'errored' || diag.status === 'crashed'
          ? prism.red
          : prism.yellow;

    const lines: string[] = [
      `Name:       ${prism.bold(diag.name)}`,
      `PID:        ${diag.pid ?? '-'}`,
      `Status:     ${statusColor(diag.status)}`,
      `Uptime:     ${formatUptime(diag.uptime)}`,
      `Restarts:   ${diag.restarts > 0 ? prism.yellow(String(diag.restarts)) : '0'}`,
    ];

    // Config section
    if (diag.config && Object.keys(diag.config).length > 0) {
      lines.push('', prism.bold('Config:'));
      for (const [key, value] of Object.entries(diag.config)) {
        if (key === 'bootstrap') {
          lines.push(`  bootstrap:  ${prism.dim(String(value))}`);
        } else {
          lines.push(`  ${key}: ${formatConfigValue(key, value)}`);
        }
      }
    }

    // Memory section
    lines.push('', prism.bold('Memory:'));
    lines.push(`  RSS:          ${formatBytes(diag.memory.rss)}`);
    if (diag.memory.heapUsed > 0) lines.push(`  Heap Used:    ${formatBytes(diag.memory.heapUsed)}`);
    if (diag.memory.heapTotal > 0) lines.push(`  Heap Total:   ${formatBytes(diag.memory.heapTotal)}`);
    if (diag.memory.external > 0) lines.push(`  External:     ${formatBytes(diag.memory.external)}`);
    if (diag.memory.arrayBuffers > 0) lines.push(`  ArrayBuffers: ${formatBytes(diag.memory.arrayBuffers)}`);

    // Services section
    if (diag.services.length > 0) {
      lines.push('', prism.bold('Services:'));
      for (const s of diag.services) {
        lines.push(`  ${prism.green('+')} ${s}`);
      }
    }

    // Environment section
    try {
      const env = await client.getEnv({ name: appName });
      if (env && Object.keys(env).length > 0) {
        lines.push('', prism.bold('Environment:'));
        for (const [key, value] of Object.entries(env)) {
          // Mask sensitive values
          const masked = /secret|password|token|key/i.test(key) ? '***' : value;
          lines.push(`  ${key}=${prism.dim(masked)}`);
        }
      }
    } catch {
      // Env not available — skip silently
    }

    box(lines.join('\n'), `Inspect: ${appName}`);
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}

function formatConfigValue(key: string, value: unknown): string {
  if (key === 'critical' && value === true) return prism.red('true');
  if (key === 'critical' && value === false) return 'false';
  if (key === 'port') return prism.cyan(String(value));
  if (typeof value === 'boolean') return value ? prism.green('true') : 'false';
  if (typeof value === 'number') return prism.cyan(String(value));
  return String(value);
}
