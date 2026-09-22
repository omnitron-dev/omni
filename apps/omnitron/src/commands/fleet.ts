/**
 * omnitron fleet status|health|metrics — Fleet-wide aggregation across remote servers
 *
 * Fleet communication uses TCP transport (cross-server Netron RPC).
 */

import { log, table, prism } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import {
  mergeKnownMachines,
  NO_MACHINES_MESSAGE,
  type KnownMachine,
  type NodeLike,
} from '../infrastructure/known-machines.js';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { MeshAsker, askMachine } from './fleet-asking.js';
import { formatStatus, formatMemory } from '../shared/format.js';
import { spinner } from './spinner.js';


/**
 * Every remote machine this installation knows, from both registries.
 *
 * The fleet commands read `servers.json` alone, which is why they reported
 * "No remote servers registered" on an installation with two machines in the
 * console's registry. See `known-machines.ts` for what was measured.
 *
 * The node registry is reached through the daemon, because it lives in the
 * daemon's SQLite. A daemon that cannot be asked is not an error here — the
 * `servers.json` half still answers, and saying so is better than failing a
 * status command because one of two sources is quiet.
 */
async function knownMachines(): Promise<{ machines: KnownMachine[]; nodesUnavailable: string | null }> {
  const servers = new ServerRegistry().list();

  let nodes: NodeLike[] = [];
  let nodesUnavailable: string | null = null;
  const client = createDaemonClient();
  try {
    if (await client.isReachable()) {
      const svc = await client.service<import('../shared/dto/services.js').IOmnitronNodesService>('OmnitronNodes');
      nodes = (await svc.listNodes()) as unknown as NodeLike[];
    } else {
      nodesUnavailable = 'the daemon did not answer, so machines registered in the console are not listed';
    }
  } catch (err) {
    nodesUnavailable = `could not read the node registry: ${(err as Error).message}`;
  } finally {
    await client.disconnect();
  }

  return { machines: mergeKnownMachines(servers, nodes), nodesUnavailable };
}

export async function fleetStatusCommand(): Promise<void> {
  const { machines: servers, nodesUnavailable } = await knownMachines();
  if (nodesUnavailable) log.warn(`  ${nodesUnavailable}`);

  if (servers.length === 0) {
    log.info(NO_MACHINES_MESSAGE);
    return;
  }

  const results: Array<{ alias: string; host: string; status: string; apps: number; cpu: string; memory: string }> = [];
  const registry = new ServerRegistry();

  /**
   * Remember what this probe found — but only for machines that live in
   * `servers.json`.
   *
   * A machine from the node registry has its liveness recorded there, by the
   * health monitor, every minute. Writing it here as well would create the
   * duplicate entry the merge exists to prevent, and it would be created by
   * a READ command, which is not a thing a status should do.
   */
  const remember = (m: KnownMachine, status: 'online' | 'offline') => {
    if (!m.sources.includes('servers.json')) return;
    registry.add({ alias: m.name, host: m.host, port: m.port, tags: [...m.tags], status, lastSeen: Date.now() });
  };

  const mesh = new MeshAsker();
  for (const server of servers.map((m) => ({ ...m, alias: m.name }))) {
    const answer = await askMachine<import('../shared/dto/services.js').DaemonStatusDto>(server, 'status', mesh);

    if (answer.value) {
      remember(server, 'online');
      results.push({
        alias: server.alias,
        host: `${server.host}:${server.port}`,
        // How it was reached, because a node answering only through the mesh
        // is a node whose fleet port is shut — worth knowing before someone
        // debugs a port that was never meant to be open.
        status: `${formatStatus('online')}${answer.via === 'mesh' ? ' (mesh)' : ''}`,
        apps: answer.value.apps.length,
        cpu: `${answer.value.totalCpu.toFixed(1)}%`,
        memory: formatMemory(answer.value.totalMemory),
      });
    } else {
      remember(server, 'offline');
      results.push({
        alias: server.alias,
        host: `${server.host}:${server.port}`,
        status: formatStatus('offline'),
        apps: 0,
        cpu: '-',
        memory: '-',
      });
    }
  }
  await mesh.close();

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
  const { machines, nodesUnavailable } = await knownMachines();
  if (nodesUnavailable) log.warn(`  ${nodesUnavailable}`);
  const servers = machines.map((m) => ({ ...m, alias: m.name }));

  if (servers.length === 0) {
    log.info(NO_MACHINES_MESSAGE);
    return;
  }

  const mesh = new MeshAsker();
  for (const server of servers.map((m) => ({ ...m, alias: m.name }))) {
    const answer = await askMachine<import('../shared/dto/services.js').AggregatedHealthDto>(server, 'health', mesh);

    if (!answer.value) {
      // The reason, not just the verdict: "unreachable" was printed for a
      // node that answers, over a port that was never open to this master.
      log.error(
        `${prism.red('fail')} ${server.alias} (${server.host}:${server.port}) — unreachable: ${answer.error ?? 'no answer'}`,
      );
      continue;
    }

    const health = answer.value;
    const statusIcon =
      health.overall === 'healthy'
        ? prism.green('ok')
        : health.overall === 'degraded'
          ? prism.yellow('degraded')
          : prism.red('unhealthy');
    log.info(
      `${statusIcon} ${server.alias} (${server.host}:${server.port})${answer.via === 'mesh' ? ' (mesh)' : ''} — ${health.overall}`,
    );

    for (const [appName, appHealth] of Object.entries(health.apps)) {
      const appStatus =
        appHealth.status === 'healthy'
          ? prism.green('ok')
          : appHealth.status === 'degraded'
            ? prism.yellow('warn')
            : prism.red('fail');
      log.info(`  ${appStatus} ${appName}: ${appHealth.status}`);
    }
  }
  await mesh.close();
}

