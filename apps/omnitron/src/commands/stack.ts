import { stackHealthReading, healthLabel } from '../shared/stack-reading.js';
/**
 * Stack CLI Commands — manage stacks on the running daemon
 *
 * Uses typed Netron service proxies and @xec-sh/kit for TUI output.
 */

import { log, table, note, prism } from '@xec-sh/kit';
import { createDaemonClient, LONG_REQUEST_TIMEOUT, isRequestTimeout } from '../daemon/daemon-client.js';
import { isLostRpcAcknowledgement, type IProjectRpcService } from '../shared/dto/services.js';
import { emitJson, emitError, emitStep, emitSuccess, emitInfo, isJsonMode } from './output.js';
import { syncFinding, syncWords, syncSeverity } from '../shared/sync-reading.js';
import { readDeploymentProgress, readStackStart } from '../shared/release-reading.js';

// =============================================================================
// Helpers
// =============================================================================

function statusIcon(status: string): string {
  switch (status) {
    case 'running': return prism.green('●');
    case 'starting': case 'stopping': return prism.yellow('◐');
    case 'degraded': return prism.yellow('●');
    case 'error': return prism.red('●');
    default: return prism.gray('○');
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

// =============================================================================
// Commands
// =============================================================================

export async function stackListCommand(options?: { project?: string }): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    const projects = await svc.listProjects();

    if (projects.length === 0) {
      log.info('No projects registered.');
      log.info('Register one: omnitron project add <name> <path>');
      return;
    }

    const filtered = options?.project
      ? projects.filter((p) => p.name === options.project)
      : projects;

    if (filtered.length === 0) {
      log.error(`Project '${options?.project}' not found`);
      return;
    }

    if (isJsonMode()) {
      const data = [];
      for (const project of filtered) {
        data.push({
          project: project.name,
          path: project.path,
          stacks: await svc.listStacks({ project: project.name }),
        });
      }
      emitJson(data);
      return;
    }

    for (const project of filtered) {
      const stacks = await svc.listStacks({ project: project.name });

      note(`${prism.bold(project.name)}  ${prism.dim(project.path)}`);

      if (stacks.length === 0) {
        log.info(prism.dim('No stacks configured'));
        continue;
      }

      table({
        width: 'auto',
        data: stacks.map((s) => ({
          status: `${statusIcon(s.status)} ${s.status}`,
          health: stackHealthReading(s.health).label,
          name: s.name,
          type: s.type === 'local' ? 'local' : s.type === 'remote' ? 'remote(ssh)' : 'cluster',
          apps: `${s.apps.filter((a) => a.status === 'online').length}/${s.apps.length}`,
          nodes: `${s.nodes.filter((n) => n.connected).length}/${s.nodes.length}`,
          uptime: s.uptime > 0 ? formatDuration(s.uptime) : prism.dim('--'),
        })),
        columns: [
          { key: 'status', header: 'Status', width: 14 },
          { key: 'health', header: 'Health', width: 16 },
          { key: 'name', header: 'Stack', width: 12 },
          { key: 'type', header: 'Type', width: 14 },
          { key: 'apps', header: 'Apps', width: 8 },
          { key: 'nodes', header: 'Nodes', width: 8 },
          { key: 'uptime', header: 'Uptime', width: 10 },
        ],
      });
    }
  } catch (err) {
    log.error((err as Error).message);
  } finally {
    await client.disconnect();
  }
}

export async function stackProgressCommand(project: string, stack?: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    const records = await svc.getDeployProgress({ project, ...(stack && { stack }) });
    const { transfers, unscoped } = readDeploymentProgress(records, { name: project }, stack);
    if (isJsonMode()) { emitJson({ project, stack: stack ?? null, transfers, unscopedCount: unscoped.length }); return; }
    if (unscoped.length) log.warn(`${unscoped.length} controller observations have no recorded workspace.`);
    if (!transfers.length) log.info('No attributed transfer observations for this workspace.');
    for (const row of transfers) {
      log.info(`${row.at}  ${row.project}/${row.stack}  ${row.node}  ${row.app}  ${row.status}  ${row.message}`);
      if (row.operationId) log.info(`  Operation ${row.operationId}${row.releaseId ? ' · Release ' + row.releaseId : ''}`);
    }
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
  finally { await client.disconnect(); }
}

