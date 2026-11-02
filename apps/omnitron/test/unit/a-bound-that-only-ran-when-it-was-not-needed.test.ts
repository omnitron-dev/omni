import { expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { SyncService } from '../../src/services/sync.service.js';

it('bounds a disconnected worker outbox on startup and each interval until shutdown', async () => {
  vi.useFakeTimers();
  const worker = new SyncService({} as never, createNullLogger(), 'edge', 'slave', { interval: 1000 });
  const bounds = vi.fn(async () => {});
  Object.assign(worker, { enforceBufferBounds: bounds });
  try {
    worker.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(bounds).toHaveBeenCalledTimes(3);
    await worker.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(bounds).toHaveBeenCalledTimes(3);
  } finally { await worker.stop(); vi.useRealTimers(); }
});

it('coalesces slow eviction passes and finishes the active pass before the store can close', async () => {
  vi.useFakeTimers();
  const worker = new SyncService({} as never, createNullLogger(), 'edge', 'slave', { interval: 1000 });
  let finish!: () => void;
  const bounds = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  Object.assign(worker, { enforceBufferBounds: bounds });
  try {
    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(bounds).toHaveBeenCalledOnce();
    const closed = vi.fn();
    const closing = worker.stop().then(closed);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(closed).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(bounds).toHaveBeenCalledOnce();
  } finally { finish?.(); await worker.stop(); vi.useRealTimers(); }
});
