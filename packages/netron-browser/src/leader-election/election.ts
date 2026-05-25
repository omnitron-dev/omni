/**
 * Leader-election primitive.
 *
 * Algorithm:
 *   1. Construct: install lock + channel adapters; subscribe to
 *      channel inbound; start lock acquisition asynchronously.
 *      Initial role = 'follower'.
 *   2. When the lock is granted: flip role → 'leader', fire role
 *      change. Stay leader until either:
 *        a. `dispose()` is called → release lock voluntarily.
 *        b. The lock's holding context dies (tab close) →
 *           browser releases the lock automatically.
 *   3. When the lock is released (either way): another waiter
 *      promotes. Its `onAcquired` fires; same flip.
 *
 * Multi-tab contract: only ONE participant holds 'leader' at any
 * point. Self-broadcast is locally re-dispatched so consumers see
 * uniform "broadcast → all peers (including self)" semantics
 * regardless of role (BroadcastChannel doesn't echo to the sender
 * natively).
 */

import { createWebLocksAdapter } from './web-locks-lock.js';
import { createBroadcastChannelAdapter } from './broadcast-channel.js';
import type {
  ILeaderChannel,
  ILeaderLock,
  LeaderElectionHandle,
  LeaderElectionOptions,
  LeaderRole,
} from './types.js';

export function createLeaderElection(options: LeaderElectionOptions): LeaderElectionHandle {
  const lock: ILeaderLock = options.lock ?? createWebLocksAdapter();
  const channel: ILeaderChannel =
    options.channel ?? createBroadcastChannelAdapter(options.channelName);

  let role: LeaderRole = 'follower';
  let disposed = false;
  /**
   * Set when this participant holds the lock — calling it releases
   * the lock and resolves the `acquire` adapter's inner promise so
   * the next waiter can promote. Nulled on release. Read by
   * `dispose()` to drop the lock voluntarily.
   */
  let releaseLock: (() => void) | null = null;
  const roleSubscribers = new Set<(role: LeaderRole) => void>();
  const messageSubscribers = new Set<(data: unknown) => void>();
  let disposePromise: Promise<void> | null = null;

  function setRole(next: LeaderRole) {
    if (role === next) return;
    role = next;
    for (const handler of roleSubscribers) {
      try {
        handler(role);
      } catch {
        // Subscriber errors are isolated — one bad handler must not
        // tear down siblings.
      }
    }
  }

  // ---------------------------------------------------------------
  // Channel wiring — runs for every role. The election needs the
  // channel up before any inbound traffic can arrive (a leader may
  // already exist in another tab when we start, so broadcasts
  // could land before our lock-acquisition microtask resumes).
  // ---------------------------------------------------------------
  const unsubscribeChannel = channel.onMessage((data) => {
    if (disposed) return;
    for (const handler of messageSubscribers) {
      try {
        handler(data);
      } catch {
        // Isolated — see above.
      }
    }
  });

  // ---------------------------------------------------------------
  // Lock acquisition. The promise from `lock.acquire(...)` may
  // resolve much later (when another tab releases the lock or when
  // dispose() releases ours). It's "fire and watch": we don't await
  // it inline so construction returns synchronously.
  //
  // Once granted, we hold the lock open by awaiting a promise that
  // only resolves when `release()` is called. Dispose triggers
  // release; otherwise the browser releases on tab teardown.
  // ---------------------------------------------------------------
  void lock
    .acquire(options.lockName, (adapterRelease) =>
      new Promise<void>((resolveHeld) => {
        if (disposed) {
          // Dispose raced the grant — drop the lock immediately so
          // another waiter can promote without delay.
          adapterRelease();
          resolveHeld();
          return;
        }
        // Wrap the adapter's release so it also resolves the held
        // promise and nulls our exposed handle. Idempotent: second
        // call is a no-op via the `released` flag.
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          releaseLock = null;
          adapterRelease();
          resolveHeld();
        };
        releaseLock = release;
        setRole('leader');
      }),
    )
    .catch(() => {
      // Lock acquisition failed (adapter rejected). Stay as
      // follower; consumers can still broadcast — they just lose
      // the failover guarantee. Surface via console for debug;
      // we don't have a logger dependency in this package.
      // eslint-disable-next-line no-console
      console.warn('[leader-election] lock acquisition failed; staying follower');
    });

  // ---------------------------------------------------------------
  // Public surface.
  // ---------------------------------------------------------------
  const handle: LeaderElectionHandle = {
    get role() {
      return role;
    },
    onRoleChange(handler) {
      roleSubscribers.add(handler);
      return () => {
        roleSubscribers.delete(handler);
      };
    },
    onMessage(handler) {
      messageSubscribers.add(handler);
      return () => {
        messageSubscribers.delete(handler);
      };
    },
    broadcast(data) {
      if (disposed) return;
      // Post to peers via the channel adapter (does NOT echo to
      // self on a real BroadcastChannel).
      channel.postMessage(data);
      // Local self-dispatch so consumers see uniform behaviour.
      // Wrap in queueMicrotask so handlers can't observe a partial
      // broadcast (some peers got it via channel before the local
      // fan-out finished).
      queueMicrotask(() => {
        if (disposed) return;
        for (const handler of messageSubscribers) {
          try {
            handler(data);
          } catch {
            // Isolated.
          }
        }
      });
    },
    async dispose() {
      if (disposePromise) return disposePromise;
      disposePromise = (async () => {
        disposed = true;
        // Release the lock if we hold it. `release` is idempotent
        // — second-call no-ops via the wrapper's `released` flag.
        const r = releaseLock;
        releaseLock = null;
        if (r) r();
        // Tear down the channel.
        try {
          unsubscribeChannel();
        } catch {
          /* defensive — adapter may already be gone */
        }
        try {
          channel.close();
        } catch {
          /* defensive */
        }
        roleSubscribers.clear();
        messageSubscribers.clear();
      })();
      return disposePromise;
    },
  };
  return handle;
}
