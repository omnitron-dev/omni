/**
 * Apps configured with passwords the node never had.
 *
 * Test node, 2026-09-22 21:17:51 UTC (omni-3f's report): just after the
 * frontend was delivered and the infrastructure provisioned, the master's
 * heartbeat to the node timed out — «Heartbeat failed — marking slave as
 * disconnected» — and the connector dropped the peer. Dropping a peer rejects
 * every call still in flight with a `TransportLostError` whose MESSAGE is its
 * reason: «manual disconnect». `readNodeCredentials` was in flight. It caught
 * that per service, said «its apps will use whatever the stack declared», and
 * went on. The apps were configured with the declared postgres password
 * against a container holding the one the node's vault had generated, 6 of 6
 * migrations failed with `password authentication failed for user
 * "postgres"`, and the deployment ended in a mixed state. The same deployment
 * two minutes later took 56 s.
 *
 * Three things, each enough on its own:
 *
 *   - the read was not retried, though `getConnectionInfo` is a read and can
 *     be asked twice — the case `retryOnDisconnect` exists for;
 *   - `isConnectionGone` would not have let it: it recognised messages, and a
 *     `TransportLostError` says only its reason — «manual disconnect», «peer
 *     disconnected» — neither of which it knew;
 *   - a read that failed fell back to the declared credentials, and for a
 *     secret the node generates, the declared one is wrong by construction.
 *
 * The real `startRemoteStack` down to its artifact step, the real
 * `SlaveConnector.invokeOnSlave`, and a node whose `getConnectionInfo`
 * answers as scripted — with the error netron itself raises.
 */

import { describe, it, expect, vi } from 'vitest';
import { NetronErrors } from '@omnitron-dev/titan/errors';

// Leasing and the master's address have courts of their own; here every
// node is ours and the address is given.
vi.mock('../../src/services/node-deploy-lease.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/node-deploy-lease.js')>()),
  withNodeLeases: async (_candidates: unknown, _stack: string, _logger: unknown, deploy: (leases: unknown) => Promise<unknown>) =>
    deploy({ has: () => true, confirm: async () => {}, unreachable: new Map() }),
}));
vi.mock('../../src/services/master-address.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/master-address.js')>()),
  resolveMasterHost: async () => ({ host: '10.0.0.1', source: 'given' }),
}));

import { ProjectService } from '../../src/services/project.service.js';
import { SlaveConnector, isConnectionGone } from '../../src/cluster/slave-connector.js';

const NODE = { host: '10.0.0.9', port: 9700 };
const DECLARED = 'postgres';
const GENERATED = 'kV7yR2pL9sQ4mN8tB3wX6zC1dF5gH0jK2lP7oI9uY4e';

/** What a dropped peer does to a call in flight: netron's own error. */
const dropped = (reason: string) => NetronErrors.transportLost('WebSocketTransport', 'node-peer', 7, reason);

const STACK = {
  type: 'remote',
  apps: ['main'],
  nodes: [NODE],
  infrastructure: { postgres: { port: 5432, user: 'postgres', password: DECLARED } },
} as never;
const ECOSYSTEM = { apps: [{ name: 'main', script: 'apps/main/dist/main.js' }] } as never;
const RELEASE = {
  id: 'daos-202609222110-2c9fc913',
  files: [{ app: 'main', version: '0.0.1', path: '/nowhere/main.tgz', bytes: 1, inputs: 'i', sha256: 's' }],
  manifest: { builtAt: '2026-09-22T21:10:00Z' },
  staticsDir: null,
} as never;

type Said = { level: string; msg: string; fields: Record<string, unknown> };

/**
 * A deployment of daos/test to one node, whose `getConnectionInfo` answers
 * `answer(service, n)` on its n-th call.
 */
