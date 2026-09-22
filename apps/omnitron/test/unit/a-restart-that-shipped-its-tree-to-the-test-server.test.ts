/**
 * A restart that shipped its tree to the test server.
 *
 * Boot and the enabled-stacks reconciler resumed every enabled stack through a
 * full start, and for a remote stack a full start is a deployment. Measured
 * 2026-09-22: a master daemon restarted on a clean tree deployed that tree to
 * the one shared test server by itself — `Reconciler: resuming enabled stack`
 * at 13:56:56, `Stack started, source: auto-resume` at 14:00:05, five
 * applications restarted onto new artifacts — and the three restarts before
 * it that morning were stopped only because the tree was dirty at the time.
 *
 * A restart now RE-ATTACHES a remote stack: the nodes are asked what they run
 * and the answer becomes the state. It never builds, delivers or restarts
 * anything; deploying is what an operator asks for.
 */

import { tmpdir } from 'node:os';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

const APPS = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];
const NODE = { host: '37.27.130.185', port: 9700, label: 'test' };
const REMOTE = { type: 'remote' as const, apps: 'all' as const, nodes: [NODE] };

function nodeAnswer(online: readonly string[]) {
  return {
    apps: APPS.map((name) => ({
      name: `daos/deployed/${name}`,
      status: online.includes(name) ? 'online' : 'stopped',
      pid: online.includes(name) ? 4242 : null,
    })),
  };
}

function remoteService(answer: () => Promise<unknown>) {
  const svc: any = Object.create(ProjectService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    audit: { record: vi.fn(async () => {}) },
    registry: { get: () => ({ name: 'daos', path: tmpdir() }), list: () => [] },
    stackStates: new Map(),
    startsInFlight: new Map(),
    loadProjectConfig: vi.fn(async () => ({})),
    resolveStacks: () => ({ test: REMOTE }),
    slaveConnector: { invokeOnSlave: vi.fn(answer) },
    remoteInfraStatus: vi.fn(async () => null),
    toStackInfo: () => ({
      name: 'test',
      type: 'remote',
      status: 'stopped',
      config: REMOTE,
      apps: APPS.map((name) => ({ name, status: 'stopped' })),
    }),
    // What a full start would reach. None of it may run from a restart.
    startRemoteStack: vi.fn(async () => ({ nodes: 1, reached: 1, skipped: [] })),
    startClusterStack: vi.fn(async () => {}),
    updateEnabledStacks: vi.fn(),
    emit: vi.fn(),
  });
  return svc;
}

describe('a restart re-attaches a remote stack and deploys nothing', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['auto-resume', 'boot'] as const)('%s: the node says what runs, and that is the state', async (source) => {
    const svc = remoteService(async () => nodeAnswer(APPS));

    const info = await svc.startStack('daos', 'test', { source });

    expect(svc.startRemoteStack).not.toHaveBeenCalled();
    expect(svc.audit.record).not.toHaveBeenCalled();
    expect(info.apps.every((a: any) => a.status === 'online')).toBe(true);
    expect(svc.stackStates.get('daos/test').status).toBe('running');
  });

  it('an application down on the node is degraded, not a reason to ship over it', async () => {
    const svc = remoteService(async () => nodeAnswer(APPS.filter((a) => a !== 'geo')));

    await svc.startStack('daos', 'test', { source: 'auto-resume' });

    expect(svc.startRemoteStack).not.toHaveBeenCalled();
    // `degraded` is a state the reconciler leaves alone — so this is not a
    // loop that redeploys on its next tick.
    expect(svc.stackStates.get('daos/test').status).toBe('degraded');
  });

  it('no node answering is an error to retry by asking — never a deployment', async () => {
    const svc = remoteService(async () => Promise.reject(new Error('mesh connection not established')));

    await expect(svc.startStack('daos', 'test', { source: 'auto-resume' })).rejects.toThrow(
      /Not deploying daos\/test from an automatic resume: none of its node\(s\) answered.*omnitron stack start daos test/,
    );
    expect(svc.startRemoteStack).not.toHaveBeenCalled();
  });

  it('an operator start of the same stack still deploys — the control', async () => {
    const svc = remoteService(async () => nodeAnswer(APPS));
    // The operator path checks the tree before deploying; the fixture's
    // project is not a git checkout, which it reports and passes.
    svc.registry = { get: () => null, list: () => [] };

    await svc.startStack('daos', 'test', { source: 'operator' });

    expect(svc.startRemoteStack).toHaveBeenCalledTimes(1);
  });
});
