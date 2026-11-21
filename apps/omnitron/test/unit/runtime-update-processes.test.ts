import { expect, it } from 'vitest';
import { ExecutionHostService } from '../../src/daemon/execution-host.js';
import { retiringRuntimePids } from '../../src/daemon/runtime-update-processes.js';
import type { RuntimeUpdateStatusObservation } from '../../src/shared/dto/runtime-update.js';

async function fixture() {
  const owner = { id: 'fixture-owner', pid: 40, startedAt: '2026-01-01T00:00:00Z' };
  const rows = [
    { name: 'catalog', generation: 'launch', pid: 200, status: 'online', processes: [
      { name: 'transform', status: 'online', instances: 2, declaredInstances: 2, pid: 202 },
    ] },
    { name: 'archived', pid: null, status: 'stopped' },
    { name: 'classic', pid: 300, status: 'online' },
  ];
  const workers = new Map([['http', 200], ['transform-a', 201], ['transform-b', 202]]);
  // Exercise the same protocol-1 producer that existing resident owners expose.
  const host = Object.assign(Object.create(ExecutionHostService.prototype), {
    orchestrator: {
      list: () => rows, getWatchedApps: () => [],
      getHandle: (name: string) => ({
        entry: { name }, startedAt: 1000, childMetrics: [], getLogs: () => [],
        supervisor: name === 'catalog' ? { getChildNames: () => ['catalog/http'], getChildProcessId: () => 'http' } : null,
        topologyPools: name === 'catalog' ? [['transform', { getWorkerIds: () => ['transform-a', 'transform-b'] }]] : [],
      }),
      getChildProcessInfo: (id: string) => ({ id, startTime: 1000, pid: workers.get(id) }),
      getWorkerHandle: (id: string) => ({ pid: workers.get(id) }), hasDeclaredReadiness: () => false,
    },
    fence: { status: () => ({ owner, phase: 'active', inFlight: 0, controller: { ownerId: owner.id, controllerId: 'active-backend', epoch: 3 } }) },
    hooks: {}, acknowledgedEvent: 0, events: [], revision: 0,
  }) as ExecutionHostService;
  const snapshot = await host.snapshot();
  const status = { execution: { owner, epoch: 3 }, apps: structuredClone(rows) } as unknown as RuntimeUpdateStatusObservation;
  return { snapshot, status };
}

it('captures both pool workers, the supervisor and a classic process from an existing owner', async () => {
  const { snapshot, status } = await fixture();
  expect(retiringRuntimePids(snapshot, 42, 41, status)).toEqual([41, 42, 200, 201, 202, 300]);
  expect(status.apps[0]!.processes).toHaveLength(1);
  expect(status.apps[0]!.processes![0]).toMatchObject({ pid: 202, instances: 2 });
});

it('accepts a previously stopped application with an explicitly empty pool and its retained declaration', async () => {
  const { snapshot, status } = await fixture();
  const stopped = snapshot.apps[1]!;
  stopped.pools = [{ name: 'transform', workerIds: [] }];
  stopped.children = [{ name: 'archived/transform' }];
  stopped.info.processes = [{ ...snapshot.apps[0]!.info.processes![0]!, status: 'stopped', pid: null, instances: 0, declaredInstances: 2 }];
  status.apps[1]!.processes = structuredClone(stopped.info.processes);
  expect(retiringRuntimePids(snapshot, 42, 41, status)).toEqual([41, 42, 200, 201, 202, 300]);
});

it('retains the known subset of a partially started pool and allows a worker-only app without a primary PID', async () => {
  const { snapshot } = await fixture();
  const app = snapshot.apps[0]!;
  app.info.pid = null;
  app.info.processes![0]!.pid = null;
  app.children = [{ name: 'catalog/transform' }]; // A pool proxy does not have a single process ID.
  snapshot.workers = snapshot.workers.filter(w => w.info.id !== 'http');
  expect(retiringRuntimePids(snapshot, 42, 41)).toEqual([41, 42, 201, 202, 300]);
  app.info.status = 'crashed';
  app.children.push({ name: 'catalog/http' }); // A supervisor child has exited.
  app.pools[0]!.workerIds = ['transform-b'];
  app.info.processes![0]!.instances = 1;
  snapshot.workers = snapshot.workers.filter(w => w.info.id !== 'transform-a');
  expect(retiringRuntimePids(snapshot, 42, 41)).toEqual([41, 42, 202, 300]);
});

it.each(['missing worker', 'missing PID', 'conflicting PID', 'partial group', 'missing pool', 'epoch', 'owner', 'generation', 'stopped with workers', 'in flight'] as const)(
  'declines a retirement certificate on %s', async change => {
    const { snapshot, status } = await fixture();
    if (change === 'missing worker') snapshot.workers = snapshot.workers.filter(w => w.info.id !== 'transform-a');
    if (change === 'missing PID') delete snapshot.workers[1]!.pid;
    if (change === 'conflicting PID') snapshot.workers[1]!.info.pid = 999;
    if (change === 'partial group') status.apps[0]!.processes![0]!.instances = 1;
    if (change === 'missing pool') {
      const app = snapshot.apps[0]!;
      app.pools = [];
      snapshot.workers = snapshot.workers.filter(w => w.info.id === 'http');
      Object.assign(app.info.processes![0]!, { instances: 1, pid: app.info.pid });
      status.apps[0]!.processes = structuredClone(app.info.processes!);
    }
    if (change === 'epoch') status.execution!.epoch = 4;
    if (change === 'owner') status.execution!.owner = { ...status.execution!.owner!, id: 'different-owner' };
    if (change === 'generation') status.apps[0]!.generation = 'restarted';
    if (change === 'stopped with workers') snapshot.apps[0]!.info.status = 'stopped';
    if (change === 'in flight') snapshot.status.inFlight = 1;
    expect(() => retiringRuntimePids(snapshot, 42, 41, status)).toThrow();
  }
);