export async function stackStatusCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    const stack = await svc.getStack({ project: projectName, stack: stackName });
    if (isJsonMode()) { emitJson(stack); return; }

    const typeLabel = stack.type === 'local' ? 'local' : stack.type === 'remote' ? 'remote(ssh)' : 'cluster';
    note(
      [
        `${prism.bold(`${projectName}/${stack.name}`)}  ${prism.dim(typeLabel)}`,
        `Status: ${statusIcon(stack.status)} ${stack.status}`,
        ...(stack.selectedRelease ? ['Next launch: ' + stack.selectedRelease.id] : []),
        ...(stack.startedAt ? [`Started: ${stack.startedAt}`] : []),
        ...(stack.uptime > 0 ? [`Uptime: ${formatDuration(stack.uptime)}`] : []),
        // When this master took charge of it — not when it started.
        ...(stack.attachedAt ? [`Attached: ${stack.attachedAt}`] : []),
        ...(stack.portRange ? [`Ports: ${stack.portRange.start}–${stack.portRange.end}`] : []),
      ].join('\n'),
      'Stack'
    );

    const health = stackHealthReading(stack.health);
    log.info(`Health: ${health.label} — ${health.detail}`);
    for (const app of health.findings) for (const check of app.checks.filter(c => c.status !== 'pass'))
      log.warn(`${app.node}/${app.name}: ${check.message || check.name}`);

    for (const issue of stack.notUp ?? []) log.warn(`Not up: ${issue}`);

    if (stack.stopOperation) {
      const stop = stack.stopOperation;
      log.info(`Last stop: ${stop.phase}${stop.supersededAt ? ' (followed by a new start)' : ''} — ${stop.id}`);
      if (stop.error) log.warn(stop.error);
      for (const node of stop.nodes) log.info(`${node.node}: ${node.outcome}${node.authority ? ` · ${node.authority.clusterId} epoch ${node.authority.epoch} (${node.authority.nodeId})` : ''}${node.reason ? ` — ${node.reason}` : ''}`);
    }

    // Infrastructure
    const infraReady = stack.infrastructure.ready;
    log.info(`Infrastructure: ${infraReady ? prism.green('ready') : prism.yellow('not ready or incompletely observed')}`);
    for (const placement of stack.placements ?? []) {
      for (const reason of placement.errors) log.warn(`${placement.nodeKey}: ${reason}`);
    }
    for (const [name, svcInfo] of Object.entries(stack.infrastructure.services)) {
      const sym = svcInfo.status === 'running' ? prism.green('●') : svcInfo.status === 'error' ? prism.red('●') : prism.dim('○');
      log.info(`  ${sym} ${name}${svcInfo.port ? ` :${svcInfo.port}` : ''} ${prism.dim(`(${svcInfo.containerName})`)}`);
    }

    // Nodes
    if (stack.nodes.length > 0) {
      table({
        width: 'auto',
        data: stack.nodes.map((n) => ({
          status: n.connected ? prism.green('observed') : prism.yellow('unobserved'),
          host: `${n.host}:${n.port}`,
          role: n.daemonRole === 'slave' ? 'slave' : 'master',
          label: n.label ?? '',
          // Read off `pendingItems`, not `connected`. `connected` reports
          // whether the slave holds a PUSH channel to the master, and that
          // path has no production caller — replication runs the other way,
          // with the master pulling — so it is false on every healthy node
          // and this cell could never print «synced».
          // Read by the console's reading (`sync-reading.ts`): «N pending»
          // was the batch waiting for the next pull on a node keeping up —
          // nearly always non-zero — and a node falling behind (entries
          // waiting, `lastSyncAt` standing still) printed exactly the same.
          sync: n.syncStatus
            ? (() => {
                const finding = syncFinding(n.syncStatus);
                const words = syncWords(finding);
                const severity = syncSeverity(finding);
                return severity === 'success' ? prism.green(words) : severity === 'warning' ? prism.yellow(words) : prism.cyan(words);
              })()
            : '',
        })),
        columns: [
          { key: 'status', header: '', width: 3 },
          { key: 'host', header: 'Host', width: 20 },
          { key: 'role', header: 'Role', width: 8 },
          { key: 'label', header: 'Label', width: 12 },
          { key: 'sync', header: 'Sync', width: 14 },
        ],
      });
    }

    if (stack.placements?.length) {
      table({
        width: 'auto',
        data: stack.placements.flatMap(node => node.apps.map(app => ({
          node: node.nodeKey,
          app: app.name,
          state: node.appsObserved ? app.process?.status ?? 'absent' : 'unknown',
          placement: app.expected ? 'expected' : 'unexpected',
          instances: app.process ? String(app.process.instances) : '--',
          pid: app.process?.pid ? String(app.process.pid) : '--',
        }))),
        columns: [
          { key: 'node', header: 'Node', width: 24 },
          { key: 'app', header: 'App', width: 20 },
          { key: 'state', header: 'State', width: 12 },
          { key: 'placement', header: 'Placement', width: 12 },
          { key: 'instances', header: 'Instances', width: 10 },
          { key: 'pid', header: 'PID', width: 8 },
        ],
      });
    }

    // Apps
    if (stack.apps.length > 0) {
      const online = stack.apps.filter((a) => a.status === 'online').length;
      log.info(`\nApps (${online}/${stack.apps.length} online)`);
      table({
        width: 'auto',
        data: stack.apps.map((a) => ({
          status: a.status === 'online' ? prism.green('●') : a.status === 'crashed' || a.status === 'errored' ? prism.red('●') : prism.dim('○'),
          health: healthLabel(a.health),
          name: a.name,
          state: a.status,
          pid: a.pid ? String(a.pid) : '--',
          uptime: a.uptime > 0 ? formatDuration(a.uptime) : '--',
        })),
        columns: [
          { key: 'status', header: '', width: 3 },
          { key: 'health', header: 'Health', width: 16 },
          { key: 'name', header: 'App', width: 24 },
          { key: 'state', header: 'Status', width: 10 },
          { key: 'pid', header: 'PID', width: 8 },
          { key: 'uptime', header: 'Uptime', width: 10 },
        ],
      });
    }
  } catch (err) {
    log.error((err as Error).message);
  } finally {
    await client.disconnect();
  }
}

