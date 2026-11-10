import { afterEach, expect, it, vi } from 'vitest';
import { observeStackStart } from '../../src/shared/release-reading.js';
import type { DeployProgressRecord } from '../../src/shared/dto/services.js';

afterEach(() => { vi.useRealTimers(); });

it('shows only changing activity in the selected target and waits for the actual stack reply', async () => {
  vi.useFakeTimers();
  const base: DeployProgressRecord = { project: 'sample', stack: 'test', releaseId: 'build', operationId: 'previous',
    node: 'host', app: 'api', status: 'success', progress: 100, at: '2026-02-01T00:00:00Z', message: 'previous install' };
  const next: DeployProgressRecord = { ...base, operationId: 'current', status: 'waiting', progress: 0, message: 'host is reserved' };
  const reply = Promise.withResolvers<string>();
  const read = vi.fn().mockResolvedValueOnce([base]).mockResolvedValueOnce([next, { ...next, project: 'another' }])
    .mockRejectedValueOnce(Error('connection lost')).mockResolvedValue([{ ...next, status: 'success', progress: 100 }]);
  const update = vi.fn();
  const start = vi.fn(() => reply.promise);
  const running = observeStackStart({ project: 'sample', stack: 'test', release: 'build' }, start, read, update, 100);
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith([], [], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(update).toHaveBeenLastCalledWith([next], [next], true);
  await vi.advanceTimersByTimeAsync(100);
  expect(update).toHaveBeenLastCalledWith([next], [], false);
  await vi.advanceTimersByTimeAsync(100);
  expect(start).toHaveBeenCalledTimes(1);
  reply.resolve('actual stack result');
  expect(await running).toBe('actual stack result');
  const polls = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(500);
  expect(read).toHaveBeenCalledTimes(polls);
});
