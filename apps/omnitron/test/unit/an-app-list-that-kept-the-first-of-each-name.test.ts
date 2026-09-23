/**
 * An app list that kept the first of each name.
 *
 * `getProjectApps` flattened a project's stacks and dropped every app whose
 * name it had already seen. The daos project runs the same six apps in a
 * local `dev` and a remote `test` stack, so it answered with dev's six —
 * measured on the master 2026-09-23, six records, every one `daos/dev/*` —
 * and the console's /apps showed six rows for twelve deployments, none of
 * them on the node. It read the stacks without asking the nodes, too, so
 * test's apps would have read `stopped` had they survived the dedup.
 */

import { describe, it, expect } from 'vitest';

import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import type { IStackAppStatus, IStackInfo } from '../../src/shared/dto/project.js';

const app = (handleKey: string, status: IStackAppStatus['status']): IStackAppStatus => ({
  name: handleKey.slice(handleKey.lastIndexOf('/') + 1),
  handleKey,
  status,
  pid: status === 'online' ? 4242 : null,
  instances: status === 'online' ? 1 : 0,
  uptime: 0,
  restarts: 0,
  cpu: 0,
  memory: 0,
  port: null,
});

const stack = (name: string, type: IStackInfo['type'], apps: IStackAppStatus[]) =>
  ({ name, type, apps }) as unknown as IStackInfo;

/** A project with a local dev stack and a remote test stack, both running main and paysys. */
const projectService = {
  // Loaded already: `listStacks` asks for the project's config first (60362827).
  ensureConfig: async () => undefined,
  listStacks: () => [
    stack('dev', 'local', [app('daos/dev/main', 'online'), app('daos/dev/paysys', 'online')]),
    // As this daemon sees a remote stack: no handles of its own, so stopped.
    stack('test', 'remote', [app('daos/test/main', 'stopped'), app('daos/test/paysys', 'stopped')]),
  ],
  // As the node answers: its own naming, and the apps running.
  withRemoteAppStatuses: async (_project: string, info: IStackInfo) =>
    info.type === 'local'
      ? info
      : { ...info, apps: info.apps.map((a) => app(`daos/deployed/${a.name}`, 'online')) },
};

describe('an app list that kept the first of each name', () => {
  it('lists every deployment of every app, each with its stack, the nodes asked', async () => {
    const rpc = new ProjectRpcService(projectService as never);

    const apps = await rpc.getProjectApps({ project: 'daos' });

    expect(apps.map((a) => [a.stack, a.stackType, a.name, a.handleKey, a.status])).toEqual([
      ['dev', 'local', 'main', 'daos/dev/main', 'online'],
      ['dev', 'local', 'paysys', 'daos/dev/paysys', 'online'],
      ['test', 'remote', 'main', 'daos/deployed/main', 'online'],
      ['test', 'remote', 'paysys', 'daos/deployed/paysys', 'online'],
    ]);
  });
});