/**
 * Report the end of a lifecycle command that did not return an answer.
 *
 * A timeout is not a failure. The daemon cancels nothing when the caller
 * stops waiting, so the stack is very likely still starting — saying
 * "Failed" here sends an operator to roll back work that is succeeding.
 * Observed exactly that: `stack start` reported failure at sixty seconds
 * and the six apps were all online twenty seconds later.
 *
 * The exit code stays non-zero, because "unknown" is not "fine", but the
 * message says which of the two it is.
 */
function reportLifecycleError(
  err: unknown,
  action: string,
  details: Record<string, unknown>
): void {
  if (isRequestTimeout(err)) {
    emitError(
      `Stopped waiting for ${action}. The daemon has not been told to stop — the operation is probably still running. ` +
        `Check with \`omnitron list\` or \`omnitron doctor\` before doing anything else.`,
      { ...details, outcome: 'unknown', reason: 'client-timeout' }
    );
  } else if (isLostRpcAcknowledgement(err)) {
    emitError(`Acknowledgement unavailable for ${action}: ${(err as Error).message}. Inspect the stack before retrying.`,
      { ...details, outcome: 'unknown', reason: 'connection-lost' });
  } else {
    emitError(`Failed: ${(err as Error).message}`, details);
  }
  process.exitCode = 1;
}

