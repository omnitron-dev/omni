import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ProcessSupervisor } from '../src/process-supervisor.js';
import { RestartDecision, SupervisionStrategy, type ISupervisorConfig } from '../src/types.js';

const supervisors: ProcessSupervisor[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(supervisors.splice(0).map(supervisor => supervisor.stop()));
  vi.useRealTimers();
});
function fixture(config: Partial<ISupervisorConfig> = {}) {
  let id = 0;
  const events = new EventEmitter();
  const manager = Object.assign(events, {
    spawn: vi.fn(async () => ({ __processId: `p${++id}` })), kill: vi.fn(async () => true),
  });
  const supervisor = ProcessSupervisor.fromConfig(manager as never, {
    strategy: SupervisionStrategy.ONE_FOR_ONE, maxRestarts: 3, window: 1000,
    backoff: { type: 'fixed', initial: 10, max: 10 },
    children: [{ name: 'worker', process: '/fixture/worker' }], ...config,
  }, createNullLogger());
  supervisors.push(supervisor);
  return { manager, supervisor };
}

it('retries an initial noncritical startup failure without losing its declaration', async () => {
  const { manager, supervisor } = fixture();
  manager.spawn.mockRejectedValueOnce(new Error('database down')).mockRejectedValueOnce(new Error('still down'));
  const failed = vi.fn(); supervisor.on('child:start-failed', failed);
  await supervisor.start();
  await vi.advanceTimersByTimeAsync(50);
  expect(manager.spawn).toHaveBeenCalledTimes(3);
  expect(failed).toHaveBeenCalledTimes(2);
  expect(supervisor.getChildProxy('worker')).not.toBeNull();
});

it('continues bounded recovery when a crash restart itself cannot boot', async () => {
  const { manager, supervisor } = fixture();
  await supervisor.start();
  manager.spawn.mockRejectedValueOnce(new Error('dependency lost')).mockRejectedValueOnce(new Error('dependency unavailable'));
  manager.emit('process:crash', { id: 'p1' }, new Error('connection closed'));
  await vi.advanceTimersByTimeAsync(80);
  expect(manager.spawn).toHaveBeenCalledTimes(4);
  expect(supervisor.getChildProxy('worker')).not.toBeNull();
});

it('stops at the configured budget and leaves the last failure observable', async () => {
  const { manager, supervisor } = fixture({ maxRestarts: 2 });
  manager.spawn.mockRejectedValue(new Error('authentication refused'));
  const stopped = vi.fn(); supervisor.on('child:recovery-stopped', stopped);
  await supervisor.start(); await vi.advanceTimersByTimeAsync(100);
  expect(manager.spawn).toHaveBeenCalledTimes(3);
  expect(stopped).toHaveBeenCalledWith('worker', expect.objectContaining({ message: 'authentication refused' }));
  await vi.advanceTimersByTimeAsync(2000);
  expect(manager.spawn).toHaveBeenCalledTimes(3);
});

it('honours zero retries and allows an explicit retry of the missing child', async () => {
  const { manager, supervisor } = fixture({ maxRestarts: 0 });
  manager.spawn.mockRejectedValueOnce(new Error('not ready'));
  await supervisor.start(); await vi.advanceTimersByTimeAsync(100);
  expect(manager.spawn).toHaveBeenCalledTimes(1);
  await supervisor.restartChild('worker');
  expect(supervisor.getChildProxy('worker')).not.toBeNull();
});

it('preserves fail-fast critical initial startup', async () => {
  const { manager, supervisor } = fixture({ children: [{ name: 'worker', process: '/fixture/worker', critical: true }] });
  manager.spawn.mockRejectedValue(new Error('fatal configuration'));
  await expect(supervisor.start()).rejects.toThrow('fatal configuration');
  await vi.advanceTimersByTimeAsync(100);
  expect(manager.spawn).toHaveBeenCalledTimes(1);
});

