import { describe, expect, it, vi } from 'vitest';
import { StateStore } from '../../src/daemon/state-store.js';
import type { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
const state = { version: '1', updatedAt: 1, apps: [] };
const full = Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' });
const turn = () => new Promise(resolve => setImmediate(resolve));

describe('execution state persistence failure boundary', () => {
  it('observes fire-and-forget failure without acknowledging durability, then recovers on a newer full snapshot', async () => {
    const write = vi.fn().mockRejectedValueOnce(full).mockResolvedValue(undefined);
    const store = new StateStore({ kvSet: write } as unknown as DaemonStateStore);
    store.save(state);
    await turn(); // no flush/catch attached by a caller: an escaped rejection fails Vitest
    expect(store.persistenceStatus()).toEqual({ pending: 0, failedWrites: 1, error: full.message });
    await expect(store.flush()).rejects.toBe(full);
    await expect(store.flush()).rejects.toBe(full);
    store.save({ ...state, updatedAt: 2 });
    await store.flush();
    expect(store.persistenceStatus()).toEqual({ pending: 0, failedWrites: 1, error: null });
    expect(write.mock.calls[1]![1]).toMatchObject({ updatedAt: 2 });
  });

  it('preserves failed clear evidence and clears it only after successful replacement', async () => {
    const store = new StateStore({ kvDelete: vi.fn().mockRejectedValue(full), kvSet: vi.fn().mockResolvedValue(undefined) } as unknown as DaemonStateStore);
    store.clear(); await turn();
    await expect(store.flush()).rejects.toBe(full);
    store.save(state); await store.flush();
    expect(store.persistenceStatus().error).toBeNull();
  });

  it('serializes later writes and flush waits for writes admitted while it was waiting', async () => {
    let release!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }))
      .mockRejectedValueOnce(full);
    const store = new StateStore({ kvSet: write } as unknown as DaemonStateStore);
    store.save(state); await turn();
    const flushed = store.flush();
    const rejected = expect(flushed).rejects.toBe(full);
    store.save({ ...state, updatedAt: 2 });
    expect(write).toHaveBeenCalledTimes(1);
    release(); await rejected;
    expect(write).toHaveBeenCalledTimes(2);
    expect(store.persistenceStatus().pending).toBe(0);
  });
});
