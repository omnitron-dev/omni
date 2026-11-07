import { afterEach, expect, it, vi } from 'vitest';
import { RedisTestManager } from './redis-manager.js';

const original = Reflect.get(RedisTestManager, '_dockerManager');
afterEach(() => Reflect.set(RedisTestManager, '_dockerManager', original));

it('drains delayed container creation and cleans every returned peer before its network', async () => {
  const failure = Error('first node refused');
  const events: string[] = [];
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const manager = {
    usedPorts: new Set<number>(),
    ensureNetwork: vi.fn(async () => {}),
    findAvailablePort: vi.fn(async () => 24000 + manager.findAvailablePort.mock.calls.length),
    createContainer: vi.fn(async (options) => {
      const number = manager.createContainer.mock.calls.length;
      if (number === 1) throw failure;
      if (number === 6) await delayed;
      events.push('created-' + number);
      return { name: options.name, host: '127.0.0.1', ports: new Map([[6379, options.ports[6379]]]),
        cleanup: vi.fn(async () => { events.push('removed-' + number); }) };
    }),
    removeNetwork: vi.fn(async () => { events.push('network-removed'); }),
  };
  Reflect.set(RedisTestManager, '_dockerManager', manager);
  const result = RedisTestManager.createRedisCluster().catch(error => error);
  await vi.waitFor(() => expect(manager.createContainer).toHaveBeenCalledTimes(6));
  expect(manager.removeNetwork).not.toHaveBeenCalled();
  expect(events.every(event => event.startsWith('created-'))).toBe(true);
  release();
  const error = await result;
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([failure]);
  expect(events.slice(-6)).toEqual(['removed-2', 'removed-3', 'removed-4', 'removed-5', 'removed-6', 'network-removed']);
  for (const [options] of manager.createContainer.mock.calls) {
    expect(options.command.slice(options.command.indexOf('--save'), options.command.indexOf('--save') + 2)).toEqual(['--save', '']);
  }
});

it('keeps startup and cleanup failures visible together', async () => {
  const startup = Error('node refused'), cleanup = Error('network still owned');
  Reflect.set(RedisTestManager, '_dockerManager', {
    usedPorts: new Set(), ensureNetwork: vi.fn(async () => {}), findAvailablePort: vi.fn(async () => 24001),
    createContainer: vi.fn(async () => { throw startup; }),
    removeNetwork: vi.fn(async () => { throw cleanup; }),
  });
  const error = await RedisTestManager.createRedisCluster({ masterCount: 1, replicasPerMaster: 0 }).catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors[0].errors).toEqual([startup]);
  expect(error.errors[1].errors).toEqual([cleanup]);
});
