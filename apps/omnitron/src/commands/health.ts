/**
 * omnitron health [app] — Health check report
 *
 * Shows overall cluster health with per-app check details.
 */

import { box, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { emitJson, emitError } from './output.js';
import { requireDaemon } from './daemon-required.js';

export async function healthCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    const health = await client.getHealth(appName ? { name: appName } : {});

    // Not healthy is a non-zero exit, in both modes: a script that asks
    // `omnitron health && deploy` was told «fine» by the exit code whatever
    // the report said.
    if (health.overall !== 'healthy') process.exitCode = 1;

    if (emitJson({ overall: health.overall, ...(health.daemon ? { daemon: health.daemon } : {}), apps: health.apps })) {
      await client.disconnect();
      return;
    }

    const overallColor =
      health.overall === 'healthy' ? prism.green : health.overall === 'degraded' ? prism.yellow : prism.red;
    const overallIcon = health.overall === 'healthy' ? '+' : health.overall === 'degraded' ? '!' : 'x';

    const appEntries = Object.entries(health.apps);
    const healthyCount = appEntries.filter(([, a]) => a.status === 'healthy').length;
    const degradedCount = appEntries.filter(([, a]) => a.status === 'degraded').length;
    const unhealthyCount = appEntries.filter(([, a]) => a.status === 'unhealthy').length;

    const lines: string[] = [
      `Overall:  ${overallColor(`[${overallIcon}] ${health.overall.toUpperCase()}`)}`,
      `Apps:     ${prism.green(String(healthyCount))} healthy${degradedCount ? `, ${prism.yellow(String(degradedCount))} degraded` : ''}${unhealthyCount ? `, ${prism.red(String(unhealthyCount))} unhealthy` : ''}`,
    ];

    // The daemon's own indicators, under their own heading: they were
    // printed as apps, and counted as apps in the line above.
    if (health.daemon) {
      const daemonColor =
        health.daemon.status === 'healthy' ? prism.green : health.daemon.status === 'degraded' ? prism.yellow : prism.red;
      lines.push('', `  ${prism.bold('Daemon')} — ${daemonColor(health.daemon.status)}`);
      for (const indicator of health.daemon.indicators) {
        const color = indicator.status === 'pass' ? prism.green : indicator.status === 'warn' ? prism.yellow : prism.red;
        const icon = indicator.status === 'pass' ? '+' : indicator.status === 'warn' ? '!' : 'x';
        lines.push(`      ${color(icon)} ${indicator.name}${indicator.message ? ` ${prism.dim(`— ${indicator.message}`)}` : ''}`);
      }
    }

    for (const [name, appHealth] of appEntries) {
      const statusColor =
        appHealth.status === 'healthy' ? prism.green : appHealth.status === 'degraded' ? prism.yellow : prism.red;
      const statusIcon = appHealth.status === 'healthy' ? '+' : appHealth.status === 'degraded' ? '!' : 'x';

      lines.push('', `  ${statusColor(`[${statusIcon}]`)} ${prism.bold(name)} — ${statusColor(appHealth.status)}`);

      for (const check of appHealth.checks) {
        const checkColor = check.status === 'pass' ? prism.green : check.status === 'warn' ? prism.yellow : prism.red;
        const icon = check.status === 'pass' ? '+' : check.status === 'warn' ? '!' : 'x';
        lines.push(
          `      ${checkColor(icon)} ${check.name}${check.message ? ` ${prism.dim(`— ${check.message}`)}` : ''}`
        );
      }
    }

    box(lines.join('\n'), 'Health Report');
  } catch (err) {
    emitError((err as Error).message, appName ? { app: appName } : undefined);
    process.exitCode = 1;
  }

  await client.disconnect();
}
