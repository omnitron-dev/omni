/**
 * A way past the record that nobody could take.
 *
 * A deployment skips an app whose artifact the node already records, and the
 * code said so beside the one escape: «`options.force` deploys anyway, for an
 * operator who has reason to doubt the record». Nothing passed it. Not the
 * CLI, not the RPC, not `ProjectService`, not even `deployToStack` — the one
 * caller of the method that read it.
 *
 * On daos/test, 2026-09-24, the record lied: a deployment stalled after
 * installing three artifacts, the node recorded them, and the retry left three
 * applications on the code they had started with an hour before. The record
 * is now written only once an app comes up on its artifact — which prevents
 * the next one and does not repair this one. `omnitron stack start
 * --reinstall` is the door: every artifact shipped, every app restarted,
 * whatever the node's record says.
 */

import { describe, expect, it, vi } from 'vitest';

// The lease and the master's address have courts of their own.
vi.mock('../../src/services/node-deploy-lease.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/node-deploy-lease.js')>()),
  withNodeLeases: async (_c: unknown, _s: string, _l: unknown, deploy: (leases: unknown) => Promise<unknown>) =>
    deploy({ has: () => true, confirm: async () => {}, unreachable: new Map() }),
}));
vi.mock('../../src/services/master-address.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/master-address.js')>()),
  resolveMasterHost: async () => ({ host: '10.0.0.1', source: 'given' }),
}));

import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';

const NODE = { host: '10.0.0.9', port: 9700 };
const ECOSYSTEM = { apps: [{ name: 'main', script: 'apps/main/dist/main.js' }] } as never;
const RELEASE = {
  id: 'daos-202609241258-00000000',
  files: [{ app: 'main', version: '0.0.1', path: '/nowhere/main.tgz', bytes: 1, inputs: 'i', sha256: 's' }],
  manifest: { builtAt: '2026-09-24T12:58:00Z' },
  staticsDir: null,
} as never;

/** A remote start, with every node-facing step answered — what reaches the deployer is the question. */
function remoteStart() {
  const quiet: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => quiet };
  const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(quiet, { list: () => [], listHandleNames: () => [] } as never, stateStore, {
    secrets: { get: async () => null } as never,
  });
  const asked: Array<Record<string, unknown>> = [];
  svc.registry = { get: () => ({ name: 'daos', path: '/nowhere' }), list: () => [] };
  svc.collectDeclaredServices = async () => ({});
  svc.targetForStackNode = async () => ({ host: NODE.host, username: 'deploy' });
  svc.getSlaveConnector = () => ({ addSlave: async () => {}, waitUntilConnected: async () => true, removeSlave: async () => {} });
  svc.provisionNodeInfrastructure = async () => ({ ready: true, detail: 'healthy' });
  svc.readNodeCredentials = async () => ({});
  svc.resolveNodeAppEnv = async () => ({ main: { DATABASE_URL: 'postgres://…/main' } });
  svc.deployer = {
    onProgress: () => () => {},
    leaseRunner: () => ({}),
    provisionSlaveNode: async () => true,
    deployToStack: async (_t: unknown, artifacts: Array<{ app: string }>, _p: string, options: Record<string, unknown>) => {
      asked.push(options);
      return artifacts.map((a) => ({ app: a.app, status: 'success', node: `${NODE.host}:${NODE.port}` }));
    },
  };
  const stack = { type: 'remote', apps: ['main'], nodes: [NODE] } as never;
  return {
    start: (reinstall?: boolean) => svc.startRemoteStack('daos', 'test', stack, ECOSYSTEM, RELEASE, reinstall),
    asked,
  };
}

describe('`--reinstall`, from the service to the node', () => {
  it('asks the deployer to ship past the record when the operator said so', async () => {
    const s = remoteStart();
    await s.start(true);
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]).toMatchObject({ force: true });
  });

  it('asks nothing of the kind otherwise — the record still spares what it can', async () => {
    const s = remoteStart();
    await s.start();
    expect(s.asked[0]).not.toHaveProperty('force');
  });

  it('is carried by the deployer to every node deployment, where the record is read', async () => {
    const deployer: any = Object.create(RemoteDeployer.prototype);
    const seen: Array<Record<string, unknown> | undefined> = [];
    deployer.logger = { info() {}, warn() {}, error() {}, debug() {} };
    deployer.deployToNode = async (_t: unknown, artifact: { app: string; version: string }, _p: string, options?: Record<string, unknown>) => {
      seen.push(options);
      return { node: 'n', app: artifact.app, version: artifact.version, status: 'failed', duration: 0, error: 'stop here' };
    };
    await deployer.deployToStack([{ host: NODE.host }], [{ app: 'main', version: '0.0.1', path: '/x', size: 1 }], 'daos', { force: true });
    expect(seen).toEqual([expect.objectContaining({ force: true })]);
  });
});

describe('`--reinstall`, from the daemon\'s door to the start', () => {
  it('is handed by the RPC to the service, and only when it was said', async () => {
    const opts: Array<Record<string, unknown> | undefined> = [];
    const rpc: any = Object.create(ProjectRpcService.prototype);
    rpc.projectService = {
      startStack: async (_p: string, _s: string, o?: Record<string, unknown>) => (opts.push(o), { apps: [] }),
      withRemoteAppStatuses: async (_p: string, info: unknown) => info,
    };
    await rpc.startStack({ project: 'daos', stack: 'test', release: 'r', reinstall: true });
    await rpc.startStack({ project: 'daos', stack: 'test', release: 'r' });
    expect(opts[0]).toMatchObject({ source: 'operator', release: 'r', reinstall: true });
    expect(opts[1]).not.toHaveProperty('reinstall');
  });

  it('is carried by the service down its positional chain to the run', async () => {
    const quiet: any = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child: () => quiet };
    const svc: any = new ProjectService(quiet, { list: () => [], listHandleNames: () => [] } as never, {
      save() {}, load: () => null, get: () => null, set() {},
    } as never, { secrets: { get: async () => null } as never });
    const seen: unknown[][] = [];
    svc.runStackStart = async (...args: unknown[]) => (seen.push(args), { apps: [] });
    await svc.startStack('daos', 'test', { release: 'r', reinstall: true });
    // (projectName, stackName, source, allowDirty, releaseId, known, reinstall)
    expect(seen[0]![6]).toBe(true);
  });
});

describe('`omnitron stack start --reinstall` on the command line', () => {
  it('passes the word to the daemon, and only when it was said', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.doMock('../../src/daemon/daemon-client.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../../src/daemon/daemon-client.js')>()),
      createDaemonClient: () => ({
        service: async () => ({
          startStack: async (data: Record<string, unknown>) => {
            calls.push(data);
            return { name: 'test', project: 'daos', status: 'running', apps: [] };
          },
        }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('../../src/commands/output.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../src/commands/output.js')>();
      const say = () => undefined;
      return { ...actual, emitJson: () => false, emitError: () => true, emitStep: say, emitSuccess: say, emitInfo: say, emitWarn: say };
    });
    try {
      const { stackStartCommand } = await import('../../src/commands/stack.js');
      await stackStartCommand('daos', 'test', { reinstall: true, release: 'r' });
      await stackStartCommand('daos', 'test', { release: 'r' });
    } finally {
      process.exitCode = 0;
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('../../src/commands/output.js');
      vi.resetModules();
    }
    expect(calls[0]).toMatchObject({ project: 'daos', stack: 'test', release: 'r', reinstall: true });
    expect(calls[1]).not.toHaveProperty('reinstall');
  });
});
