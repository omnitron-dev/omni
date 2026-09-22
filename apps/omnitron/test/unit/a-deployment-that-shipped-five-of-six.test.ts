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
import { tmpdir } from 'node:os';

import { ProjectService } from '../../src/services/project.service.js';

const buildAll = vi.fn();
vi.mock('../../src/project/artifact-builder.js', () => ({
  ArtifactBuilder: class {
    buildAll = (...args: unknown[]) => buildAll(...args);
  },
}));

const APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];
const built = (names: string[]) => names.map((app) => ({ app, version: '0.0.1' }));

/** A node that grants its deploy lease, renews it, and takes it back. */
const grantingLease = async (script: string) =>
  script.includes("echo 'ACQUIRED'") ? 'ACQUIRED\n' : script.includes("echo 'RENEWED'") ? 'RENEWED\n' : 'RELEASED\n';

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
      leaseRunner: () => grantingLease,
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
      // `startStackOnce` asks the registry where the project is, to ask git
      // whether its tree is the commit it claims. A local stack is exempt
      // from the refusal, and this one is local — what the fixture owes is
      // the lookup, not a repository.
      registry: { get: () => ({ name: 'daos', path: tmpdir() }), list: () => [] },
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

describe('a deployment that reached no node at all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildAll.mockResolvedValue({ built: built(APPS), failed: [] });
  });

  it('refuses rather than calling the stack started', async () => {
    // Measured 2026-09-22: the only node's SSH stopped completing
    // handshakes. Both attempts logged «Failed to provision slave —
    // skipping», the loop moved on with nothing left to move on to, and the
    // deployment marked the stack running and wrote a `stack.start` row
    // saying `apps: 6`. Nothing was installed on any machine.
    const svc = remoteStackService();
    svc.deployer.provisionSlaveNode = vi.fn(async () => false);

    await expect(svc.startRemoteStack('daos', 'test', REMOTE, {})).rejects.toThrow(
      /none of its 1 node\(s\) could be provisioned/
    );
  });

  it('names every node it could not reach', async () => {
    const svc = remoteStackService();
    svc.deployer.provisionSlaveNode = vi.fn(async () => false);
    const two = {
      ...REMOTE,
      nodes: [
        { host: '37.27.130.185', port: 9700, label: 'test' },
        { host: '10.0.0.9', port: 9700, label: 'spare' },
      ],
    };

    await expect(svc.startRemoteStack('daos', 'test', two, {})).rejects.toThrow(
      /37\.27\.130\.185:9700, 10\.0\.0\.9:9700/
    );
  });
});

describe('the row says what the deployment reached', () => {
  const record = vi.fn(async () => {});

  function remoteStartable(reach: { nodes: number; reached: number; skipped: string[] } | null) {
    const svc: any = Object.create(ProjectService.prototype);
    Object.assign(svc, {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      audit: { record },
      registry: { get: () => null, list: () => [] },
      stackStates: new Map(),
      startsInFlight: new Map(),
      loadProjectConfig: vi.fn(async () => ({})),
      resolveStacks: () => ({
        test: reach ? { type: 'remote', apps: 'all', nodes: [] } : { type: 'local', apps: 'all' },
      }),
      startLocalStack: vi.fn(async () => {}),
      startRemoteStack: vi.fn(async () => reach),
      updateEnabledStacks: vi.fn(),
      toStackInfo: () => ({ name: 'test', type: reach ? 'remote' : 'local', apps: APPS.map((name) => ({ name, status: 'stopped' })) }),
      emit: vi.fn(),
    });
    return svc;
  }

  beforeEach(() => vi.clearAllMocks());

  it('carries how many nodes there were and how many took it', async () => {
    const svc = remoteStartable({ nodes: 2, reached: 1, skipped: ['10.0.0.9:9700'] });
    await svc.startStack('daos', 'test', { source: 'operator' });

    const row = (record.mock.calls[0]![0] as any).details;
    expect(row.apps).toBe(6);
    expect(row.nodes).toBe(2);
    expect(row.reached).toBe(1);
    expect(row.skipped).toEqual(['10.0.0.9:9700']);
  });

  it('leaves `skipped` out when every node took it, rather than writing an empty list', async () => {
    const svc = remoteStartable({ nodes: 1, reached: 1, skipped: [] });
    await svc.startStack('daos', 'test', { source: 'operator' });

    const row = (record.mock.calls[0]![0] as any).details;
    expect(row.reached).toBe(1);
    expect(row).not.toHaveProperty('skipped');
  });

  it('says nothing about nodes for a local stack — the control', async () => {
    const svc = remoteStartable(null);
    await svc.startStack('daos', 'test', { source: 'operator' });

    const row = (record.mock.calls[0]![0] as any).details;
    expect(row.type).toBe('local');
    expect(row).not.toHaveProperty('nodes');
    expect(row).not.toHaveProperty('reached');
  });
});

describe('one writer per node', () => {
  beforeEach(() => vi.clearAllMocks());

  it("takes the node's lease before touching it, and gives it back after", async () => {
    buildAll.mockResolvedValue({ built: built(APPS), failed: [] });
    const order: string[] = [];
    const svc = remoteStackService(
      vi.fn(async () => {
        order.push('deliver');
        return APPS.map((app) => ({ app, status: 'success' }));
      }),
    );
    svc.deployer.leaseRunner = () => async (script: string) => {
      if (script.includes("echo 'ACQUIRED'")) {
        order.push('lease');
        return 'ACQUIRED\n';
      }
      if (script.includes("echo 'RENEWED'")) {
        order.push('confirm');
        return 'RENEWED\n';
      }
      order.push('release');
      return 'RELEASED\n';
    };
    svc.deployer.provisionSlaveNode = vi.fn(async () => {
      order.push('provision');
      return true;
    });

    await svc.startRemoteStack('daos', 'test', REMOTE, {});

    expect(order[0]).toBe('lease');
    // Confirmed with the node before each step that changes it…
    expect(order.slice(0, 3)).toEqual(['lease', 'confirm', 'provision']);
    expect(order[order.indexOf('deliver') - 1]).toBe('confirm');
    // …and given back exactly once, after everything else.
    expect(order.at(-1)).toBe('release');
    expect(order.filter((s) => s === 'release')).toHaveLength(1);
  });

  it('a node another deployment holds is refused before anything on it changes', async () => {
    buildAll.mockResolvedValue({ built: built(APPS), failed: [] });
    const svc = remoteStackService();
    const holder = JSON.stringify({
      token: 't-other',
      holder: 'laptop-2 pid 4242',
      stack: 'daos/test',
      startedAt: '2026-09-22T13:40:00.000Z',
    });
    svc.deployer.leaseRunner = () => async (script: string) =>
      script.includes("echo 'ACQUIRED'") ? `HELD 12\t${holder}\n` : 'RELEASED\n';

    await expect(svc.startRemoteStack('daos', 'test', REMOTE, {})).rejects.toThrow(
      /37\.27\.130\.185:9700 is being deployed by laptop-2 pid 4242 \(deploying daos\/test, since .*\); its lease was renewed 12s ago/,
    );
    expect(svc.deployer.provisionSlaveNode).not.toHaveBeenCalled();
    expect(svc.deployer.deployToStack).not.toHaveBeenCalled();
  });
});
