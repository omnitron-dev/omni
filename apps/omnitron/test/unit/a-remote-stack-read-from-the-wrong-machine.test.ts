/**
 * Six applications running on a node, reported as six stopped.
 *
 * `toStackInfo` builds a stack's app list from THIS daemon's orchestrator
 * handles. For a remote stack there are none: the applications run on the
 * nodes, under the node's own naming — `daos/deployed/main` — so every app
 * fell through to the "configured but not running" branch. Measured thirty
 * seconds after this same master installed, migrated and started them:
 *
 *     Stack daos/test: only 0/6 apps came online. Not online: main (stopped),
 *     storage (stopped), priceverse (stopped), paysys (stopped),
 *     messaging (stopped), geo (stopped)
 *
 * against a node answering `appsTotal: 6, appsOnline: 6` with 3001, 3002,
 * 3003, 3004, 3005 and 3007 listening. `stack start` exits 1 on that count,
 * so a correct deployment fails a script, and the console's stack page shows
 * the same six rows stopped.
 *
 * The nodes are asked over the mesh, the way everything else about a node is
 * asked. A node that cannot be asked leaves its apps as they were, with a
 * line saying why: "we could not ask" is not "they are down".
 */

import { describe, it, expect } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

const app = (name: string) => ({
  name,
  handleKey: `daos/test/${name}`,
  status: 'stopped' as const,
  pid: null,
  instances: 0,
  uptime: 0,
  restarts: 0,
  cpu: 0,
  memory: 0,
  port: null,
});

const info = (type: 'remote' | 'local') =>
  ({
    name: 'test',
    type,
    status: 'running',
    config: { type, apps: 'all', nodes: [{ host: '37.27.130.185', port: 9700 }] },
    nodes: [],
    apps: [app('main'), app('geo'), app('paysys')],
    infrastructure: { ready: true, services: {} },
    portRange: null,
    startedAt: null,
    uptime: 0,
  }) as never;

/** What the node answers about itself. */
const nodeStatus = (apps: Array<{ name: string; status: string; port?: number }>) => ({
  version: '0.2.0',
  pid: 1,
  uptime: 1,
  totalCpu: 3,
  totalMemory: 4,
  apps: apps.map((a) => ({
    name: a.name,
    pid: 42,
    status: a.status,
    cpu: 1,
    memory: 2,
    uptime: 3,
    restarts: 0,
    instances: 1,
    port: a.port ?? null,
    mode: 'bootstrap',
    critical: false,
  })),
});

function service(invoke: (host: string, port: number, svc: string, method: string) => Promise<unknown>) {
  const orchestrator: any = { list: () => [], listHandleNames: () => [] };
  const stateStore: any = { save() {}, load: () => null, get: () => null, set() {} };
  const svc = new ProjectService(logger, orchestrator, stateStore) as unknown as {
    slaveConnector: unknown;
    withRemoteAppStatuses(project: string, info: never): Promise<{ apps: Array<{ name: string; status: string; port: number | null; handleKey: string }> }>;
  };
  svc.slaveConnector = { invokeOnSlave: invoke };
  return svc;
}

/** What the node answers about its containers. */
const nodeInfra = () => ({
  ready: true,
  services: {
    'daos-test-postgres': { name: 'daos-test-postgres', status: 'running', ports: { '5432': 5432 } },
    'daos-test-tor': { name: 'daos-test-tor', status: 'running', ports: {} },
  },
});

