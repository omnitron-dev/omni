import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ControllerHandoff } from '@omnitron-dev/titan-pm';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ExecutionHostService } from '../../src/daemon/execution-host.js';
import { ExecutionClient } from '../../src/daemon/execution-client.js';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { LogManager } from '../../src/monitoring/log-manager.js';
import { runtimeDiagnostics } from '../../src/monitoring/runtime-diagnostics.js';
import { EXECUTION_INVENTORY } from '../../src/orchestrator/execution-contract.js';
import type { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

const names = ['fixture/local/api', 'fixture/local/worker'];
const original = ['retained first line', 'retained second line', 'retained last line'];
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  runtimeDiagnostics.resolve('logs.legacy-owner');
  runtimeDiagnostics.resolve('execution.live-event-gap');
  runtimeDiagnostics.resolve('execution.state-persistence');
  runtimeDiagnostics.resolve('execution.acknowledgment-unavailable');
});

function fixture() {
  let emitLog!: (name: string, line: string) => void;
  const owner = { id: 'owner', pid: 42, startedAt: '2026-11-21T00:00:00Z' };
  const grant = { ownerId: owner.id, controllerId: 'active', epoch: 1 };
  const fence = new ControllerHandoff(owner, grant, async () => {});
  const getTail = vi.fn((lines: number) => original.slice(-lines));
  const handles = names.map(name => ({ entry: { name }, topologyPools: [], childMetrics: [], supervisor: null, startedAt: 1000,
    lastExit: { stderrTail: ['crash evidence'] }, getLogs: getTail }));
  const getLogs = vi.fn((name: string, lines: number) => [{ app: name, lines: original.slice(-lines) }]);
  const orchestrator = {
    onAppLog: (handler: typeof emitLog) => { emitLog = handler; }, on: vi.fn(), setMetricsBridge: vi.fn(),
    list: () => names.map(name => ({ name, status: 'stopped', pid: null, restarts: 0 })),
    getHandle: (name: string) => handles.find(handle => handle.entry.name === name), getLogs, getWatchedApps: () => [],
    hasDeclaredReadiness: () => false, drainChildSamples: async () => [],
  };
  const host = new ExecutionHostService(orchestrator as unknown as OrchestratorService, fence, {} as never,
    { statePersistence: () => ({ error: 'fixture write failure', pending: 1, failedWrites: 1 }) });
  return { host, getTail, getLogs, emitLog, grant };
}

async function controller(host: ExecutionHostService, legacy = false) {
  const client = new ExecutionClient('/unused-private-socket', createNullLogger(), 'active');
  const snapshot = vi.fn((request: { afterEvent?: number; appLogTails?: 'on-demand' }) =>
    host.snapshot(legacy ? (request.afterEvent === undefined ? {} : { afterEvent: request.afterEvent }) : request));
  const remote = { snapshot, read: vi.fn(host.read.bind(host)), acknowledge: vi.fn(host.acknowledge.bind(host)) };
  const channel = { service: async () => remote, disconnect: async () => {} };
  Object.assign(client, { connection: channel, observations: channel, grant: host.fence.status().controller });
  cleanups.push(() => client.close());
  const state = await client.connect();
  return { client, state, remote };
}

it('preserves the full response for old readers and omits only raw rings from an explicit inventory', async () => {
  const { host, emitLog, getTail, grant } = fixture();
  emitLog(names[0]!, 'event line');
  const full = await host.snapshot(), light = await host.snapshot(EXECUTION_INVENTORY);
  expect(getTail.mock.calls).toEqual([[1000], [1000]]);
  expect(full.apps.map(app => app.logs)).toEqual([original, original]);
  expect(light).toEqual({ ...full, revision: full.revision + 1, ...EXECUTION_INVENTORY,
    apps: full.apps.map(({ logs: _logs, ...app }) => app) });
  expect(light.apps[0]!.lastExit).toMatchObject({ stderrTail: ['crash evidence'] });
  expect(light.events).toEqual([{ sequence: 1, kind: 'log', app: names[0], detail: 'event line' }]);
  const mutation = { grant, method: 'drainChildSamples', sequence: 1, args: [] } as const;
  const compact = await host.mutate({ ...mutation, args: [], ...EXECUTION_INVENTORY });
  expect(compact.snapshot.appLogTails).toBe('on-demand');
  const replay = await host.mutate({ ...mutation, args: [] });
  expect(replay.snapshot.apps[0]).toHaveProperty('logs', original);
  const prepared = await host.prepare({ grant, candidateId: 'replacement' });
  expect(prepared.snapshot.apps[0]).toHaveProperty('logs', original);
  const reads = getTail.mock.calls.length;
  await host.commit({ ticket: prepared.ticket, inventoryDigest: light.inventoryDigest });
  expect(getTail).toHaveBeenCalledTimes(reads);
});