export async function stackPrepareReleaseCommand(project: string, stack: string, release: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const service = await client.service<IProjectRpcService>('OmnitronProject');
    const report = await service.checkRelease({ project, stack, release, prepare: true });
    const prepared = report.ok || report.state === 'requires-stop';
    if (!prepared) process.exitCode = 1;
    if (!emitJson({ project, stack, release, prepared, ...report })) {
      if (prepared) emitSuccess('Release prepared. ' + report.because);
      else emitError(report.because, { project, stack, release });
    }
  } catch (error) {
    reportLifecycleError(error, 'preparing the local release', { project, stack, release });
  } finally { await client.disconnect(); }
}

export async function stackStartCommand(
  projectName: string,
  stackName: string,
  opts?: { allowDirty?: boolean; release?: string; workingTree?: boolean; reinstall?: boolean },
): Promise<void> {
  // Starting a stack boots every app in it; a minute is not enough.
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    emitStep(`Starting stack ${projectName}/${stackName}...`);

    const stack = await svc.startStack({
      project: projectName,
      stack: stackName,
      ...(opts?.allowDirty === true ? { allowDirty: true } : {}),
      ...(opts?.release ? { release: opts.release } : {}),
      ...(opts?.workingTree === true ? { workingTree: true } : {}),
      ...(opts?.reinstall === true ? { reinstall: true } : {}),
    });
    const { confirmed, outcome, online, total, issues } = readStackStart(stack);
    if (!confirmed) process.exitCode = 1;
    if (emitJson({
      project: projectName,
      stack: stackName,
      action: 'started',
      outcome,
      status: stack.status,
      apps: stack.apps,
      online,
      total,
      infrastructure: stack.infrastructure,
      ...(stack.notUp?.length ? { notUp: stack.notUp } : {}),
      ...(issues.length ? { issues } : {}),
    })) return;

    if (confirmed) {
      emitSuccess(`Stack ${projectName}/${stackName} started — ${online}/${total} apps online`);
    } else {
      emitError(
        `Stack ${projectName}/${stackName}: ${online}/${total} apps online. ${issues.join('; ')}. ` +
          `Check \`omnitron stack diagnose ${projectName} ${stackName}\` for details.`,
        { project: projectName, stack: stackName, online, total, issues },
      );
    }

    if (stack.infrastructure.ready) {
      const svcNames = Object.keys(stack.infrastructure.services);
      if (svcNames.length > 0) {
        emitInfo(`Infrastructure: ${svcNames.join(', ')}`);
      }
    }
  } catch (err) {
    reportLifecycleError(err, `stack ${projectName}/${stackName} to start`, {
      project: projectName,
      stack: stackName,
    });
  } finally {
    await client.disconnect();
  }
}

export async function stackResumeCommand(project: string, stack: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const service = await client.service<IProjectRpcService>('OmnitronProject');
    emitStep(`Resuming the installed allocation for ${project}/${stack}…`);
    const result = await service.resumeInstalledStack({ project, stack });
    if (result.outcome !== 'running') process.exitCode = 1;
    if (emitJson(result)) return;
    emitInfo(`${project}/${stack} · ${result.outcome} · operation ${result.operationId}`);
    for (const node of result.nodes) {
      emitInfo([node.node, node.outcome, node.apps?.join(', '), node.reason].filter(Boolean).join(' · '));
    }
    if (result.outcome !== 'running') emitInfo('Inspect the node outcomes before planning another recovery.');
  } catch (error) {
    reportLifecycleError(error, `installed applications in ${project}/${stack} to resume`, { project, stack });
  } finally {
    await client.disconnect();
  }
}

