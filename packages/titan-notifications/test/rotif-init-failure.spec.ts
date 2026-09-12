/**
 * A failed initialization must FAIL, not hang.
 *
 * `NotificationManager`'s constructor kicks off `loadLuaScripts().then(…)` and
 * resolves `initializationDefer` on the last line of that callback. Six public
 * methods open with `await this.initializationDefer.promise`. Anything that
 * threw earlier in the callback therefore left the promise pending forever —
 * every publish and every subscribe waiting on an event that could no longer
 * happen, with no timeout on that path — while the rejection itself had no
 * handler and would end the process.
 *
 * The regression shape is a HANG, so these tests assert with an explicit race
 * against a short timer: a test that merely awaited would fail by timing out
 * after two minutes, which is a far worse signal.
 */
import { describe, it, expect, vi } from 'vitest';

import { NotificationManager } from '../src/rotif/rotif.js';

/** Resolve to 'pending' if `p` has not settled within `ms`. */
async function settledWithin<T>(p: Promise<T>, ms = 500): Promise<'resolved' | 'rejected' | 'pending'> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms);
  });
  try {
    return await Promise.race([
      p.then(
        () => 'resolved' as const,
        () => 'rejected' as const
      ),
      guard,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe('NotificationManager initialization failure', () => {
  it('rejects waitUntilReady() instead of leaving it pending forever', async () => {
    const manager = new NotificationManager({
      redis: { host: '127.0.0.1', port: 6399, lazyConnect: true, maxRetriesPerRequest: 1 },
      disableDelayed: true,
      enableHealthCheck: false,
    } as never);

    // Force the post-load step to throw, which is what a malformed Redis URL
    // does through `subscribeToPatternUpdates` -> `createConnection`.
    vi.spyOn(manager as never, 'subscribeToPatternUpdates' as never).mockImplementation(() => {
      throw new Error('cannot open pattern-updates connection');
    });

    const outcome = await settledWithin((manager as unknown as { initializationDefer: { promise: Promise<unknown> } }).initializationDefer.promise);
    expect(outcome, 'initialization promise never settled — every publish would hang').not.toBe('pending');

    await manager.stop?.().catch(() => undefined);
  });
});