describe('a remote stack\'s infrastructure is on its nodes too', () => {
  it('reads the containers from the node', async () => {
    const svc = service(async (_h, _p, service_, method) =>
      service_ === 'OmnitronInfra' && method === 'getState' ? nodeInfra() : nodeStatus([]),
    );

    const out = (await svc.withRemoteAppStatuses('daos', info('remote'))) as unknown as {
      infrastructure: { ready: boolean; services: Record<string, { containerName: string; status: string }> };
    };

    expect(out.infrastructure.ready).toBe(true);
    // Named as the stack names them, not as the node prefixes them.
    expect(Object.keys(out.infrastructure.services).sort()).toEqual(['postgres', 'tor']);
    expect(out.infrastructure.services['postgres']!.containerName).toBe('daos-test-postgres');
  });

  it('reads the containers when the node\'s state is gone', async () => {
    // A node's infra state is in memory: after its daemon restarts it
    // answers `null` until a master provisions the stack again, while the
    // containers keep running. Measured on the test node minutes after an
    // upgrade — "Infrastructure: not provisioned" beside six healthy
    // containers serving the portal over Tor.
    const svc = service(async (_h, _p, service_, method) => {
      if (service_ !== 'OmnitronInfra') return nodeStatus([]);
      if (method === 'getState') return null;
      return [
        { name: 'daos-test-postgres', status: 'running', ports: { '5432': 5432 } },
        { name: 'daos-test-redis', status: 'running', ports: {} },
        { name: 'other-stack-thing', status: 'running', ports: {} },
      ];
    });

    const out = (await svc.withRemoteAppStatuses('daos', info('remote'))) as unknown as {
      infrastructure: { ready: boolean; services: Record<string, unknown> };
    };

    // This stack's containers only — the node may run others.
    expect(Object.keys(out.infrastructure.services).sort()).toEqual(['postgres', 'redis']);
    expect(out.infrastructure.ready).toBe(true);
  });

  it('is not ready when one of those containers is not running', async () => {
    const svc = service(async (_h, _p, service_, method) => {
      if (service_ !== 'OmnitronInfra') return nodeStatus([]);
      if (method === 'getState') return null;
      return [
        { name: 'daos-test-postgres', status: 'running', ports: {} },
        { name: 'daos-test-tor', status: 'exited', ports: {} },
      ];
    });

    const out = (await svc.withRemoteAppStatuses('daos', info('remote'))) as unknown as {
      infrastructure: { ready: boolean; services: Record<string, { status: string }> };
    };

    expect(out.infrastructure.ready).toBe(false);
    expect(out.infrastructure.services['tor']!.status).toBe('stopped');
  });

  it('keeps this master\'s view when the node cannot say', async () => {
    const svc = service(async (_h, _p, service_) => {
      if (service_ === 'OmnitronInfra') throw new Error('no route');
      return nodeStatus([]);
    });

    const out = (await svc.withRemoteAppStatuses('daos', info('remote'))) as unknown as {
      infrastructure: { ready: boolean };
    };

    expect(out.infrastructure.ready).toBe(true);
  });
});

describe('a remote stack is read from the machines it runs on', () => {
  it('takes each app\'s status from the node', async () => {
    const svc = service(async () =>
      nodeStatus([
        { name: 'daos/deployed/main', status: 'online', port: 3001 },
        { name: 'daos/deployed/geo', status: 'online', port: 3007 },
        { name: 'daos/deployed/paysys', status: 'starting', port: 3004 },
      ]),
    );

    const out = await svc.withRemoteAppStatuses('daos', info('remote'));

    expect(out.apps.map((a) => `${a.name}:${a.status}`)).toEqual([
      'main:online',
      'geo:online',
      'paysys:starting',
    ]);
    expect(out.apps[0]!.port).toBe(3001);
    // The node's own name for it, so a reader can find it there.
    expect(out.apps[0]!.handleKey).toBe('daos/deployed/main');
  });

  it('leaves an app the node does not report', async () => {
    // The node answered; this app is genuinely not among what it runs.
    const svc = service(async () => nodeStatus([{ name: 'daos/deployed/main', status: 'online' }]));

    const out = await svc.withRemoteAppStatuses('daos', info('remote'));

    expect(out.apps.find((a) => a.name === 'geo')!.status).toBe('stopped');
  });

  it('does not call a node that cannot be asked "stopped"', async () => {
    // The most expensive mistake available here: reporting a deployment
    // failed because the master could not reach the machine.
    const svc = service(async () => {
      throw new Error('Missing required role');
    });

    const out = await svc.withRemoteAppStatuses('daos', info('remote'));

    expect(out.apps.map((a) => a.status)).toEqual(['stopped', 'stopped', 'stopped']);
    expect(out.apps.map((a) => a.handleKey)).toEqual([
      'daos/test/main',
      'daos/test/geo',
      'daos/test/paysys',
    ]);
  });

  it('asks nothing for a local stack', async () => {
    let asked = 0;
    const svc = service(async () => {
      asked += 1;
      return nodeStatus([]);
    });

    await svc.withRemoteAppStatuses('daos', info('local'));

    expect(asked).toBe(0);
  });

  it('asks the node two questions, and a third only when it has to', async () => {
    const calls: string[] = [];
    const answering = async (host: string, port: number, service_: string, method: string) => {
      calls.push(`${host}:${port} ${service_}.${method}`);
      return service_ === 'OmnitronInfra' ? nodeInfra() : nodeStatus([]);
    };

    await service(answering).withRemoteAppStatuses('daos', info('remote'));

    // The state answered, so the containers are not listed as well.
    expect(calls).toEqual([
      '37.27.130.185:9700 OmnitronDaemon.status',
      '37.27.130.185:9700 OmnitronInfra.getState',
    ]);

    calls.length = 0;
    const emptyState = async (host: string, port: number, service_: string, method: string) => {
      calls.push(`${host}:${port} ${service_}.${method}`);
      if (service_ !== 'OmnitronInfra') return nodeStatus([]);
      return method === 'getState' ? null : [];
    };

    await service(emptyState).withRemoteAppStatuses('daos', info('remote'));

    expect(calls[2]).toBe('37.27.130.185:9700 OmnitronInfra.listContainers');
  });
});