export async function stackStopCommand(projectName: string, stackName: string, options: { dryRun?: boolean; review?: string; keepInfrastructure?: boolean } = {}): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    if (options.dryRun && options.review !== undefined) throw new Error('Use --review when executing a previously inspected stop');
    const scope = { project: projectName, stack: stackName, ...(options.keepInfrastructure && { keepInfrastructure: true }) };
    const report = options.dryRun || options.keepInfrastructure ? await svc.reviewStackStop(scope) : null;
    if (options.keepInfrastructure && report?.keepInfrastructure !== true)
      throw new Error('The controller did not confirm infrastructure preservation; no stop was requested. Update the controller before using --keep-infrastructure.');
    if (options.dryRun && report) {
      if (!report.digest) process.exitCode = 1;
      if (emitJson(report)) return;
      for (const target of report.targets) {
        emitInfo(target.reason ? `${target.node} · ${target.reason}` :
          `${target.node} · ${target.runtime ? `${target.runtime.project}/${target.runtime.stack}` : 'infrastructure only'} · applications: ${target.applications?.join(', ') || 'none'} · containers ${options.keepInfrastructure ? 'kept' : 'removed'}: ${target.containers?.join(', ') || 'none'}`);
      }
      if (report.digest) emitInfo(`Review digest: ${report.digest}`);
      return;
    }
    if (options.keepInfrastructure && (!report?.digest || (options.review !== undefined && options.review !== report.digest)))
      throw new Error('The current application-only stop could not be confirmed against the reviewed footprint; no stop was requested. Inspect the stack again.');
    const review = options.review ?? report?.digest;
    emitStep(`Stopping ${options.keepInfrastructure ? 'applications in' : 'stack'} ${projectName}/${stackName}...`);
    const result = await svc.stopStack({ ...scope, ...(review !== undefined && review !== null && { review }) });
    if (result.status !== 'stopped' || result.stopOperation?.phase !== 'stopped') throw new Error('Daemon did not confirm the complete stack stop');
    if (options.keepInfrastructure && result.stopOperation.keepInfrastructure !== true)
      throw new Error('Daemon did not confirm infrastructure preservation. Inspect the stop operation before retrying.');
    if (emitJson({ project: projectName, stack: stackName, action: 'stopped', operation: result.stopOperation })) return;
    for (const node of result.stopOperation.nodes) emitInfo(`${node.node}: ${node.outcome}${node.authority ? ` · ${node.authority.clusterId} epoch ${node.authority.epoch} (${node.authority.nodeId})` : ''}${node.observedAt ? ` at ${node.observedAt}` : ''}`);
    emitSuccess(options.keepInfrastructure ? `Applications in ${projectName}/${stackName} stopped; infrastructure retained` : `Stack ${projectName}/${stackName} stopped`);
  } catch (err) {
    reportLifecycleError(err, `stack ${projectName}/${stackName} to stop`, {
      project: projectName,
      stack: stackName,
    });
  } finally {
    await client.disconnect();
  }
}

/** Why these `stack account` options say no one thing to do — or `null`. */
export function accountOptionsRefusal(options: {
  username?: string;
  show?: string;
  remove?: string;
  census?: boolean;
  leftovers?: boolean | string;
  also?: string;
  id?: string;
  role?: string;
  displayName?: string;
  vaultKey?: string;
}): string | null {
  const modes = [
    ...(['username', 'show', 'remove'] as const).filter((m) => options[m] !== undefined),
    ...(options.census ? ['census'] : []),
    ...(options.leftovers !== undefined && options.leftovers !== false ? ['leftovers'] : []),
  ];
  if (modes.length !== 1) {
    return 'Say exactly one of --username <name> (make), --show <name>, --remove <name> --id <uuid>, --census, --leftovers';
  }
  const extras = options.id !== undefined || options.role !== undefined || options.displayName !== undefined || options.vaultKey !== undefined;
  if (options.census && extras) return '--census takes nothing else';
  if (options.leftovers && extras) return '--leftovers takes nothing but its mode and --also';
  if (
    options.leftovers !== undefined &&
    options.leftovers !== true &&
    options.leftovers !== 'census' &&
    options.leftovers !== 'rehearse' &&
    options.leftovers !== 'apply'
  ) {
    return `--leftovers takes census, rehearse or apply — '${String(options.leftovers)}' is not asked for from here`;
  }
  if (options.also !== undefined && !options.leftovers) return '--also goes with --leftovers';
  if (options.remove !== undefined && !options.id) return '--remove needs --id <uuid> — the id --show prints';
  if (options.remove === undefined && options.id !== undefined) return '--id goes with --remove';
  if (options.username === undefined && (options.role !== undefined || options.displayName !== undefined)) {
    return '--role and --display-name go with --username';
  }
  if (options.show !== undefined && options.vaultKey !== undefined) return '--vault-key goes with --username or --remove';
  return null;
}

