/**
 * A deployment that shipped five of six and called it started.
 *
 * Measured on `daos/test`, 2026-09-21, from the daemon log:
 *
 *     15:16:45  Starting remote stack — deploying to slave daemons
 *     15:17:27  [ERROR] Build failed for main (exit 2)
 *     15:17:27  artifacts: [storage, priceverse, paysys, messaging, geo]
 *     15:19:02  Stack started
 *
 * `main` — the app the other five talk to — did not compile, the five that
 * did were delivered, and the caller logged `Stack started`. `omnitron stack
 * status daos test` then answered `6/6 online`, which is true and useless:
 * the node daemon is restarted unconditionally on every deployment and
 * auto-starts whatever its config still lists, so `main` came back on the
 * artifact from the PREVIOUS cycle. The only visible trace was a minute of
 * difference in uptime. Earlier the same day three of six failed and the
 * deployment went out with three.
 *
 * A partial deployment is worse than none — the apps that landed are newer
 * than the ones that did not, and nothing on the node says which is which.
 *
 * The second half of the file is about the other question an operator asks
 * afterwards. `omnitron audit` knew about ONE deployment of that stack in
 * twenty-four hours; the daemon log knew about eight. The seven it missed
 * were the boot resume and the reconciler, which call `startStack` directly
 * and so never reached the RPC method that wrote the row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

const buildAll = vi.fn();
vi.mock('../../src/project/artifact-builder.js', () => ({
  ArtifactBuilder: class {
    buildAll = (...args: unknown[]) => buildAll(...args);
  },
}));

const APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];
const built = (names: string[]) => names.map((app) => ({ app, version: '0.0.1' }));

/** A service with just the collaborators `startRemoteStack` reaches. */
function remoteStackService(deployToStack = vi.fn(async () => [])) {
  const svc: any = Object.create(ProjectService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registry: { get: () => ({ name: 'daos', path: '/tmp/daos' }), list: () => [] },
    deployer: {
      deployToStack,
      onProgress: () => () => {},
      provisionSlaveNode: vi.fn(async () => true),
    },
    getSlaveConnector: () => ({ addSlave: vi.fn(async () => {}) }),
    collectDeclaredServices: vi.fn(async () => ({})),
    resolveStackApps: () => APPS.map((name) => ({ name, script: `apps/${name}/dist/main.js` })),
    provisionNode: vi.fn(async () => true),
    emit: vi.fn(),
  });
  return svc;
}

const REMOTE = {
  type: 'remote' as const,
  nodes: [{ host: '37.27.130.185', port: 9700, label: 'test' }],
  apps: 'all' as const,
};

describe('a build that failed stops the deployment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses, and names the apps that did not build', async () => {
    buildAll.mockResolvedValue({
      built: built(APPS.filter((a) => a !== 'main')),
      failed: [{ app: 'main', error: 'exit 2: TS2416 …' }],
    });
    const deployToStack = vi.fn(async () => []);
    const svc = remoteStackService(deployToStack);

    await expect(svc.startRemoteStack('daos', 'test', REMOTE, {})).rejects.toThrow(/main/);
    // The claim is not that it threw — it is that NOTHING was sent. A
    // deployment that refuses after delivering five has not refused.
    expect(deployToStack).not.toHaveBeenCalled();
  });

  it('says how many of how many, because three of six also happened', async () => {
    buildAll.mockResolvedValue({
      built: built(['priceverse', 'messaging', 'geo']),
      failed: ['main', 'storage', 'paysys'].map((app) => ({ app, error: 'exit 2' })),
    });
    const svc = remoteStackService();
    await expect(svc.startRemoteStack('daos', 'test', REMOTE, {})).rejects.toThrow(
      /3 of 6 artifact\(s\) failed to build/
    );
  });

  it('deploys when every artifact built', async () => {
    // The control. Without it a method that threw unconditionally would pass
    // both tests above.
    buildAll.mockResolvedValue({ built: built(APPS), failed: [] });
    const deployToStack = vi.fn(async () => APPS.map((app) => ({ app, status: 'success' })));
    const svc = remoteStackService(deployToStack);

    await svc.startRemoteStack('daos', 'test', REMOTE, {});
    expect(deployToStack).toHaveBeenCalledTimes(1);
    expect(deployToStack.mock.calls[0]![1]).toHaveLength(6);
  });

  it('refuses when the artifacts built and some did not land', async () => {
    // The other half of the same invariant: delivering four of six leaves
    // exactly the split state the refusal above exists to prevent, and it
    // was a WARN under a `Stack started` that followed regardless.
    buildAll.mockResolvedValue({ built: built(APPS), failed: [] });
    const deployToStack = vi.fn(async () =>
      APPS.map((app) => ({ app, status: app === 'main' || app === 'geo' ? 'failed' : 'success' }))
    );
    const svc = remoteStackService(deployToStack);

    await expect(svc.startRemoteStack('daos', 'test', REMOTE, {})).rejects.toThrow(
      /failed for 2 of 6 app\(s\): main, geo/
    );
  });
});

describe('every start is recorded, and says who asked', () => {
  const record = vi.fn(async () => {});

  function startableService() {
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({})),
      resolveStacks: () => ({ test: { type: 'local', apps: 'all' } }),
      startLocalStack: vi.fn(async () => {}),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: 'local', apps: [{ name: 'main', status: 'online' }] }),
      emit: vi.fn(),
    });
    return svc;
  }

  beforeEach(() => vi.clearAllMocks());

  it('records the reconciler, which is the caller the trail was missing', async () => {
    const svc = startableService();
    await svc.startStack('daos', 'test', { source: 'auto-resume' });

    expect(record).toHaveBeenCalledTimes(1);
    const row = record.mock.calls[0]![0] as any;
    expect(row.action).toBe('stack.start');
    expect(row.resourceId).toBe('daos/test');
    expect(row.details.source).toBe('auto-resume');
  });

  it.each(['operator', 'boot', 'auto-resume'] as const)('records a %s start', async (source) => {
    const svc = startableService();
    await svc.startStack('daos', 'test', { source });
    expect((record.mock.calls[0]![0] as any).details.source).toBe(source);
  });

  it('says `unknown` rather than attributing an unlabelled caller to a person', async () => {
    const svc = startableService();
    await svc.startStack('daos', 'test');
    expect((record.mock.calls[0]![0] as any).details.source).toBe('unknown');
  });

  it('records nothing when the start fails', async () => {
    // A trail that lists attempts as deployments is a different lie from the
    // one this fixes.
    const svc = startableService();
    svc.startLocalStack = vi.fn(async () => {
      throw new Error('infra did not come up');
    });
    await expect(svc.startStack('daos', 'test', { source: 'operator' })).rejects.toThrow(/infra/);
    expect(record).not.toHaveBeenCalled();
  });
});
