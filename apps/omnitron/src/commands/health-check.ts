/**
 * omnitron health-check [app] — knock on what runs on this machine
 *
 * `omnitron health` reports what the apps say about themselves (their
 * indicators). This asks from outside: is each process up, does its HTTP
 * server take a request on its port, does every container of every stack on
 * this machine run and accept a connection on the ports it publishes.
 *
 * Without arguments: every app and every container on this machine.
 * With an app name: that app — refused when this daemon does not run it.
 * Exits 1 unless everything checked is healthy.
 */

import { box, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { HealthReport, PlatformHealthReport } from '../services/health-check.service.js';
import { requireDaemon } from './daemon-required.js';

/**
 * Typed proxy for the `OmnitronHealth` Netron service exposed directly
 * on the daemon peer (see daemon.ts → exposeService(HealthCheckRpcService)).
 *
 * This is a top-level peer service — it is NOT hosted inside an app, so
 * it must be reached via `client.service('OmnitronHealth')`, the same way
 * `inspect`/`project`/etc. reach their services. It is NOT reachable via
 * `client.exec`, whose `name` field resolves an app handle and would
 * (pre-fix) throw "App with id __daemon__ not found".
 */
interface IHealthCheckRpcService {
  checkApp(data: { appName: string; port?: number }): Promise<HealthReport>;
  checkAll(): Promise<PlatformHealthReport>;
}

export async function healthCheckCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await requireDaemon(client, 'cannot perform health check'))) {
    await client.disconnect();
    return;
  }

  try {
    const health = await client.service<IHealthCheckRpcService>('OmnitronHealth');

    if (appName) {
      // Single app health check via OmnitronHealth.checkApp.
      // The service resolves `appName` through orchestrator.getApp →
      // resolveAppName, so both short ("main") and canonical
      // ("omni/dev/main") forms work — matching `inspect`.
      const report = await health.checkApp({ appName });

      renderHealthReport(`Health Check: ${appName}`, report);
      // A script asks `health-check && deploy`; it used to get 0 whatever
      // the report said.
      if (report.overall !== 'healthy') process.exitCode = 1;
    } else {
      // Full platform health check via OmnitronHealth.checkAll
      const result = await health.checkAll();

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

      box(lines.join('\n'), 'Health Check — this machine');
      if (result.overall !== 'healthy') process.exitCode = 1;
    }
  } catch (err) {
    log.error(`Health check failed: ${(err as Error).message}`);
    process.exitCode = 1;
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
    lines.push(prism.dim('  Nothing of this kind runs on this machine'));
  }
}
