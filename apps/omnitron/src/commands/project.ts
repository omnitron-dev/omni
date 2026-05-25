/**
 * Project CLI Commands
 *
 *   omnitron project add <name> <path>
 *   omnitron project list
 *   omnitron project remove <name>
 *
 * Goes through the daemon RPC when reachable so its in-memory state stays
 * authoritative; falls back to direct registry edits when the daemon is
 * offline (bootstrap flow: register, then start the daemon).
 */

import { log, table } from '@xec-sh/kit';
import { ProjectRegistry } from '../project/registry.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IProjectRpcService, IProjectInfo } from '../shared/dto/services.js';

async function withProjectService<T>(
  online: (svc: IProjectRpcService) => Promise<T>,
  offline: () => T | Promise<T>,
): Promise<T> {
  const client = createDaemonClient();
  try {
    if (await client.isReachable()) {
      const svc = await client.service<IProjectRpcService>('OmnitronProject');
      return await online(svc);
    }
    return await offline();
  } finally {
    await client.disconnect();
  }
}

export async function projectAddCommand(name: string, projectPath: string): Promise<void> {
  try {
    const project = await withProjectService(
      (svc) => svc.addProject({ name, path: projectPath }),
      () => {
        const added = ProjectRegistry.open().add(name, projectPath);
        return {
          name: added.name,
          displayName: added.name,
          path: added.path,
          registeredAt: added.registeredAt,
          enabledStacks: added.enabledStacks ?? [],
          runningStacks: 0,
          totalStacks: 0,
        } satisfies IProjectInfo;
      },
    );
    log.success(`Project '${project.name}' registered at ${project.path}`);
  } catch (err) {
    log.error((err as Error).message);
  }
}

export async function projectListCommand(): Promise<void> {
  try {
    const { projects, online } = await withProjectService(
      async (svc) => ({ projects: await svc.listProjects(), online: true }),
      () => {
        const seeds = ProjectRegistry.open().list();
        const projects = seeds.map<IProjectInfo>((p) => ({
          name: p.name,
          displayName: p.name,
          path: p.path,
          registeredAt: p.registeredAt,
          enabledStacks: p.enabledStacks ?? [],
          runningStacks: 0,
          totalStacks: 0,
        }));
        return { projects, online: false };
      },
    );

    if (projects.length === 0) {
      log.info('No projects registered.');
      log.info('Register one: omnitron project add <name> <path>');
      log.info('Or run from a directory with omnitron.config.ts — auto-detected on startup.');
      return;
    }

    table({
      data: projects.map((p) => ({
        name: p.name,
        path: p.path,
        stacks: online
          ? `${p.runningStacks}/${p.totalStacks}`
          : '—',
        registered: p.registeredAt.slice(0, 10),
      })),
      columns: [
        { key: 'name', header: 'Name', width: 16 },
        { key: 'path', header: 'Path', width: 50 },
        { key: 'stacks', header: 'Stacks (live/total)', width: 20 },
        { key: 'registered', header: 'Registered', width: 12 },
      ],
    });
  } catch (err) {
    log.error((err as Error).message);
  }
}

export async function projectRemoveCommand(name: string): Promise<void> {
  try {
    await withProjectService(
      (svc) => svc.removeProject({ name }),
      () => {
        ProjectRegistry.open().remove(name);
        return { success: true };
      },
    );
    log.success(`Project '${name}' removed`);
  } catch (err) {
    log.error((err as Error).message);
  }
}
