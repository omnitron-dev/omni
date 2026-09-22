/**
 * `stack runtime` answered «no apps, no nodes» about six applications
 * running on a node it was talking to.
 *
 * Measured 2026-09-22, three times in three seconds, against `daos/test`:
 *
 *     omnitron stack runtime daos test  →  onlineApps 0/0, connectedNodes 0/1
 *     omnitron stack status  daos test  →  Apps (6/6 online), node ●
 *
 * Two commands, one stack, opposite answers — and the JSON one is what a
 * script and a dashboard read. It counted `this.orchestrator.list()`, the
 * MASTER's process table, which lists none of a remote stack's applications
 * because they run somewhere else; and it took `connectedNodes` from the
 * slave connector's registry, which reported zero connections for a node
 * that was answering RPCs in the same second.
 *
 * The sibling readers had already been taught to ask the node —
 * `listStacks`, `getStack` and `startStack` all pass through
 * `withRemoteAppStatuses`, and the comment beside one of them names this
 * exact symptom, «only 0/6 apps came online» about six that were running.
 * The fix reached three callers of four.
 *
 * So: ask whoever is running them, and count the nodes that ANSWERED rather
 * than the rows of a registry. What must not regress is the local stack,
 * where the master's own table is the right one to read.
 */

import { describe, it, expect, vi } from 'vitest';

import { ProjectService } from '../../src/services/project.service.js';

const SIX = ['main', 'storage', 'priceverse', 'paysys', 'messaging', 'geo'];

const nodeApp = (name: string, status = 'online', cpu = 2, memory = 100) => ({
  // The node names them with its own prefix; the stack knows the bare name.
  name: `daos/deployed/${name}`,
  status,
  pid: 1000 + name.length,
  instances: 1,
  uptime: 60_000,
  restarts: 0,
  cpu,
  memory,
  port: null,
});

/**
 * A service with exactly the collaborators `getStackStatus` reaches.
 *
 * `invokeOnSlave` is the one that decides the outcome, so it is passed in;
 * everything else is the smallest thing that lets the method run.
 */
function service(opts: {
  type: 'remote' | 'local';
  nodes?: Array<{ host: string; port?: number }>;
  invokeOnSlave?: (...args: unknown[]) => Promise<unknown>;
  masterApps?: Array<{ name: string; status: string; cpu: number; memory: number }>;
  connections?: Array<{ stack: string; status: string }>;
}) {
  const stackConfig = {
    type: opts.type,
    apps: 'all' as const,
    nodes: opts.nodes ?? (opts.type === 'remote' ? [{ host: '37.27.130.185', port: 9700 }] : []),
  };
  const svc: any = Object.create(ProjectService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    stackStates: new Map([['daos/test', { status: 'running', config: stackConfig }]]),
    getLoadedConfig: () => ({ apps: SIX.map((name) => ({ name })) }),
    resolveStacks: () => ({ test: stackConfig }),
    resolveStackApps: () => SIX.map((name) => ({ name })),
    orchestrator: { list: () => opts.masterApps ?? [] },
    slaveConnector: {
      invokeOnSlave: opts.invokeOnSlave ?? vi.fn(async () => ({ apps: SIX.map((n) => nodeApp(n)) })),
      getConnections: () => opts.connections ?? [],
    },
    remoteInfraStatus: vi.fn(async () => null),
    getStack: () => ({
      name: 'test',
      type: opts.type,
      status: 'stopped',
      config: stackConfig,
      infrastructure: null,
      apps: SIX.map((name) => ({ name, status: 'stopped', pid: null, cpu: 0, memory: 0 })),
    }),
  });
  return svc;
}

describe('a remote stack is counted where it runs', () => {
  it('reports the six the node reports, not the zero this master runs', async () => {
    const runtime = await service({ type: 'remote' }).getStackStatus('daos', 'test');

    expect(runtime.totalApps).toBe(6);
    expect(runtime.onlineApps).toBe(6);
    expect(runtime.status).toBe('running');
  });

  it('counts the nodes that answered, not the rows of the connection registry', async () => {
    // The live symptom: the registry said zero while the node answered.
    const runtime = await service({ type: 'remote', connections: [] }).getStackStatus('daos', 'test');

    expect(runtime.connectedNodes).toBe(1);
    expect(runtime.totalNodes).toBe(1);
  });

  it('counts one when one of two nodes answers', async () => {
    const invokeOnSlave = vi.fn(async (host: unknown) => {
      if (host === 'down.example') throw new Error('Socket closed during RPC');
      return { apps: SIX.map((n) => nodeApp(n)) };
    });
    const runtime = await service({
      type: 'remote',
      nodes: [{ host: '37.27.130.185' }, { host: 'down.example' }],
      invokeOnSlave: invokeOnSlave as never,
    }).getStackStatus('daos', 'test');

    expect(runtime.connectedNodes).toBe(1);
    expect(runtime.totalNodes).toBe(2);
    expect(runtime.onlineApps).toBe(6);
  });

  it('says 0 of 6, not 0 of 0, when no node answers at all', async () => {
    // «No apps» and «six apps nobody could ask about» are different states,
    // and the first one reads as a stack that was never deployed.
    const runtime = await service({
      type: 'remote',
      invokeOnSlave: vi.fn(async () => {
        throw new Error('Socket closed during RPC');
      }) as never,
    }).getStackStatus('daos', 'test');

    expect(runtime.totalApps).toBe(6);
    expect(runtime.onlineApps).toBe(0);
    expect(runtime.connectedNodes).toBe(0);
  });

  it('reports degraded when the node runs five of six', async () => {
    const runtime = await service({
      type: 'remote',
      invokeOnSlave: vi.fn(async () => ({
        apps: SIX.map((n) => nodeApp(n, n === 'paysys' ? 'stopped' : 'online')),
      })) as never,
    }).getStackStatus('daos', 'test');

    expect(runtime.onlineApps).toBe(5);
    expect(runtime.totalApps).toBe(6);
    expect(runtime.status).toBe('degraded');
  });

  it('takes cpu and memory from the node too', async () => {
    const runtime = await service({
      type: 'remote',
      invokeOnSlave: vi.fn(async () => ({ apps: SIX.map((n) => nodeApp(n, 'online', 3, 512)) })) as never,
      // The master is running something of its own; it must not be counted.
      masterApps: [{ name: 'unrelated', status: 'online', cpu: 99, memory: 99_999 }],
    }).getStackStatus('daos', 'test');

    expect(runtime.totalCpu).toBe(18);
    expect(runtime.totalMemory).toBe(3072);
  });
});

describe('a local stack still counts this machine', () => {
  it('reads the master process table, and calls its one node connected', async () => {
    const runtime = await service({
      type: 'local',
      masterApps: [
        { name: 'main', status: 'online', cpu: 1, memory: 10 },
        { name: 'geo', status: 'stopped', cpu: 0, memory: 0 },
      ],
    }).getStackStatus('daos', 'test');

    expect(runtime.totalApps).toBe(2);
    expect(runtime.onlineApps).toBe(1);
    expect(runtime.connectedNodes).toBe(1);
    expect(runtime.totalCpu).toBe(1);
  });

  it('does not ask any node about a local stack', async () => {
    const invokeOnSlave = vi.fn(async () => ({ apps: [] }));
    await service({ type: 'local', invokeOnSlave: invokeOnSlave as never }).getStackStatus('daos', 'test');

    expect(invokeOnSlave).not.toHaveBeenCalled();
  });
});
