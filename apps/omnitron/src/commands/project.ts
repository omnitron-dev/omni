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

import os from 'node:os';

import { log, table } from '@xec-sh/kit';
import { ProjectRegistry } from '../project/registry.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IProjectRpcService, IProjectInfo } from '../shared/dto/services.js';
import { emitJson } from './output.js';

/** Width of the Path column in `project list`. */
const PATH_WIDTH = 50;
const ELLIPSIS = '...';

/**
 * A path as the Path column shows it: the home directory as `~`, and when it
 * is still wider than the column, its END — whole trailing segments after an
 * ellipsis — because the end is what tells two projects apart.
 *
 * The table cuts a cell on the right. Measured 2026-09-23: both registered
 * projects printed as `/Users/taaliman/projects/luxquant/omnitron-dev/...` —
 * one string twice, for `…/omni/internal/daos` and `…/omni/apps/omnitron`:
 * 65 characters each, the first 52 shared, and the column showed 47. With
 * `~` they are still 51 characters each, so the tail is kept by cutting on
 * the left: `.../luxquant/omnitron-dev/omni/internal/daos`.
 *
 * Only the table: `--json` carries the full path.
 */
export function displayPath(fullPath: string, width: number, home: string = os.homedir()): string {
  const inHome = home !== '' && (fullPath === home || fullPath.startsWith(`${home}/`));
  const shown = inHome ? `~${fullPath.slice(home.length)}` : fullPath;
  if (shown.length <= width) return shown;

  const segments = shown.split('/');
  let tail = segments.pop() ?? '';
  while (segments.length > 0) {
    const next = `${segments[segments.length - 1]}/${tail}`;
    if (ELLIPSIS.length + 1 + next.length > width) break;
    tail = next;
    segments.pop();
  }
  const cut = `${ELLIPSIS}/${tail}`;
  // A last segment wider than the column on its own: its end, by characters.
  return cut.length <= width ? cut : `${ELLIPSIS}${shown.slice(-(width - ELLIPSIS.length))}`;
}

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
    const project = await withProjectService<IProjectInfo>(
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
    log.success(
      project.reread
        ? `Project '${project.name}' at ${project.path} read again — ${project.reread.redefined} running app(s) take the new definition on their next start`
        : `Project '${project.name}' registered at ${project.path}`,
    );
  } catch (err) {
    log.error((err as Error).message);
    // All three commands here printed the error and exited 0, so a
    // registration that failed read to a script as one that succeeded.
    process.exitCode = 1;
  }
}

export async function projectListCommand(): Promise<void> {
  try {
    const { projects, online } = await withProjectService(
      async (svc) => ({ projects: await svc.listProjects(), online: true }),
      () => {
        const seeds = ProjectRegistry.open().list();
        const fromRegistry = seeds.map<IProjectInfo>((p) => ({
          name: p.name,
          displayName: p.name,
          path: p.path,
          registeredAt: p.registeredAt,
          enabledStacks: p.enabledStacks ?? [],
          runningStacks: 0,
          totalStacks: 0,
        }));
        return { projects: fromRegistry, online: false };
      },
    );

    // `online` says whether these numbers came from the daemon or from the
    // on-disk registry, which is the difference between "no stacks running"
    // and "we could not ask".
    if (emitJson({ projects, online })) return;

    if (projects.length === 0) {
      log.info('No projects registered.');
      log.info('Register one: omnitron project add <name> <path>');
      log.info('Or run from a directory with omnitron.config.ts — auto-detected on startup.');
      return;
    }

    table({
      width: 'auto',
      data: projects.map((p) => ({
        name: p.name,
        path: displayPath(p.path, PATH_WIDTH),
        stacks: online
          ? `${p.runningStacks}/${p.totalStacks}`
          : '—',
        registered: p.registeredAt.slice(0, 10),
      })),
      columns: [
        { key: 'name', header: 'Name', width: 16 },
        { key: 'path', header: 'Path', width: PATH_WIDTH },
        { key: 'stacks', header: 'Stacks (live/total)', width: 20 },
        { key: 'registered', header: 'Registered', width: 12 },
      ],
    });
  } catch (err) {
    log.error((err as Error).message);
    process.exitCode = 1;
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
    process.exitCode = 1;
  }
}
