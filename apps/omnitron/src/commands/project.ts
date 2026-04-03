/**
 * Project CLI Commands
 *
 *   omnitron project add <name> <path>
 *   omnitron project list
 *   omnitron project remove <name>
 */

import { log, table } from '@xec-sh/kit';
import { ProjectRegistry } from '../project/registry.js';

export async function projectAddCommand(name: string, projectPath: string): Promise<void> {
  const registry = new ProjectRegistry();
  try {
    const project = registry.add(name, projectPath);
    log.success(`Project '${project.name}' registered at ${project.path}`);
  } catch (err) {
    log.error((err as Error).message);
  }
}

export async function projectListCommand(): Promise<void> {
  const registry = new ProjectRegistry();
  const projects = registry.list();

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
      stacks: p.enabledStacks?.length ? `${p.enabledStacks.length} running` : '--',
      registered: p.registeredAt.slice(0, 10),
    })),
    columns: [
      { key: 'name', header: 'Name', width: 16 },
      { key: 'path', header: 'Path', width: 50 },
      { key: 'stacks', header: 'Stacks', width: 12 },
      { key: 'registered', header: 'Registered', width: 12 },
    ],
  });
}

export async function projectRemoveCommand(name: string): Promise<void> {
  const registry = new ProjectRegistry();
  try {
    registry.remove(name);
    log.success(`Project '${name}' removed`);
  } catch (err) {
    log.error((err as Error).message);
  }
}
