/**
 * `stack start` must consult what is running, not what it once recorded.
 *
 * A stack carries a `StackRuntimeState` whose `status` is set to `running`
 * when the stack starts and revised only when someone stops it. Nothing
 * revises it when the apps underneath die, so after a stand fell over the
 * record still said `running` — and `startStack` returned on the strength of
 * that record without touching a single app.
 *
 * The response it returned was built by `toStackInfo`, which reads live
 * orchestrator statuses. So the object handed back already said how many apps
 * were up. Both halves travelled together and nothing compared them: the CLI
 * printed `Stack daos/dev started — 0/6 apps online` under a success glyph and
 * exited 0. Observed exactly that, twice in a row, on a stack where every app
 * was `crashed`.
 *
 * Two properties, one per half of the report:
 *   - a stack marked running whose apps are down gets started;
 *   - a stack whose apps really are up is still left alone, so the idempotent
 *     case does not turn into a restart storm.
 */

import { describe, it, expect, vi } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

const STACK = { type: 'local', apps: ['main'] } as any;

/**
 * A ProjectService wired to stubs, with the stack already recorded as
 * `running` — the state a fallen-over stand is in.
 */
function service(appStatus: 'online' | 'crashed') {
  const started: string[] = [];
  const orchestrator: any = {
    list: () => [{ name: 'demo/dev/main', status: appStatus, pid: 1234 }],
    listHandleNames: () => ['demo/dev/main'],
    stopApp: async () => {},
  };
  const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(logger, orchestrator, stateStore);

  svc.loadProjectConfig = async () => ({ apps: [{ name: 'main', script: './main.js' }] });
  svc.getLoadedConfig = () => ({ apps: [{ name: 'main', script: './main.js' }] });
  svc.resolveStacks = () => ({ dev: STACK });
  svc.resolveStackApps = () => [{ name: 'main', script: './main.js' }];
  svc.updateEnabledStacks = () => {};
  // The seam a real start goes through; record that it was reached.
  svc.startLocalStack = async () => { started.push('local'); };

  svc.stackStates.set('demo/dev', {
    project: 'demo',
    stack: 'dev',
    status: 'running',
    config: STACK,
    startedAt: Date.now(),
    infraService: null,
  });

  return { svc, started };
}

describe('stack start against a stack whose record outlived its apps', () => {
  it('starts the apps instead of reporting the stale record back', async () => {
    const { svc, started } = service('crashed');

    const info = await svc.startStack('demo', 'dev');

    expect(started, 'a stack whose apps are down must actually be started').toEqual(['local']);
    expect(
      info.apps.every((a: any) => a.status === 'online'),
      'and the report must not claim online apps that are not',
    ).toBe(false);
  });

  it('leaves a genuinely running stack alone', async () => {
    const { svc, started } = service('online');

    await svc.startStack('demo', 'dev');

    expect(started, 'an already-running stack must not be restarted').toEqual([]);
  });
});
