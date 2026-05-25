/**
 * Browser-native lock adapter via `navigator.locks.request()`.
 *
 * The Web Locks API guarantees:
 *   - exclusive locks across tabs/workers of the same origin
 *   - automatic release on context teardown (tab close, frame
 *     unload, worker termination) — no zombie-leader risk
 *   - FIFO queueing of waiters
 *
 * The contract `ILeaderLock.acquire` expects: invoke `onAcquired`
 * when the lock is granted, and keep the lock held until
 * `onAcquired`'s returned promise resolves. The Locks API uses
 * exactly the same pattern, so this adapter is a thin wrapper.
 */

import type { ILeaderLock } from './types.js';
import { LeaderElectionUnavailableError } from './types.js';

interface NavigatorWithLocks {
  locks?: {
    request: (
      name: string,
      callback: (lock: unknown) => Promise<void> | void,
    ) => Promise<void>;
  };
}

/**
 * Build a Web-Locks-backed lock adapter. Throws on construction
 * (not on first `acquire`) if `navigator.locks` is unavailable —
 * caught at `createLeaderElection` time so the caller sees the
 * problem during setup instead of when the first lock attempt
 * silently no-ops.
 */
export function createWebLocksAdapter(): ILeaderLock {
  const nav = (globalThis as { navigator?: NavigatorWithLocks }).navigator;
  if (!nav?.locks?.request) {
    throw new LeaderElectionUnavailableError('navigator.locks');
  }
  const requestLock = nav.locks.request.bind(nav.locks);
  return {
    async acquire(name, onAcquired) {
      // The lock is held for the duration of the inner promise.
      // We expose `release()` to the caller so they can drop the
      // lock voluntarily (e.g. on dispose) instead of waiting for
      // tab teardown. Idempotency: the released flag guards the
      // resolver so double-call is a no-op.
      await requestLock(name, () => {
        let released = false;
        return new Promise<void>((resolve) => {
          const release = () => {
            if (released) return;
            released = true;
            resolve();
          };
          // Bridge any error from onAcquired into release so the
          // lock doesn't get stuck on a thrown callback. The error
          // is intentionally swallowed here — the election layer
          // owns failure handling on its own promise chain.
          try {
            const ret = onAcquired(release);
            if (ret && typeof (ret as Promise<void>).then === 'function') {
              (ret as Promise<void>).then(release, release);
            }
          } catch {
            release();
          }
        });
      });
    },
  };
}