it('exposes lost events, the retained cursor and persistence diagnostics with the raw rings omitted', async () => {
  const { host, emitLog, getTail } = fixture();
  for (let i = 1; i <= 10_002; i++) emitLog(names[0]!, String(i));
  const compact = await host.snapshot({ ...EXECUTION_INVENTORY, afterEvent: 0 });
  expect(compact).toMatchObject({ lastEvent: 10_002, acknowledgedEvent: 0, droppedEvents: 2,
    statePersistence: { error: 'fixture write failure', pending: 1, failedWrites: 1 } });
  expect(compact.events).toHaveLength(10_000);
  expect(compact.events[0]).toMatchObject({ sequence: 3, detail: '3' });
  expect(compact.events.at(-1)).toMatchObject({ sequence: 10_002, detail: '10002' });
  expect(getTail).not.toHaveBeenCalled();
});

it('reports a missing legacy ring instead of treating it as an empty tail', async () => {
  const { host } = fixture();
  const { client, state } = await controller(host, true);
  Reflect.deleteProperty(state.apps[0]!, 'logs');
  expect(() => client.orchestrator.getLogs(names[0])).toThrow('omitted the requested log tail');
});

it.each([false, true])('answers explicit private tails and reads public log events without a journal (legacy owner %s)', async legacy => {
  const { host, emitLog, getTail, getLogs } = fixture();
  const { client, state, remote } = await controller(host, legacy);
  const home = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'owner-logs-'));
  const logs = new LogManager({ baseDir: home, defaults: { maxSize: '1m', maxFiles: 1, compress: false } }, client.orchestrator);
  cleanups.push(async () => { await logs.dispose(); await fs.rm(home, { recursive: true, force: true }); });
  const service = new DaemonRpcService(client.orchestrator, {} as never, logs, {} as never, {} as never);
  // The daemon wires these listeners before it admits observation delivery.
  client.orchestrator.onAppLog((name, line, context) => logs.appendToFile(name, line, context));
  const confirmPending = vi.fn(async () => {}), setCaptureStatus = vi.fn();
  client.setLogCollector({ confirmPending, setCaptureStatus } as never);
  emitLog(names[0]!, '{"level":40,"msg":"delivered through the owner event"}');
  emitLog(names[1]!, '{"level":30,"msg":"independent application event"}');
  await client.activateObservations();
  await client.controlledOwnerSnapshot();
  expect(remote.snapshot.mock.calls.every(([request]) => request.appLogTails === 'on-demand')).toBe(true);
  expect(state.appLogTails).toBe(legacy ? undefined : 'on-demand');
  expect((await service.getLogs({ name: names[0]!, lines: 1 })).map(entry => [entry.level, entry.message])).toEqual([['warn', 'delivered through the owner event']]);
  expect((await service.getLogs({ lines: 2 })).map(entry => entry.app)).toEqual(names);
  expect(confirmPending).toHaveBeenCalledOnce();
  expect(setCaptureStatus).toHaveBeenCalledWith('legacy-owner');
  expect(remote.acknowledge.mock.calls[0]![0].cursor).toBe(2);
  expect(confirmPending.mock.invocationCallOrder[0]!).toBeLessThan(remote.acknowledge.mock.invocationCallOrder[0]!);
  expect((await host.snapshot(EXECUTION_INVENTORY)).events).toEqual([]);
  expect(getLogs).not.toHaveBeenCalled();
  expect(await client.orchestrator.getLogs('')).toEqual([]);
  expect(await client.orchestrator.getLogs('unregistered')).toEqual([]);
  const tails = client.orchestrator.getLogs('worker', 2);
  expect(tails instanceof Promise).toBe(!legacy);
  expect(await tails).toEqual([{ app: names[1], lines: original.slice(-2) }]);
  expect(getLogs).toHaveBeenCalledTimes(legacy ? 0 : 1);
  if (!legacy) expect(getTail).not.toHaveBeenCalled();
});

it('propagates a failed explicit tail read and retains unconfirmed legacy log events on the owner', async () => {
  const { host, emitLog } = fixture();
  const { client, remote } = await controller(host);
  remote.read.mockRejectedValueOnce(Error('tail unavailable'));
  await expect(client.orchestrator.getLogs(names[0])).rejects.toThrow('tail unavailable');
  const received = vi.fn(), confirmPending = vi.fn(async () => {});
  confirmPending.mockRejectedValueOnce(Error('log store unavailable'));
  client.setLogCollector({ confirmPending, setCaptureStatus: vi.fn() } as never);
  client.orchestrator.onAppLog(received);
  emitLog(names[0]!, 'raw legacy line');
  await client.activateObservations();
  expect(remote.acknowledge).not.toHaveBeenCalled();
  const pending = await host.snapshot(EXECUTION_INVENTORY);
  expect(pending.acknowledgedEvent).toBe(0);
  expect(pending.events.map(event => event.detail)).toEqual(['raw legacy line']);
  await client.activateObservations();
  expect(received).toHaveBeenCalledOnce();
  expect(remote.acknowledge).toHaveBeenCalledOnce();
  expect((await host.snapshot(EXECUTION_INVENTORY)).acknowledgedEvent).toBe(1);
});
