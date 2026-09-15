/**
 * omnitron fleet status|health|metrics — Fleet-wide aggregation across remote servers
 *
 * Fleet communication uses TCP transport (cross-server Netron RPC).
 */

import { log, table, prism } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import { createRemoteDaemonClient } from '../daemon/daemon-client.js';
import { formatStatus, formatMemory } from '../shared/format.js';
import { spinner } from './spinner.js';

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
    width: 'auto',
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
        width: 'auto',
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

// =============================================================================
// omnitron fleet upgrade — put this working tree on every node
// =============================================================================

/**
 * Upgrade the omnitron running on registered nodes to the one built here.
 *
 * Reads the CONSOLE's node registry rather than `servers.json`, and the
 * reason is credentials: `ServerInfoDto` carries a host and a Netron port,
 * and an upgrade needs SSH to transfer and install. The console's registry
 * holds the key or password an operator supplied, encrypted in the daemon's
 * vault — so the daemon performs the SSH and the CLI never sees a secret.
 *
 * `--dry-run` prints the plan and ships nothing. That is the whole of the
 * decision: which nodes, from what version, and why each of the others is
 * being left alone.
 */
export async function fleetUpgradeCommand(
  nodeNames: string[],
  options: { dryRun?: boolean; keep?: number } = {},
): Promise<void> {
  const { createDaemonClient, LONG_REQUEST_TIMEOUT } = await import('../daemon/daemon-client.js');
  const { requireDaemon } = await import('./daemon-required.js');
  const { planUpgrade, runUpgrade } = await import('../services/node-upgrade.js');

  // The long timeout, for the same reason `start` and `stop` use it: the call
  // this makes IS the work. Installing a bundle is a transfer of tens of
  // megabytes plus an `npm install` of 150 packages on the far side — minutes,
  // against netron's 60-second default.
  //
  // Measured 2026-09-15, the first live run: "RPC request timed out after
  // 60000ms", reported as the upgrade failing, while the node went on
  // installing perfectly well. A timeout shorter than the work turns a
  // successful operation into a failed report and leaves the caller with no
  // idea which it was.
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  if (!(await requireDaemon(client, 'cannot upgrade a fleet'))) {
    await client.disconnect();
    return;
  }

  try {
    const nodes = await client.service<import('../shared/dto/services.js').IOmnitronNodesService>('OmnitronNodes');
    const registered = await nodes.listNodes();

    const candidates = registered.map((n) => ({
      nodeId: n.id,
      name: n.name,
      currentVersion: n.status?.omnitronVersion ?? null,
      isLocal: n.isLocal,
      // SSH, not the daemon: that is the channel an upgrade travels over. A
      // node whose daemon is unreachable is often exactly the one to upgrade.
      sshReachable: n.status?.sshConnected ?? null,
    }));

    // Built before the plan is printed, because the plan names the version
    // and the version comes from the build.
    const { buildBundle, archiveBundle, findWorkspaceRoot } = await import('../services/bundle-builder.js');
    const path = await import('node:path');
    const os = await import('node:os');
    // Not `process.cwd()`: run from `apps/omnitron`, that is two levels below
    // the packages this has to bundle, and the failure it produces —
    // "@omnitron-dev/omnitron is not a package in this workspace" — is true of
    // the directory and says nothing about the mistake.
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    if (!workspaceRoot) {
      log.error('This command builds omnitron from source, and there is no workspace above this directory.');
      log.info('  Run it from inside the omnitron repository.');
      process.exitCode = 1;
      return;
    }
    const staging = path.join(os.tmpdir(), `omnitron-bundle-${process.pid}`);

    const s = spinner();
    s.start('Building a bundle from this working tree...');
    const built = await buildBundle({
      workspaceRoot,
      rootPackage: '@omnitron-dev/omnitron',
      outDir: staging,
    });
    s.stop(`Built ${built.metadata.version}`);
    if (built.metadata.dirty) {
      // Not a refusal: shipping an uncommitted build is a normal thing to do
      // while developing. But a node will report a version whose commit does
      // not describe what it is running, and that is worth saying once.
      log.warn('  The working tree has uncommitted changes — the version names a commit it is not.');
    }

    const plan = planUpgrade(candidates, built.metadata.version, { only: nodeNames });
    if (plan.refusal) {
      log.error(plan.refusal);
      process.exitCode = 1;
      return;
    }

    log.info(`\nTarget: ${prism.bold(plan.targetVersion)}`);
    for (const step of plan.steps) {
      const d = step.decision;
      const mark = d.action === 'upgrade' ? prism.green('upgrade') : d.action === 'skip' ? prism.dim('skip') : prism.yellow('refuse');
      const why = d.action === 'upgrade' ? `from ${d.from ?? 'unknown'}` : d.because;
      log.info(`  ${mark}  ${step.node.name} — ${why}`);
    }

    if (plan.toUpgrade.length === 0) {
      log.info('\nNothing to do.');
      return;
    }
    if (options.dryRun) {
      log.info('\nDry run — nothing was shipped.');
      return;
    }

    const archive = await archiveBundle(built.outDir, path.join(staging + '.tar.gz'));

    const report = await runUpgrade(plan, {
      async install(node) {
        const s2 = spinner();
        s2.start(`${node.name}: installing beside the running version...`);
        const ok = await nodes.installBundleOnNode({
          nodeId: node.nodeId, archivePath: archive, version: plan.targetVersion,
        });
        s2.stop(ok ? `${node.name}: installed` : `${node.name}: install failed`);
        return ok;
      },
      async activate(node) {
        const s2 = spinner();
        s2.start(`${node.name}: switching and restarting...`);
        const ok = await nodes.activateBundleOnNode({
          nodeId: node.nodeId, version: plan.targetVersion, keepVersions: options.keep ?? 3,
        });
        s2.stop(ok ? `${node.name}: running ${plan.targetVersion}` : `${node.name}: did not come up`);
        return ok;
      },
    });

    log.info('');
    for (const o of report.upgraded) log.success(`${o.name}: ${o.detail}`);
    for (const o of report.skipped) log.info(`${o.name}: ${o.detail}`);
    if (report.failed) {
      log.error(`${report.failed.name}: ${report.failed.detail}`);
      if (report.notAttempted.length > 0) {
        // Named, not counted. "Seven of twelve" is not a state anybody can
        // act on.
        log.warn(`  Stopped — not attempted: ${report.notAttempted.join(', ')}`);
      }
      process.exitCode = 1;
    }
  } catch (err) {
    log.error(`Fleet upgrade failed: ${(err as Error).message}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