it('cancels retries immediately on stop and never resurrects the child', async () => {
  const { manager, supervisor } = fixture();
  manager.spawn.mockRejectedValue(new Error('unavailable'));
  await supervisor.start(); await supervisor.stop(); await vi.advanceTimersByTimeAsync(500);
  expect(manager.spawn).toHaveBeenCalledTimes(1);
  expect(manager.listenerCount('process:crash')).toBe(0);
});

it('joins an in-flight restart before stopping its newly ready process', async () => {
  const { manager, supervisor } = fixture();
  await supervisor.start();
  let ready!: (proxy: { __processId: string }) => void;
  manager.spawn.mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  manager.emit('process:crash', { id: 'p1' }, new Error('crash'));
  await vi.advanceTimersByTimeAsync(20);
  const stopping = supervisor.stop();
  ready({ __processId: 'late' }); await stopping;
  expect(manager.kill).toHaveBeenCalledWith('late');
  expect(supervisor.getChildProxy('worker')).toBeNull();
});

it('coalesces duplicate crash reports while a restart waits', async () => {
  const { manager, supervisor } = fixture(); await supervisor.start();
  for (let i = 0; i < 4; i++) manager.emit('process:crash', { id: 'p1' }, new Error('same crash'));
  await vi.advanceTimersByTimeAsync(100);
  expect(manager.spawn).toHaveBeenCalledTimes(2);
});

it('honours a shutdown decision without waiting on its own recovery loop', async () => {
  const { manager, supervisor } = fixture({ onChildCrash: async () => RestartDecision.SHUTDOWN });
  await supervisor.start(); manager.emit('process:crash', { id: 'p1' }, new Error('stop tree'));
  await vi.advanceTimersByTimeAsync(100);
  expect(supervisor.getChildProxy('worker')).toBeNull();
  expect(manager.listenerCount('process:crash')).toBe(0);
});

describe.each([SupervisionStrategy.ONE_FOR_ALL, SupervisionStrategy.REST_FOR_ONE])('%s', strategy => {
  it('retains a failed child in declaration order through group recovery', async () => {
    const { manager, supervisor } = fixture({ strategy, children: [
      { name: 'dependency', process: '/fixture/dependency' }, { name: 'consumer', process: '/fixture/consumer' },
    ] });
    manager.spawn.mockRejectedValueOnce(new Error('dependency unavailable'));
    await supervisor.start(); await vi.advanceTimersByTimeAsync(100);
    expect(supervisor.getChildProxy('dependency')).not.toBeNull();
    expect(supervisor.getChildProxy('consumer')).not.toBeNull();
    expect(manager.spawn).toHaveBeenCalledTimes(4);
  });
});

it('retries a critical child after a later crash without changing fail-fast initial startup', async () => {
  const { manager, supervisor } = fixture({ children: [{ name: 'worker', process: '/fixture/worker', critical: true }] });
  await supervisor.start();
  manager.spawn.mockRejectedValueOnce(new Error('temporary dependency outage'));
  manager.emit('process:crash', { id: 'p1' }, new Error('disconnected'));
  await vi.advanceTimersByTimeAsync(100);
  expect(manager.spawn).toHaveBeenCalledTimes(3);
  expect(supervisor.getChildProxy('worker')).not.toBeNull();
});

it('retains a crash reported while another initial child is still starting', async () => {
  const { manager, supervisor } = fixture({ children: [
    { name: 'worker', process: '/fixture/worker' }, { name: 'slow', process: '/fixture/slow' },
  ] });
  let ready!: (proxy: { __processId: string }) => void;
  manager.spawn.mockResolvedValueOnce({ __processId: 'early' })
    .mockImplementationOnce(() => new Promise(resolve => { ready = resolve; }));
  const starting = supervisor.start(); await vi.advanceTimersByTimeAsync(0);
  manager.emit('process:crash', { id: 'early' }, new Error('early crash'));
  ready({ __processId: 'slow' }); await starting; await vi.advanceTimersByTimeAsync(100);
  expect(manager.spawn).toHaveBeenCalledTimes(3);
  expect(supervisor.getChildProxy('worker').__processId).not.toBe('early');
});