export async function fleetMetricsCommand(): Promise<void> {
  const { machines, nodesUnavailable } = await knownMachines();
  if (nodesUnavailable) log.warn(`  ${nodesUnavailable}`);
  const servers = machines.map((m) => ({ ...m, alias: m.name }));

  if (servers.length === 0) {
    log.info(NO_MACHINES_MESSAGE);
    return;
  }

  let totalCpu = 0;
  let totalMemory = 0;
  let totalApps = 0;

  const mesh = new MeshAsker();
  for (const server of servers.map((m) => ({ ...m, alias: m.name }))) {
    const answer = await askMachine<import('../shared/dto/services.js').AggregatedMetricsDto>(server, 'metrics', mesh);

    if (!answer.value) {
      log.error(`${server.alias} — unreachable: ${answer.error ?? 'no answer'}`);
      continue;
    }

    const metrics = answer.value;
    totalCpu += metrics.totals.cpu;
    totalMemory += metrics.totals.memory;

    log.info(`\n${prism.bold(server.alias)} (${server.host}:${server.port})${answer.via === 'mesh' ? ' (mesh)' : ''}`);

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
  }
  await mesh.close();

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
  options: { dryRun?: boolean; keep?: number; allowDirty?: boolean } = {},
): Promise<void> {
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
  let bundle: import('../services/bundle-builder.js').OwnBundle | null = null;
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
      // The machine, for telling two names for one apart — see `address`
      // on UpgradeCandidate. Two registry rows pointing at one box had the
      // bundle installed on it twice, concurrently.
      address: `${n.host}:${n.sshPort}`,
    }));

    // Built before the plan is printed, because the plan names the version
    // and the version comes from the build.
    const { buildOwnBundle, findWorkspaceRoot, readWorkspace, describeTree, upgradeWorkspaceRefusal, OMNITRON_PACKAGE } =
      await import('../services/bundle-builder.js');
    // Not `process.cwd()`: run from `apps/omnitron`, that is two levels below
    // the packages this has to bundle, and the failure it produces —
    // "@omnitron-dev/omnitron is not a package in this workspace" — is true of
    // the directory and says nothing about the mistake. Whose workspace it
    // is, and whether it is its commit, are asked here too, before anything
    // is built — see `upgradeWorkspaceRefusal`.
    const workspaceRoot = findWorkspaceRoot(process.cwd());
    const refusal = upgradeWorkspaceRefusal({
      cwd: process.cwd(),
      root: workspaceRoot,
      hasOmnitron: workspaceRoot ? readWorkspace(workspaceRoot).has(OMNITRON_PACKAGE) : false,
      dirty: workspaceRoot ? (await describeTree(workspaceRoot)).dirty : false,
      allowDirty: options.allowDirty === true,
    });
    if (refusal || !workspaceRoot) {
      log.error(refusal ?? 'No workspace to build from.');
      process.exitCode = 1;
      return;
    }
    const s = spinner();
    s.start('Building a bundle from this working tree...');
    bundle = await buildOwnBundle({ workspaceRoot, label: String(process.pid) });
    s.stop(`Built ${bundle.version}`);
    if (bundle.dirty) {
      // Only reachable with --allow-dirty, asked for deliberately — and the
      // node will still report a version naming a commit it is not running.
      log.warn('  Shipping uncommitted changes (--allow-dirty): the version names a commit it is not.');
    }

    const plan = planUpgrade(candidates, bundle.version, { only: nodeNames });
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

    const archive = await bundle.pack();

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
    // Both of them, and on every path out: a dry run returns before it ships
    // anything and a failure throws, and the tree is there either way.
    await bundle?.cleanup();
    await client.disconnect();
  }
}