function deployment(answer: (service: string, n: number) => Promise<Record<string, unknown> | null>) {
  const said: Said[] = [];
  const at = (level: string) => (a: unknown, b?: string) =>
    said.push({ level, fields: typeof a === 'object' && a ? (a as Record<string, unknown>) : {}, msg: typeof a === 'string' ? a : (b ?? '') });
  const logger: any = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), trace() {}, fatal() {}, child: () => logger };

  // The connector is real down to the peer: its retry, its judgement of
  // what a dead connection looks like, its second call.
  const connector = new SlaveConnector(logger, null);
  let n = 0;
  const peer = {
    queryInterface: async () => ({
      getConnectionInfo: ({ service }: { service: string }) => answer(service, ++n),
    }),
  };
  const c: any = connector;
  c.connections.set(`${NODE.host}:${NODE.port}`, { peer, status: 'connected', config: { ...NODE } });
  const reconnected: string[] = [];
  c.removeSlave = async (host: string, port: number) => void reconnected.push(`${host}:${port}`);
  c.addSlave = async () => {};
  c.waitUntilConnected = async () => true;

  const delivered: string[] = [];
  let configuredWith: any;
  const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
  const svc: any = new ProjectService(logger, { list: () => [], listHandleNames: () => [] } as never, stateStore);
  svc.slaveConnector = connector;
  svc.registry = { get: () => ({ name: 'daos', path: '/nowhere' }), list: () => [] };
  svc.collectDeclaredServices = async () => ({});
  svc.targetForStackNode = async () => ({ host: NODE.host, username: 'deploy' });
  svc.provisionNodeInfrastructure = async () => ({ ready: true, detail: 'Infrastructure provisioned and healthy (5 services)' });
  svc.resolveNodeAppEnv = async (_e: unknown, _p: unknown, _s: unknown, _a: unknown, infra: unknown) => {
    configuredWith = infra;
    return { main: {} };
  };
  svc.deployer = {
    onProgress: () => () => {},
    leaseRunner: () => ({}),
    provisionSlaveNode: async () => true,
    deployToStack: async (_targets: unknown, artifacts: Array<{ app: string }>) => {
      delivered.push(...artifacts.map((a) => a.app));
      return artifacts.map((a) => ({ app: a.app, status: 'success', node: `${NODE.host}:${NODE.port}` }));
    },
  };

  return {
    start: () => svc.startRemoteStack('daos', 'test', STACK, ECOSYSTEM, RELEASE) as Promise<unknown>,
    svc,
    said,
    delivered,
    reconnected,
    configuredWith: () => configuredWith,
  };
}

/** The node's answer about a service it runs, or `null` for one it does not. */
const provisioned = async (service: string) =>
  service === 'postgres' ? { host: '127.0.0.1', port: 5432, user: 'postgres', password: GENERATED } : null;

describe('apps configured with passwords the node never had', () => {
  it('reads the credentials again through a connection the heartbeat dropped mid-call', async () => {
    const d = deployment(async (service, n) => {
      if (n === 1) throw dropped('manual disconnect');
      return provisioned(service);
    });

    await d.start();

    expect(d.reconnected).toEqual(['10.0.0.9:9700']);
    expect(d.configuredWith().postgres.password, 'the password the node generated').toBe(GENERATED);
    expect(d.delivered).toEqual(['main']);
  });

  it('stops before any artifact when the node still cannot be read', async () => {
    const d = deployment(async () => {
      throw dropped('manual disconnect');
    });

    await expect(d.start()).rejects.toThrow(/postgres.*10\.0\.0\.9|10\.0\.0\.9.*postgres/);

    // The claim is what did NOT happen: no app configured with the declared
    // password, nothing delivered, nothing migrated.
    expect(d.configuredWith()).toBeUndefined();
    expect(d.delivered).toEqual([]);
  });

  it('stops on a refusal too, without reconnecting for it', async () => {
    // A node that refuses is a result, not a dead connection — asked again it
    // refuses again. But it is still a read that did not happen.
    const d = deployment(async () => {
      throw new Error('Missing required role');
    });

    await expect(d.start()).rejects.toThrow(/Missing required role/);
    expect(d.reconnected).toEqual([]);
    expect(d.delivered).toEqual([]);
  });

  it('takes a service the node does not run as nothing to read, not as a failure', async () => {
    const d = deployment(async (service) => provisioned(service));

    await d.start();

    expect(d.configuredWith().postgres.password).toBe(GENERATED);
    expect(d.configuredWith().redis).toBeUndefined();
    expect(d.delivered).toEqual(['main']);
    expect(d.said.filter((s) => s.level === 'warn' || s.level === 'error').map((s) => s.msg)).toEqual([]);
  });
});

describe('a dropped peer, recognised as a connection that is gone', () => {
  it('knows netron\'s own error by what it is, whatever its reason says', () => {
    for (const reason of ['manual disconnect', 'peer disconnected', 'WebSocketTransport']) {
      expect(isConnectionGone(dropped(reason)), reason).toBe(true);
    }
    expect(isConnectionGone(NetronErrors.transportLost('WebSocketTransport', 'node-peer'))).toBe(true);
  });
});

describe('a node whose infrastructure is not up (a-deployment-that-called-a-failed-daemon-healthy)', () => {
  it('deploys anyway, and carries the node and its words in what the start reached', async () => {
    const d = deployment(async (service) => provisioned(service));
    d.svc.provisionNodeInfrastructure = async () => ({
      ready: false,
      detail: 'host services NOT up — bitcoin failed: could not start bitcoind',
    });

    const reach = (await d.start()) as { notReady: string[]; reached: number };

    expect(d.delivered).toEqual(['main']);
    expect(reach.reached).toBe(1);
    expect(reach.notReady).toEqual(['10.0.0.9:9700: host services NOT up — bitcoin failed: could not start bitcoind']);
  });

  it('reaches no «not ready» when the node is ready — the control', async () => {
    const d = deployment(async (service) => provisioned(service));
    const reach = (await d.start()) as { notReady: string[] };
    expect(reach.notReady).toEqual([]);
  });
});

