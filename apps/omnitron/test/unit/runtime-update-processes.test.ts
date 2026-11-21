import { expect, it, vi } from 'vitest';
import { ControllerHandoff } from '@omnitron-dev/titan-pm';
import { ExecutionHostService } from '../../src/daemon/execution-host.js';
import { PROCESS_REVIEW_WAIT_MS, readRetiringRuntimeProcesses, retiringRuntimePids } from '../../src/daemon/runtime-update-processes.js';
import { RuntimeObservationConflict, RuntimeObservationPending, RuntimeObservationTimeout } from '../../src/daemon/runtime-observation.js';
import type { RuntimeUpdateStatusObservation } from '../../src/shared/dto/runtime-update.js';

async function fixture(drainChildSamples: () => Promise<unknown> = async () => []) {
  const owner = { id: 'fixture-owner', pid: 40, startedAt: '2026-01-01T00:00:00Z' };
  const fence = new ControllerHandoff(owner, { ownerId: owner.id, controllerId: 'active-backend', epoch: 3 }, async () => {});
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
      list: () => rows, getWatchedApps: () => [], getHealth: async () => ({}), drainChildSamples,
      getHandle: (name: string) => ({
        entry: { name }, startedAt: 1000, childMetrics: [], getLogs: () => [],
        supervisor: name === 'catalog' ? { getChildNames: () => ['catalog/http'], getChildProcessId: () => 'http' } : null,
        topologyPools: name === 'catalog' ? [['transform', { getWorkerIds: () => ['transform-a', 'transform-b'] }]] : [],
      }),
      getChildProcessInfo: (id: string) => ({ id, startTime: 1000, pid: workers.get(id) }),
      getWorkerHandle: (id: string) => ({ pid: workers.get(id) }), hasDeclaredReadiness: () => false,
    },
    fence,
    hooks: {}, acknowledgedEvent: 0, events: [], revision: 0,
  }) as ExecutionHostService;
  const snapshot = await host.snapshot();
  const status = { pid: 42, execution: { owner, epoch: 3 }, apps: structuredClone(rows) } as unknown as RuntimeUpdateStatusObservation;
  return { snapshot, status, host, fence };
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

it('waits out one admitted metrics drain while independent health and inventory reads complete', async () => {
  const gate = Promise.withResolvers<void>();
  const drain = vi.fn(() => gate.promise);
  const { host, fence, status } = await fixture(drain);
  const mutation = host.mutate({ grant: fence.status().controller, sequence: 1, method: 'drainChildSamples', args: [] });
  const concurrent = await Promise.all([host.snapshot(), host.read({ method: 'getHealth', args: [] })]);
  expect(concurrent[0].status.inFlight).toBe(1);
  expect(() => retiringRuntimePids(concurrent[0], 42, 41, status)).toThrow(RuntimeObservationPending);
  const read = vi.fn(() => host.snapshot());
  const progress = vi.fn(() => gate.resolve());
  try {
    const settled = await readRetiringRuntimeProcesses(read, status, 41, 'prepare', progress);
    expect(settled.retiredPids).toEqual([41, 42, 200, 201, 202, 300]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenCalledOnce();
    expect(drain).toHaveBeenCalledOnce();
  } finally { gate.resolve(); await mutation; }
});

it('ends a persistently busy preparation at its deadline', async () => {
  const { snapshot, status } = await fixture();
  snapshot.status.inFlight = 1;
  let elapsed = 0;
  const time = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const read = vi.fn(async () => {
    if (read.mock.calls.length > 1) elapsed = PROCESS_REVIEW_WAIT_MS;
    return snapshot;
  });
  try {
    await expect(readRetiringRuntimeProcesses(read, status, 41, 'prepare')).rejects.toBeInstanceOf(RuntimeObservationTimeout);
    expect(read).toHaveBeenCalledTimes(2);
  } finally { time.mockRestore(); }
});

it.each(['inventory', 'generation', 'epoch'] as const)('refuses a changed %s during the preparation wait', async change => {
  const { snapshot, status } = await fixture();
  const busy = structuredClone(snapshot);
  busy.status.inFlight = 1;
  if (change === 'inventory') snapshot.inventoryDigest = '0'.repeat(64);
  if (change === 'generation') snapshot.apps[0]!.info.generation = 'replacement';
  if (change === 'epoch') snapshot.status.controller.epoch++;
  const read = vi.fn().mockResolvedValueOnce(busy).mockResolvedValue(snapshot);
  await expect(readRetiringRuntimeProcesses(read, status, 41, 'prepare')).rejects.toBeInstanceOf(RuntimeObservationConflict);
  expect(read).toHaveBeenCalledTimes(2);
});

it('refuses malformed activity and transport errors on the first preparation read', async () => {
  const { snapshot, status } = await fixture();
  snapshot.status.inFlight = -1;
  const malformed = vi.fn(async () => snapshot);
  await expect(readRetiringRuntimeProcesses(malformed, status, 41, 'prepare')).rejects.toThrow('Invalid native process inventory');
  expect(malformed).toHaveBeenCalledOnce();
  const failed = vi.fn(async () => { throw Error('private socket disconnected'); });
  await expect(readRetiringRuntimeProcesses(failed, status, 41, 'prepare')).rejects.toThrow('private socket disconnected');
  expect(failed).toHaveBeenCalledOnce();
  const unavailable = vi.fn(async () => { throw new RuntimeObservationPending('controller', 'controller starting'); });
  await expect(readRetiringRuntimeProcesses(unavailable, status, 41, 'prepare')).rejects.toThrow('did not report its activity');
  expect(unavailable).toHaveBeenCalledOnce();
});
