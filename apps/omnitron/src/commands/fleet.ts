/**
 * omnitron fleet status|health|metrics — Fleet-wide aggregation across remote servers
 *
 * Fleet communication uses TCP transport (cross-server Netron RPC).
 */

import { log, table, prism } from '@xec-sh/kit';
import { ServerRegistry } from '../infrastructure/server-registry.js';
import { NO_MACHINES_MESSAGE, type KnownMachine } from '../infrastructure/known-machines.js';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { MeshAsker, askMachine, knownMachines } from './fleet-asking.js';
import { formatStatus, formatMemory } from '../shared/format.js';
import { spinner } from './spinner.js';

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

    // A daemon on a build older than the split answers its own indicators
    // under `apps` and has no `daemon` section; its lines print as before.
    for (const indicator of health.daemon?.indicators ?? []) {
      if (indicator.status === 'pass') continue;
      const mark = indicator.status === 'warn' ? prism.yellow('warn') : prism.red('fail');
      log.info(`  ${mark} daemon ${indicator.name}${indicator.message ? `: ${indicator.message}` : ''}`);
    }
    for (const [appName, appHealth] of Object.entries(health.apps)) {
      const appStatus =
        appHealth.status === 'healthy'
          ? prism.green('ok')
          : appHealth.status === 'degraded'
            ? prism.yellow('warn')
            : prism.red('fail');
      log.info(`  ${appStatus} ${appName}: ${appHealth.status}`);
      for (const check of appHealth.checks) {
        if (check.status === 'pass') continue;
        log.info(`      ${check.status === 'warn' ? prism.yellow('!') : prism.red('x')} ${check.name}${check.message ? ` — ${check.message}` : ''}`);
      }
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

    // Before anything is built — see `printUnbuiltPlan`.
    if (options.dryRun) {
      await printUnbuiltPlan(nodes, nodeNames, options.allowDirty === true);
      return;
    }

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
    // Both of them, and on every path out: nothing to ship and a failure
    // both return early, and the tree is there either way.
    await bundle?.cleanup();
    await client.disconnect();
  }
}

/**
 * `--dry-run`: the plan, with nothing built.
 *
 * Documented as «print the plan and ship nothing», and it built first: the
 * version to compare against comes from a build, so `buildOwnBundle` ran
 * before the plan was printed — and `bundle-builder` rebuilds every stale
 * workspace package IN THE WORKING TREE (`pnpm --dir <pkg> run build`). On
 * 2026-09-23 at 08:53Z two of fourteen packages were stale, so a dry run
 * would have rebuilt them in the live tree; on a dirty tree it refused
 * before printing any plan at all.
 *
 * The daemon's own planner answers without a build (`planUpgrade` with
 * `build: false`, measured at 36 ms): which nodes are local, which refused
 * SSH, which would be attempted — everything except «already on it», which
 * needs a version to compare, and each row says so rather than pretending
 * the comparison happened. What a real run would refuse about the working
 * tree is said as well, from `git status` alone.
 */
async function printUnbuiltPlan(
  nodes: import('../shared/dto/services.js').IOmnitronNodesService,
  nodeNames: string[],
  allowDirty: boolean,
): Promise<void> {
  // Explicit on the wire, though it is the planner's default: a dry run that
  // builds is the defect this path exists to remove.
  const request: { nodeIds?: string[]; build: false } = {
    ...(nodeNames.length > 0 ? { nodeIds: nodeNames } : {}),
    build: false,
  };
  const plan = await nodes.planUpgrade(request);
  if (plan.refusal) {
    log.error(plan.refusal);
    process.exitCode = 1;
    return;
  }

  log.info(`\nTarget: ${prism.dim('not built — a dry run builds nothing, so no versions were compared')}`);
  for (const row of plan.rows) {
    const mark =
      row.action === 'upgrade' ? prism.green('upgrade') : row.action === 'skip' ? prism.dim('skip') : prism.yellow('refuse');
    const why =
      row.action === 'upgrade'
        ? `from ${row.currentVersion ?? 'unknown'}${row.because ? ` (${row.because})` : ''}`
        : row.because;
    log.info(`  ${mark}  ${row.label} — ${why}`);
  }

  const { findWorkspaceRoot, readWorkspace, describeTree, upgradeWorkspaceRefusal, OMNITRON_PACKAGE } = await import(
    '../services/bundle-builder.js'
  );
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const refusal = upgradeWorkspaceRefusal({
    cwd: process.cwd(),
    root: workspaceRoot,
    hasOmnitron: workspaceRoot ? readWorkspace(workspaceRoot).has(OMNITRON_PACKAGE) : false,
    dirty: workspaceRoot ? (await describeTree(workspaceRoot)).dirty : false,
    allowDirty,
  });
  if (refusal) log.warn(`A real run would refuse: ${refusal}`);

  log.info('\nDry run — nothing was built or shipped.');
}
