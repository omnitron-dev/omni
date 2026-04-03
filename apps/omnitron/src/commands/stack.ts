/**
 * Stack CLI Commands — manage stacks on the running daemon
 *
 * Uses typed Netron service proxies and @xec-sh/kit for TUI output.
 */

import { log, table, note, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IProjectRpcService } from '../shared/dto/services.js';

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

    for (const project of filtered) {
      const stacks = await svc.listStacks({ project: project.name });

      note(`${prism.bold(project.name)}  ${prism.dim(project.path)}`);

      if (stacks.length === 0) {
        log.info(prism.dim('No stacks configured'));
        continue;
      }

      table({
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
        data: stack.nodes.map((n) => ({
          status: n.connected ? prism.green('●') : prism.dim('○'),
          host: `${n.host}:${n.port}`,
          role: n.daemonRole === 'slave' ? 'slave' : 'master',
          label: n.label ?? '',
          sync: n.syncStatus
            ? n.syncStatus.connected ? prism.green('synced') : `${n.syncStatus.pendingItems} pending`
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

export async function stackStartCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    log.step(`Starting stack ${projectName}/${stackName}...`);

    const stack = await svc.startStack({ project: projectName, stack: stackName });
    const online = stack.apps.filter((a) => a.status === 'online').length;
    log.success(`Stack ${projectName}/${stackName} started — ${online}/${stack.apps.length} apps online`);

    if (stack.infrastructure.ready) {
      const svcNames = Object.keys(stack.infrastructure.services);
      if (svcNames.length > 0) {
        log.info(`Infrastructure: ${svcNames.join(', ')}`);
      }
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  } finally {
    await client.disconnect();
  }
}

export async function stackStopCommand(projectName: string, stackName: string): Promise<void> {
  const client = createDaemonClient();
  try {
    const svc = await client.service<IProjectRpcService>('OmnitronProject');
    log.step(`Stopping stack ${projectName}/${stackName}...`);
    await svc.stopStack({ project: projectName, stack: stackName });
    log.success(`Stack ${projectName}/${stackName} stopped`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
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
