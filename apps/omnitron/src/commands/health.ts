/**
 * omnitron health [app] — Health check report
 *
 * Shows overall cluster health with per-app check details.
 */

import { box, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function healthCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const health = await client.getHealth(appName ? { name: appName } : {});

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
    log.error((err as Error).message);
  }

  await client.disconnect();
}
