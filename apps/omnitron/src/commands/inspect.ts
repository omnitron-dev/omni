/**
 * omnitron inspect <app> — Deep diagnostics for a single app
 *
 * Shows memory breakdown, services, config, topology, and environment.
 */

import { box, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { formatUptime, formatBytes } from '../shared/format.js';
import { emitJson, emitError, isJsonMode } from './output.js';

export async function inspectCommand(appName: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    if (isJsonMode()) emitError('Daemon is not running');
    else log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const diag = await client.inspect({ name: appName });

    if (emitJson(diag)) {
      await client.disconnect();
      return;
    }

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

    // Crash diagnosis — the whole point of this command for an
    // operator landing here because an app died. Render the exit
    // code/signal + stderr tail when present so we never again
    // have to tell someone "logs show nothing, sorry".
    if (diag.lastExit) {
      const exitColor = diag.lastExit.expected ? prism.dim : prism.red;
      const exitReason = formatExitReason(diag.lastExit.code, diag.lastExit.signal);
      lines.push('', prism.bold('Last Exit:'));
      lines.push(`  At:       ${prism.dim(diag.lastExit.atIso)}`);
      lines.push(`  Reason:   ${exitColor(exitReason)}`);
      lines.push(`  Expected: ${diag.lastExit.expected ? prism.green('yes') : prism.red('no')}`);
      if (diag.lastExit.message) {
        lines.push(`  Message:  ${prism.yellow(diag.lastExit.message)}`);
      }
      if (diag.lastExit.stderrTail.length > 0) {
        lines.push('', prism.bold(`Last stderr (${diag.lastExit.stderrTail.length} lines):`));
        for (const line of diag.lastExit.stderrTail) {
          lines.push(`  ${prism.red('|')} ${prism.dim(line)}`);
        }
      } else {
        lines.push(`  ${prism.dim('(no stderr captured before exit)')}`);
      }
    }

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

    // Children section — T#66 per-child breakdown (replaces the
    // legacy aggregated `Services:` list which de-duplicated to
    // useless "BootstrapApp@1.0.0" repeats when multiple supervisor
    // children all exposed Titan's default service name).
    if (diag.children && diag.children.length > 0) {
      lines.push('', prism.bold('Children:'));
      for (const child of diag.children) {
        const pid = child.pid != null ? prism.cyan(String(child.pid)) : prism.dim('-');
        const svc = child.serviceName
          ? `${child.serviceName}@${child.serviceVersion ?? '?'}`
          : prism.dim('(no service)');
        const up = child.uptimeSeconds != null ? ` ${prism.dim('up')} ${formatUptime(child.uptimeSeconds)}` : '';
        lines.push(`  ${prism.green('+')} ${prism.bold(child.name)}  pid=${pid}  ${prism.dim(svc)}${up}`);
      }
    } else if (diag.services.length > 0) {
      // Backwards-compatible fallback for older daemons that only
      // surface the flat services list (no `children` field).
      lines.push('', prism.bold('Services:'));
      for (const s of diag.services) {
        lines.push(`  ${prism.green('+')} ${s}`);
      }
    }

    // Logs section — T#66 surfaces the on-disk diagnostic layout
    // so operators don't need to memorise the project-mode vs
    // standalone path conventions, or grep the LogManager source
    // to find where logs land.
    if (diag.logPaths) {
      lines.push('', prism.bold('Logs:'));
      lines.push(`  app:    ${prism.cyan(diag.logPaths.app)}`);
      lines.push(`  error:  ${prism.cyan(diag.logPaths.error)}`);
      lines.push(`  ${prism.dim('Tip: omnitron logs ' + appName + ' [-f] [-e]')}`);
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
    emitError((err as Error).message, { app: appName });
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

/**
 * Format the exit reason for human eyes. POSIX puts code XOR signal
 * — code=0 + signal=null is the canonical "clean exit"; everything
 * else is some flavour of "look at the stderr tail".
 */
function formatExitReason(code: number | null, signal: string | null): string {
  if (signal) {
    return `killed by ${signal}`;
  }
  if (code === null) {
    return 'unknown (no code, no signal)';
  }
  if (code === 0) {
    return 'clean exit (code 0)';
  }
  return `exit code ${code}`;
}
