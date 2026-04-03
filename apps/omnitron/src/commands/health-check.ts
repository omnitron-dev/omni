/**
 * omnitron health-check [app] — Detailed composable health report
 *
 * Unlike `omnitron health` which uses the daemon's internal HealthService
 * (PM-based process health), this command uses HealthCheckService which
 * performs actual HTTP/TCP connectivity checks and infrastructure probes.
 *
 * Without arguments: full platform report (apps + infrastructure)
 * With app name: detailed health report for that specific app
 */

import { box, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function healthCheckCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running — cannot perform health check');
    await client.disconnect();
    return;
  }

  try {

    if (appName) {
      // Single app health check via OmnitronHealth.checkApp
      const report = await client.exec({
        name: '__daemon__',
        service: 'OmnitronHealth',
        method: 'checkApp',
        args: [{ appName }],
      } as any) as any;

      renderHealthReport(`Health Check: ${appName}`, report);
    } else {
      // Full platform health check via OmnitronHealth.checkAll
      const result = await client.exec({
        name: '__daemon__',
        service: 'OmnitronHealth',
        method: 'checkAll',
        args: [],
      } as any) as any;

      const lines: string[] = [];

      const overallColor = result.overall === 'healthy' ? prism.green
        : result.overall === 'degraded' ? prism.yellow : prism.red;
      const overallIcon = result.overall === 'healthy' ? '+' : result.overall === 'degraded' ? '!' : 'x';

      lines.push(`Platform:  ${overallColor(`[${overallIcon}] ${result.overall.toUpperCase()}`)}`);
      lines.push('');

      // Apps section
      lines.push(prism.bold('Applications'));
      renderChecks(lines, result.apps);

      lines.push('');

      // Infrastructure section
      lines.push(prism.bold('Infrastructure'));
      renderChecks(lines, result.infra);

      box(lines.join('\n'), 'Platform Health Check');
    }
  } catch (err) {
    log.error(`Health check failed: ${(err as Error).message}`);
  }

  await client.disconnect();
}

function renderHealthReport(title: string, report: any): void {
  const lines: string[] = [];

  const overallColor = report.overall === 'healthy' ? prism.green
    : report.overall === 'degraded' ? prism.yellow : prism.red;
  const overallIcon = report.overall === 'healthy' ? '+' : report.overall === 'degraded' ? '!' : 'x';

  lines.push(`Status:    ${overallColor(`[${overallIcon}] ${report.overall.toUpperCase()}`)}`);
  if (report.duration !== undefined) {
    lines.push(`Duration:  ${report.duration}ms`);
  }
  lines.push('');

  renderChecks(lines, report);

  box(lines.join('\n'), title);
}

function renderChecks(lines: string[], report: any): void {
  if (!report?.checks) return;

  for (const check of report.checks) {
    const color = check.status === 'pass' ? prism.green
      : check.status === 'warn' ? prism.yellow : prism.red;
    const icon = check.status === 'pass' ? '+' : check.status === 'warn' ? '!' : 'x';

    let detail = '';
    if (check.message) detail += ` ${prism.dim(`— ${check.message}`)}`;
    if (check.duration !== undefined) detail += ` ${prism.dim(`(${check.duration}ms)`)}`;

    lines.push(`  ${color(`[${icon}]`)} ${check.name}${detail}`);
  }

  if (report.checks.length === 0) {
    lines.push(prism.dim('  No checks configured'));
  }
}
