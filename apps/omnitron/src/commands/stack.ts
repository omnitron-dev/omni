/**
 * Stack CLI Commands — manage stacks on the running daemon
 *
 * Uses typed Netron service proxies and @xec-sh/kit for TUI output.
 */

import { log, table, note, prism } from '@xec-sh/kit';
import { createDaemonClient, LONG_REQUEST_TIMEOUT, isRequestTimeout } from '../daemon/daemon-client.js';
import type { IProjectRpcService } from '../shared/dto/services.js';
import { emitJson, emitError, emitStep, emitSuccess, emitInfo, isJsonMode } from './output.js';
import { syncFinding, syncWords, inSync } from '../shared/sync-reading.js';

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
          name: s.name,
          type: s.type === 'local' ? 'local' : s.type === 'remote' ? 'remote(ssh)' : 'cluster',
          apps: `${s.apps.filter((a) => a.status === 'online').length}/${s.apps.length}`,
          nodes: `${s.nodes.filter((n) => n.connected).length}/${s.nodes.length}`,
          uptime: s.uptime > 0 ? formatDuration(s.uptime) : prism.dim('--'),
        })),
        columns: [
          { key: 'status', header: 'Status', width: 14 },
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

export async function stackStatusCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    const stack = await svc.getStack({ project: projectName, stack: stackName });

    const typeLabel = stack.type === 'local' ? 'local' : stack.type === 'remote' ? 'remote(ssh)' : 'cluster';
    note(
      [
        `${prism.bold(`${projectName}/${stack.name}`)}  ${prism.dim(typeLabel)}`,
        `Status: ${statusIcon(stack.status)} ${stack.status}`,
        ...(stack.startedAt ? [`Started: ${stack.startedAt}`] : []),
        ...(stack.uptime > 0 ? [`Uptime: ${formatDuration(stack.uptime)}`] : []),
        // When this master took charge of it — not when it started.
        ...(stack.attachedAt ? [`Attached: ${stack.attachedAt}`] : []),
        ...(stack.portRange ? [`Ports: ${stack.portRange.start}–${stack.portRange.end}`] : []),
      ].join('\n'),
      'Stack'
    );

    // Infrastructure
    const infraReady = stack.infrastructure.ready;
    log.info(`Infrastructure: ${infraReady ? prism.green('ready') : prism.dim('not provisioned')}`);
    for (const [name, svcInfo] of Object.entries(stack.infrastructure.services)) {
      const sym = svcInfo.status === 'running' ? prism.green('●') : svcInfo.status === 'error' ? prism.red('●') : prism.dim('○');
      log.info(`  ${sym} ${name}${svcInfo.port ? ` :${svcInfo.port}` : ''} ${prism.dim(`(${svcInfo.containerName})`)}`);
    }

    // Nodes
    if (stack.nodes.length > 0) {
      table({
        width: 'auto',
        data: stack.nodes.map((n) => ({
          status: n.connected ? prism.green('●') : prism.dim('○'),
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
                return inSync(finding) ? prism.green(words) : prism.red(words);
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

    // Apps
    if (stack.apps.length > 0) {
      const online = stack.apps.filter((a) => a.status === 'online').length;
      log.info(`\nApps (${online}/${stack.apps.length} online)`);
      table({
        width: 'auto',
        data: stack.apps.map((a) => ({
          status: a.status === 'online' ? prism.green('●') : a.status === 'crashed' || a.status === 'errored' ? prism.red('●') : prism.dim('○'),
          name: a.name,
          state: a.status,
          pid: a.pid ? String(a.pid) : '--',
          uptime: a.uptime > 0 ? formatDuration(a.uptime) : '--',
        })),
        columns: [
          { key: 'status', header: '', width: 3 },
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
  } else {
    emitError(`Failed: ${(err as Error).message}`, details);
  }
  process.exitCode = 1;
}

export async function stackStartCommand(
  projectName: string,
  stackName: string,
  opts?: { allowDirty?: boolean; release?: string },
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
    });
    const online = stack.apps.filter((a) => a.status === 'online').length;

    if (emitJson({
      project: projectName,
      stack: stackName,
      action: 'started',
      apps: stack.apps,
      online,
      total: stack.apps.length,
      infrastructure: stack.infrastructure,
      ...(stack.notUp?.length ? { notUp: stack.notUp } : {}),
    })) {
      if (stack.notUp?.length || online < stack.apps.length) process.exitCode = 1;
      return;
    }

    // Beyond the apps: a node skipped, infrastructure not up. bitcoind failed
    // to start on the test node and this printed «6/6 apps online», exit 0.
    const notUp = stack.notUp ?? [];
    if (notUp.length > 0) {
      emitError(
        `Stack ${projectName}/${stackName}: started with parts not up — ${notUp.join('; ')}. ` +
          `Check \`omnitron infra inspect ${projectName}/${stackName}\`.`,
        { project: projectName, stack: stackName, notUp },
      );
      process.exitCode = 1;
    }

    if (online < stack.apps.length) {
      // Reporting a partial start as success is how a dead stack passes for a
      // live one in a script. The count was always printed; it was printed
      // under a success glyph and a zero exit code, so nothing downstream
      // could tell 6/6 from 0/6.
      const down = stack.apps
        .filter((a) => a.status !== 'online')
        .map((a) => `${a.name} (${a.status})`);
      emitError(
        `Stack ${projectName}/${stackName}: only ${online}/${stack.apps.length} apps came online. ` +
          `Not online: ${down.join(', ')}. Check \`omnitron logs <app>\` or \`omnitron doctor\`.`,
        { project: projectName, stack: stackName, online, total: stack.apps.length }
      );
      process.exitCode = 1;
    } else {
      emitSuccess(`Stack ${projectName}/${stackName} started — ${online}/${stack.apps.length} apps online`);
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

export async function stackStopCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    emitStep(`Stopping stack ${projectName}/${stackName}...`);
    await svc.stopStack({ project: projectName, stack: stackName });
    if (emitJson({ project: projectName, stack: stackName, action: 'stopped' })) return;
    emitSuccess(`Stack ${projectName}/${stackName} stopped`);
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
  id?: string;
  role?: string;
  displayName?: string;
  vaultKey?: string;
}): string | null {
  const modes = [
    ...(['username', 'show', 'remove'] as const).filter((m) => options[m] !== undefined),
    ...(options.census ? ['census'] : []),
  ];
  if (modes.length !== 1) {
    return 'Say exactly one of --username <name> (make), --show <name>, --remove <name> --id <uuid>, --census';
  }
  if (options.census && (options.id !== undefined || options.role !== undefined || options.displayName !== undefined || options.vaultKey !== undefined)) {
    return '--census takes nothing else';
  }
  if (options.remove !== undefined && !options.id) return '--remove needs --id <uuid> — the id --show prints';
  if (options.remove === undefined && options.id !== undefined) return '--id goes with --remove';
  if (options.username === undefined && (options.role !== undefined || options.displayName !== undefined)) {
    return '--role and --display-name go with --username';
  }
  if (options.show !== undefined && options.vaultKey !== undefined) return '--vault-key goes with --username or --remove';
  return null;
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
    const verb = options.census ? 'count' : options.show !== undefined ? 'read' : options.remove !== undefined ? 'remove' : 'make';
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
    console.log(JSON.stringify(runtime, null, 2));
  } catch (err) {
    log.error((err as Error).message);
  } finally {
    await client.disconnect();
  }
}
