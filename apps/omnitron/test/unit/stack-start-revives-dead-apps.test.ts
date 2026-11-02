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
 * printed `Stack acme/dev started — 0/6 apps online` under a success glyph and
 * exited 0. Observed exactly that, twice in a row, on a stack where every app
 * was `crashed`.
 *
 * Two properties, one per half of the report:
 *   - a stack marked running whose apps are down gets started;
 *   - a stack whose apps really are up is still left alone, so the idempotent
 *     case does not turn into a restart storm.
 */

import { describe, it, expect, vi } from 'vitest';

import { readStackStart } from '../../src/shared/release-reading.js';
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
    enableStackExecution: async () => {},
  };
  const stateStore: any = { selectProjectsSync: () => [], kvGetSync: () => null, save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(logger, orchestrator, stateStore);

  svc.loadProjectConfig = async () => ({ apps: [{ name: 'main', script: './main.js' }] });
  svc.getLoadedConfig = () => ({ apps: [{ name: 'main', script: './main.js' }] });
  svc.resolveStacks = () => ({ dev: STACK });
  svc.resolveStackApps = () => [{ name: 'main', script: './main.js' }];
  svc.updateEnabledStacks = () => {};
  svc.markPriorStopSuperseded = () => {};
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

describe('local startup observations', () => {
  // Exercise the real dependency waves, entry builder, audit and status readers.
  function configured(apps: Array<{ name: string; script: string; cwd?: string; dependsOn?: string[] }>) {
    const { svc } = service('crashed');
    delete svc.startLocalStack;
    svc.stackStates.clear();
    const config = { apps };
    svc.loadProjectConfig = async () => config;
    svc.getLoadedConfig = () => config;
    svc.resolveStacks = () => ({ dev: { type: 'local', apps: 'all', infrastructureOwnership: 'external' } });
    svc.resolveStackApps = () => apps;
    svc.registry.get = () => ({ name: 'demo', path: '/project' });
    const online = new Set<string>();
    const start = vi.fn(async (entry: { name: string; cwd?: string }) => {
      if (entry.name.endsWith('/api')) throw new Error('exited during startup with code 1');
      online.add(entry.name);
    });
    svc.orchestrator.startApp = start;
    svc.orchestrator.list = () => [...online].map(name => ({ name, status: 'online', cpu: 0, memory: 0 }));
    const record = vi.fn();
    svc.audit = { record };
    const events = vi.spyOn(svc, 'emit');
    return { svc, start, online, record, events };
  }

  it('reports an immediate exit and blocked dependents as a failed start across RPC, audit and events', async () => {
    const { svc, start, record, events } = configured([
      { name: 'api', script: 'api.cjs', cwd: '/artifacts/installed' },
      { name: 'workers', script: 'worker.cjs', dependsOn: ['api'] },
    ]);
    const stack = await svc.startStack('demo', 'dev');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0].cwd).toBe('/artifacts/installed');
    expect(stack).toMatchObject({ status: 'error', notUp: [
      'api (stopped): exited during startup with code 1', 'workers (stopped): dependency api did not start',
    ] });
    expect(readStackStart(stack)).toMatchObject({ outcome: 'failed', online: 0, total: 2, issues: [...stack.notUp, 'stack state: error'] });
    expect(await svc.getStackStatus('demo', 'dev')).toMatchObject({ status: 'error', totalApps: 2, onlineApps: 0 });
    const persisted = JSON.parse(JSON.stringify(svc.projectSnapshot({}, false)));
    svc.stackStates = new Map(persisted.stacks);
    expect(svc.getStack('demo', 'dev').notUp).toEqual(stack.notUp);
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'stack.start', outcome: 'failed' }));
    expect(events.mock.calls.some(([name]) => name === 'stack:started')).toBe(false);
    expect(events).toHaveBeenCalledWith('stack:error', 'demo', 'dev', stack.notUp.join(', '));
  });

  it('requires explicit readiness for infrastructure-only stacks after a suppressed provisioning failure', async () => {
    const { svc } = configured([]);
    let ready = false;
    svc.startLocalStack = async () => { svc.stackStates.get('demo/dev').infrastructureStartFailed = true; };
    svc.infraManager.getInstance = () => ({ getState: () => ({ ready, services: {} }) });
    const failed = await svc.startStack('demo', 'dev');
    expect(failed).toMatchObject({ status: 'error', apps: [], notUp: ['infrastructure: required services are not ready (see daemon log)'] });
    expect(readStackStart(failed).outcome).toBe('failed');
    ready = true;
    expect(svc.getStack('demo', 'dev').status).toBe('running');
  });

  it('keeps arbitrary application output out of the public diagnosis', async () => {
    const { svc, start } = configured([{ name: 'api', script: 'api.cjs' }]);
    start.mockRejectedValueOnce(new Error('opaque-test-credential in /private/installation'));
    const info = await svc.startStack('demo', 'dev');
    expect(info.notUp).toEqual(['api (stopped): launch failed (see daemon log)']);
  });

  it('keeps independent apps running and reflects later recovery without restarting them', async () => {
    const { svc, online, start, record } = configured([
      { name: 'api', script: 'api.cjs' },
      { name: 'metrics', script: 'main.cjs', cwd: 'apps/metrics' },
    ]);
    const stack = await svc.startStack('demo', 'dev');
    expect(stack.status).toBe('degraded');
    expect(readStackStart(stack)).toMatchObject({ outcome: 'partial', online: 1, total: 2 });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'partial' }));
    expect(() => svc.removeProject('demo')).toThrow(/stop them first/i);
    expect(start.mock.calls.map(([entry]) => entry.cwd)).toEqual(['/project', '/project/apps/metrics']);
    online.add('demo/dev/api');
    expect(svc.getStack('demo', 'dev')).toMatchObject({ status: 'running' });
    expect(svc.getStack('demo', 'dev')).not.toHaveProperty('notUp');
    expect(await svc.getStackStatus('demo', 'dev')).toMatchObject({ status: 'running', totalApps: 2, onlineApps: 2 });
    await svc.startStack('demo', 'dev');
    expect(start).toHaveBeenCalledTimes(2);
  });
});