/**
 * `omnitron stack maintenance <project> <stack> [status|on|off]` — the stack's
 * maintenance lock at its gateway, as the gateway enforces it. `on` holds the
 * platform for `--minutes` (default 15, at most 60) and lets go by itself;
 * `off` lets go now — also a lock a failed deployment left behind.
 */
export async function stackMaintenanceCommand(
  projectName: string,
  stackName: string,
  action: string | undefined,
  options: { minutes?: string },
): Promise<void> {
  const verb = (action ?? 'status') as 'status' | 'on' | 'off';
  if (verb !== 'status' && verb !== 'on' && verb !== 'off') {
    emitError(`'${action}' is not a maintenance action — status, on or off`, { project: projectName, stack: stackName });
    process.exitCode = 1;
    return;
  }
  const minutes = options.minutes === undefined ? undefined : Number(options.minutes);
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    if (verb !== 'status') {
      emitStep(verb === 'on' ? `Holding ${projectName}/${stackName} for ${minutes ?? 15} min…` : `Letting ${projectName}/${stackName} go…`);
    }
    const state = await svc.stackMaintenance({
      project: projectName,
      stack: stackName,
      action: verb,
      ...(minutes !== undefined ? { minutes } : {}),
    });
    if (emitJson(state)) return;
    if (state.active) {
      log.warn(
        `${state.where}: HELD (${state.reason ?? 'unknown'})` +
          (state.retryAfter !== null ? ` — callers are told to retry in ${state.retryAfter} s` : '') +
          (state.message ? ` — «${state.message}»` : ''),
      );
      if (state.reason === 'admin') emitInfo('The administrators\' mode is switched in /admin, not from here.');
    } else if (state.notice) {
      emitInfo(`${state.where}: open; maintenance (${state.notice.reason}) announced in ${state.notice.startsIn} s`);
    } else {
      emitSuccess(`${state.where}: open`);
    }
  } catch (err) {
    emitError(err instanceof Error ? err.message : String(err), { project: projectName, stack: stackName });
    process.exitCode = 1;
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

/**
 * `omnitron stack account` — accounts on a remote stack's stand, by the
 * project's own tool on the node:
 *
 *   --username <name>          make one; its password goes to the daemon's
 *                              vault, and the command that reads it is
 *                              printed — never the password
 *   --show <name>              what the stand holds under a name
 *   --remove <name> --id <id>  take one away, with its password in the vault
 */
export async function stackAccountCommand(
  projectName: string,
  stackName: string,
  options: {
    username?: string;
    show?: string;
    remove?: string;
    census?: boolean;
    leftovers?: boolean | string;
    also?: string;
    id?: string;
    role?: string;
    displayName?: string;
    vaultKey?: string;
  },
): Promise<void> {
  const refusal = accountOptionsRefusal(options);
  if (refusal) {
    emitError(refusal, { project: projectName, stack: stackName });
    process.exitCode = 1;
    return;
  }

  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  const name = options.username ?? options.show ?? options.remove ?? 'accounts';
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    if (options.leftovers) {
      const mode = options.leftovers === 'rehearse' || options.leftovers === 'apply' ? options.leftovers : 'census';
      const also = (options.also ?? '').split(',').map((u) => u.trim()).filter(Boolean);
      const what =
        mode === 'census'
          ? 'census of what the probes left'
          : mode === 'rehearse'
            ? 'rehearsal of removing what the probes left'
            : 'removal of what the probes left';
      emitStep(
        `Taking the ${what} on ${projectName}/${stackName} — the project's tool, on the node; ` +
          `${mode === 'apply' ? 'committed only where nothing of somebody who stays would go' : 'nothing is removed'}…`,
      );
      const found = await svc.probeLeftovers({ project: projectName, stack: stackName, mode, ...(also.length > 0 ? { also } : {}) });
      if (emitJson(found)) return;
      // The tool's own words: it names what it would take and what holds each
      // back, and omnitron knows none of its questions.
      for (const line of found.lines) emitInfo(line);
      emitSuccess(
        `${what} on ${projectName}/${stackName} at ${found.node} — the tool at ${found.commit.slice(0, 8)}` +
          `${also.length > 0 ? `, named: ${also.join(', ')}` : ''}` +
          `${mode === 'apply' ? '; committed where its invariants held — the tool\'s lines above say what went' : '; nothing was removed'}`,
      );
      return;
    }
    if (options.census) {
      emitStep(`Counting the accounts on ${projectName}/${stackName} — the project's tool, on the node…`);
      const counted = await svc.censusStackAccounts({ project: projectName, stack: stackName });
      if (emitJson(counted)) return;
      const c = counted.census;
      const list = (counts: Readonly<Record<string, number>>) =>
        Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
      emitSuccess(`${projectName}/${stackName} at ${counted.node}: ${c.users} account(s)`);
      emitInfo(`  roles: ${list(c.byRole)}`);
      emitInfo(`  status: ${list(c.byStatus)}`);
      emitInfo(
        `  MFA: ${c.mfa.totpEnabled} enabled · ${c.mfa.totpSecretEncrypted} secret(s) sealed · ` +
          `${c.mfa.totpSecretPlain} plain · ${c.mfa.backupCodes} with backup codes`,
      );
      const a = c.seededAdmin;
      emitInfo(
        `  seeded admin: ${
          !a.present
            ? 'absent'
            : `${a.status ?? '?'}, ${a.role ?? '?'}, ${
                a.publishedPassword === null
                  ? 'password not checkable here'
                  : a.publishedPassword
                    ? 'opens with the PUBLISHED password'
                    : 'password changed'
              }`
        }`,
      );
      const p = c.privileged;
      emitInfo(
        p
          ? `  privileged: ${p.accounts} (made: ${Object.entries(p.byCreatedDay).map(([d, n]) => `${d} ${n}`).join(', ') || 'none'}) · ` +
              `${p.openWithPublishedPassword ?? '?'} open with a password the repository publishes · ${p.signedIn} ever signed in`
          : '  privileged: not counted by the tool at this commit',
      );
      const k = c.keyedOnJwtSecret;
      const live = k ? Object.values(k.pickupCodesLive).reduce((sum, n) => sum + n, 0) : 0;
      emitInfo(
        k
          ? `  keyed on JWT_SECRET: ${live} live pickup code(s)${live ? ` (${list(k.pickupCodesLive)})` : ''} a new key could not find`
          : '  keyed on JWT_SECRET: not counted by the tool at this commit',
      );
      for (const [question, n] of Object.entries(c.counts ?? {})) emitInfo(`  ${question}: ${n}`);
      return;
    }
    if (options.show !== undefined) {
      emitStep(`Reading ${name} on ${projectName}/${stackName} — the project's tool, on the node…`);
      const found = await svc.showStackAccount({ project: projectName, stack: stackName, username: name });
      if (emitJson(found)) return;
      const a = found.account;
      if (!a) {
        emitInfo(`${projectName}/${stackName} (${found.node}) holds no ${name}`);
        return;
      }
      emitSuccess(`${a.username} on ${projectName}/${stackName} at ${found.node}: ${a.role}, ${a.status ?? 'no status'}`);
      emitInfo(`  id ${a.id}`);
      emitInfo(`  made ${a.createdAt ?? '(unknown)'}; ${a.lastActiveAt ? `last active ${a.lastActiveAt}` : 'never signed in'}`);
      return;
    }
    if (options.remove !== undefined) {
      emitStep(`Taking ${name} (id ${options.id}) away from ${projectName}/${stackName}…`);
      const removed = await svc.removeStackAccount({
        project: projectName,
        stack: stackName,
        username: name,
        id: options.id!,
        ...(options.vaultKey !== undefined ? { vaultKey: options.vaultKey } : {}),
      });
      if (emitJson(removed)) return;
      emitSuccess(`Removed ${removed.username} (id ${removed.id}) from ${projectName}/${stackName} at ${removed.node}`);
      emitInfo(
        removed.vaultKeyRemoved
          ? `  and its password from the vault (${removed.vaultKeyRemoved})`
          : '  the vault kept no password for it',
      );
      return;
    }
    emitStep(`Making ${name} on ${projectName}/${stackName} — the project's tool, on the node, under its deploy lease…`);
    const made = await svc.createStackAccount({
      project: projectName,
      stack: stackName,
      username: name,
      ...(options.role !== undefined ? { role: options.role } : {}),
      ...(options.displayName !== undefined ? { displayName: options.displayName } : {}),
      ...(options.vaultKey !== undefined ? { vaultKey: options.vaultKey } : {}),
    });
    if (emitJson(made)) return;
    emitSuccess(`Made ${made.username} (${made.role}) on ${projectName}/${stackName} at ${made.node}`);
    emitInfo(`  its password is in this daemon's vault, and only there — read it with:`);
    emitInfo(`omnitron secret get ${made.vaultKey}`);
    emitInfo(`  id ${made.id}; made by the project's tool at ${made.commit.slice(0, 8)}`);
  } catch (err) {
    const verb = options.census || options.leftovers ? 'count' : options.show !== undefined ? 'read' : options.remove !== undefined ? 'remove' : 'make';
    emitError(`Could not ${verb} ${name} on ${projectName}/${stackName}: ${(err as Error).message}`, {
      project: projectName,
      stack: stackName,
      username: name,
    });
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

export async function stackCreateCommand(
  projectName: string,
  stackName: string,
  options: { type?: string; apps?: string },
): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    const type = (options.type ?? 'local') as 'local' | 'remote' | 'cluster';
    const apps: string[] | 'all' = options.apps === 'all' || !options.apps ? 'all' : options.apps.split(',');

    log.step(`Creating stack ${projectName}/${stackName}...`);
    const stack = await svc.createStack({ project: projectName, name: stackName, type, apps });
    log.success(`Stack ${projectName}/${stackName} created (${stack.type})`);

    const infraConfig = stack.config?.infrastructure as any;
    if (infraConfig?.postgres) {
      const dbs = Object.keys(infraConfig.postgres.databases ?? {});
      log.info(`PostgreSQL: ${dbs.length} databases (${dbs.join(', ')})`);
    }
    if (infraConfig?.redis) {
      const allocations = Object.keys(infraConfig.redis.databases ?? {});
      log.info(`Redis: ${allocations.length} DB allocations`);
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function stackDeleteCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    log.step(`Deleting stack ${projectName}/${stackName}...`);
    await svc.deleteStack({ project: projectName, stack: stackName });
    log.success(`Stack ${projectName}/${stackName} deleted`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function stackRuntimeCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    const runtime = await svc.getStackStatus({ project: projectName, stack: stackName });
    if (!emitJson(runtime)) console.log(JSON.stringify(runtime, null, 2));
  } catch (err) {
    emitError((err as Error).message);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}

/** Exit 1 for blockers, 2 for incomplete evidence; a planned create/pull is not a failure. */
export async function stackDiagnoseCommand(project: string, stack: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const service = await client.service<IProjectRpcService>('OmnitronProject');
    const report = await service.diagnoseStack({ project, stack });
    if (isJsonMode()) emitJson(report);
    else {
      log.info(`${project}/${stack}: ${report.status} — checked ${report.checkedAt}`);
      for (const check of report.checks) {
        log.info(`[${check.state}] ${check.resource}: ${check.message}`);
        if (check.action) log.info(`  ${check.action}`);
      }
      log.info(`Not verified: ${report.deferred.join('; ')}.`);
    }
    process.exitCode = report.status === 'blocked' ? 1 : report.status === 'unknown' ? 2 : 0;
  } catch (error) { emitError((error as Error).message); process.exitCode = 2; }
  finally { await client.disconnect(); }
}
