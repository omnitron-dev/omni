/**
 * omnitron fleet status|health|metrics — Fleet-wide aggregation across remote servers
 *
 * Fleet communication uses TCP transport (cross-server Netron RPC).
 */

import { log, table, prism } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import { createRemoteDaemonClient } from '../daemon/daemon-client.js';
import { formatStatus, formatMemory } from '../shared/format.js';

export async function fleetStatusCommand(): Promise<void> {
  const registry = new ServerRegistry();
  const servers = registry.list();

  if (servers.length === 0) {
    log.info('No remote servers registered. Use `omnitron remote add` to add servers.');
    return;
  }

  const results: Array<{ alias: string; host: string; status: string; apps: number; cpu: string; memory: string }> = [];

  for (const server of servers) {
    const client = createRemoteDaemonClient(server.host, server.port);
    try {
      const d = await client.service<import("../shared/dto/services.js").IDaemonService>("OmnitronDaemon"); const status = await d.status();
      server.status = 'online';
      server.lastSeen = Date.now();
      registry.add(server);

      results.push({
        alias: server.alias,
        host: `${server.host}:${server.port}`,
        status: formatStatus('online'),
        apps: status.apps.length,
        cpu: `${status.totalCpu.toFixed(1)}%`,
        memory: formatMemory(status.totalMemory),
      });
    } catch {
      server.status = 'offline';
      registry.add(server);
      results.push({
        alias: server.alias,
        host: `${server.host}:${server.port}`,
        status: formatStatus('offline'),
        apps: 0,
        cpu: '-',
        memory: '-',
      });
    }
    await client.disconnect();
  }

  table({
    data: results,
    columns: [
      { key: 'alias', header: 'SERVER' },
      { key: 'host', header: 'HOST' },
      { key: 'status', header: 'STATUS' },
      { key: 'apps', header: 'APPS' },
      { key: 'cpu', header: 'CPU', align: 'right' },
      { key: 'memory', header: 'MEMORY', align: 'right' },
    ],
  });
}

export async function fleetHealthCommand(): Promise<void> {
  const registry = new ServerRegistry();
  const servers = registry.list();

  if (servers.length === 0) {
    log.info('No remote servers registered');
    return;
  }

  for (const server of servers) {
    const client = createRemoteDaemonClient(server.host, server.port);
    try {
      const dh = await client.service<import("../shared/dto/services.js").IDaemonService>("OmnitronDaemon"); const health = await dh.getHealth({});
      const statusIcon =
        health.overall === 'healthy'
          ? prism.green('ok')
          : health.overall === 'degraded'
            ? prism.yellow('degraded')
            : prism.red('unhealthy');
      log.info(`${statusIcon} ${server.alias} (${server.host}:${server.port}) — ${health.overall}`);

      for (const [appName, appHealth] of Object.entries(health.apps)) {
        const appStatus =
          appHealth.status === 'healthy'
            ? prism.green('ok')
            : appHealth.status === 'degraded'
              ? prism.yellow('warn')
              : prism.red('fail');
        log.info(`  ${appStatus} ${appName}: ${appHealth.status}`);
      }
    } catch {
      log.error(`${prism.red('fail')} ${server.alias} (${server.host}:${server.port}) — unreachable`);
    }
    await client.disconnect();
  }
}

export async function fleetMetricsCommand(): Promise<void> {
  const registry = new ServerRegistry();
  const servers = registry.list();

  if (servers.length === 0) {
    log.info('No remote servers registered');
    return;
  }

  let totalCpu = 0;
  let totalMemory = 0;
  let totalApps = 0;

  for (const server of servers) {
    const client = createRemoteDaemonClient(server.host, server.port);
    try {
      const dm = await client.service<import("../shared/dto/services.js").IDaemonService>("OmnitronDaemon"); const metrics = await dm.getMetrics({});
      totalCpu += metrics.totals.cpu;
      totalMemory += metrics.totals.memory;

      log.info(`\n${prism.bold(server.alias)} (${server.host}:${server.port})`);

      const data = Object.entries(metrics.apps).map(([name, m]) => {
        totalApps++;
        return {
          app: name,
          cpu: m ? `${m.cpu.toFixed(1)}%` : '-',
          memory: m ? formatMemory(m.memory) : '-',
        };
      });

      table({
        data,
        columns: [
          { key: 'app', header: 'APP' },
          { key: 'cpu', header: 'CPU', align: 'right' },
          { key: 'memory', header: 'MEMORY', align: 'right' },
        ],
      });
    } catch {
      log.error(`${server.alias} — unreachable`);
    }
    await client.disconnect();
  }

  log.info(`\nFleet totals: ${totalApps} apps | CPU: ${totalCpu.toFixed(1)}% | Memory: ${formatMemory(totalMemory)}`);
}
