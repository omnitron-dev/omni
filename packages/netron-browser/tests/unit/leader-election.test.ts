/**
 * Leader-election primitive tests (T#64).
 *
 * Happy-dom doesn't ship `navigator.locks` or `BroadcastChannel`,
 * so every test injects in-process stubs through the same option
 * surface real callers would use for SSR / Node. The stubs mirror
 * browser semantics precisely:
 *
 *   - `FakeLockRegistry` is a per-name FIFO queue. Only one holder
 *     at a time; releasers pop the next waiter; `release()` is
 *     idempotent.
 *   - `FakeChannelRegistry` is a per-name pub/sub. Posts deliver
 *     to every OTHER subscriber synchronously (matches
 *     BroadcastChannel — sender doesn't receive its own message).
 *
 * Each test that needs failover constructs MULTIPLE election
 * handles backed by the same registries — simulating multiple
 * tabs of the same origin sharing the same lock/channel name.
 */

import { describe, it, expect } from 'vitest';
import {
  createLeaderElection,
  LeaderElectionUnavailableError,
  type ILeaderChannel,
  type ILeaderLock,
} from '../../src/leader-election/index.js';

// ---------------------------------------------------------------------------
// Stubs — mirror real browser semantics.
// ---------------------------------------------------------------------------

class FakeLockRegistry {
  private readonly held = new Map<string, () => void>();
  private readonly waiters = new Map<string, Array<() => void>>();

  /** Adapter factory bound to this registry. */
  adapter(): ILeaderLock {
    return {
      acquire: (name, onAcquired) =>
        new Promise<void>((resolve) => {
          const grant = () =>
            void (async () => {
              const innerPromise = new Promise<void>((resolveInner) => {
                const release = () => {
                  if (this.held.get(name) !== release) return; // idempotent
                  this.held.delete(name);
                  const next = this.waiters.get(name)?.shift();
                  if (next) queueMicrotask(next);
                  resolveInner();
                };
                this.held.set(name, release);
                const ret = onAcquired(release);
                if (ret && typeof (ret as Promise<void>).then === 'function') {
                  (ret as Promise<void>).then(release, release);
                }
              });
              await innerPromise;
              resolve();
            })();

          if (!this.held.has(name)) {
            queueMicrotask(grant);
          } else {
            const list = this.waiters.get(name) ?? [];
            list.push(grant);
            this.waiters.set(name, list);
          }
        }),
    };
  }
}

class FakeChannelRegistry {
  private readonly subs = new Map<string, Set<(data: unknown) => void>>();

  /** Adapter factory bound to this registry, scoped to one channel name. */
  adapter(channelName: string): ILeaderChannel {
    const ownListeners = new Set<(data: unknown) => void>();
    return {
      postMessage: (data) => {
        // Mirror BroadcastChannel: deliver to OTHER subscribers,
        // not self.
        const all = this.subs.get(channelName);
        if (!all) return;
        for (const listener of all) {
          if (ownListeners.has(listener)) continue;
          try {
            listener(data);
          } catch {
            /* isolated */
          }
        }
      },
      onMessage: (handler) => {
        const wrapped = (data: unknown) => handler(data);
        ownListeners.add(wrapped);
        const set = this.subs.get(channelName) ?? new Set();
        set.add(wrapped);
        this.subs.set(channelName, set);
        return () => {
          ownListeners.delete(wrapped);
          this.subs.get(channelName)?.delete(wrapped);
        };
      },
      close: () => {
        const all = this.subs.get(channelName);
        if (!all) return;
        for (const listener of ownListeners) all.delete(listener);
        ownListeners.clear();
      },
    };
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------

describe('createLeaderElection', () => {
  it('the only participant becomes leader', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const tab = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    expect(tab.role).toBe('follower');
    await tick();
    await tick();
    expect(tab.role).toBe('leader');
    await tab.dispose();
  });

  it('second tab stays follower while the first holds leadership', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const a = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const b = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();
    expect(a.role).toBe('leader');
    expect(b.role).toBe('follower');
    await a.dispose();
    await b.dispose();
  });

  it('leader dispose promotes the follower', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const a = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const b = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();
    expect(a.role).toBe('leader');
    expect(b.role).toBe('follower');

    const transitions: string[] = [];
    b.onRoleChange((role) => transitions.push(role));

    await a.dispose();
    await tick();
    await tick();
    expect(b.role).toBe('leader');
    expect(transitions).toEqual(['leader']);
    await b.dispose();
  });

  it('broadcast from a follower is delivered to the leader AND echoed locally', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const leader = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const follower = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();
    expect(leader.role).toBe('leader');
    expect(follower.role).toBe('follower');

    const leaderInbox: unknown[] = [];
    const followerInbox: unknown[] = [];
    leader.onMessage((d) => leaderInbox.push(d));
    follower.onMessage((d) => followerInbox.push(d));

    follower.broadcast({ kind: 'send', text: 'hello' });
    await tick();
    expect(leaderInbox).toEqual([{ kind: 'send', text: 'hello' }]);
    expect(followerInbox).toEqual([{ kind: 'send', text: 'hello' }]);
    await leader.dispose();
    await follower.dispose();
  });

  it('broadcast from the leader is delivered to followers AND echoed locally', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const leader = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const follower = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();

    const leaderInbox: unknown[] = [];
    const followerInbox: unknown[] = [];
    leader.onMessage((d) => leaderInbox.push(d));
    follower.onMessage((d) => followerInbox.push(d));

    leader.broadcast({ kind: 'delta', n: 7 });
    await tick();
    expect(leaderInbox).toEqual([{ kind: 'delta', n: 7 }]);
    expect(followerInbox).toEqual([{ kind: 'delta', n: 7 }]);
    await leader.dispose();
    await follower.dispose();
  });

  it('dispose is idempotent', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const tab = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();
    await Promise.all([tab.dispose(), tab.dispose(), tab.dispose()]);
    // After dispose, broadcasts are dropped silently.
    const inbox: unknown[] = [];
    tab.onMessage((d) => inbox.push(d));
    tab.broadcast({ ignored: true });
    await tick();
    expect(inbox).toEqual([]);
  });

  it('broadcasts after dispose are dropped', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const leader = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const follower = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();

    const followerInbox: unknown[] = [];
    follower.onMessage((d) => followerInbox.push(d));

    await leader.dispose();
    leader.broadcast({ stale: true });
    await tick();
    expect(followerInbox).toEqual([]);
    await follower.dispose();
  });

  it('promotion chain: leader → follower-A promotes → dispose A → follower-B promotes', async () => {
    const lockReg = new FakeLockRegistry();
    const chanReg = new FakeChannelRegistry();
    const a = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const b = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    const c = createLeaderElection({
      lockName: 'res',
      channelName: 'res:bus',
      lock: lockReg.adapter(),
      channel: chanReg.adapter('res:bus'),
    });
    await tick();
    await tick();
    expect(a.role).toBe('leader');
    expect(b.role).toBe('follower');
    expect(c.role).toBe('follower');

    await a.dispose();
    await tick();
    await tick();
    expect(b.role).toBe('leader');
    expect(c.role).toBe('follower');

    await b.dispose();
    await tick();
    await tick();
    expect(c.role).toBe('leader');

    await c.dispose();
  });

  it('throws LeaderElectionUnavailableError if no Web Locks and no override (default path)', () => {
    // happy-dom doesn't ship navigator.locks, so the default
    // factory path throws on construction.
    expect(() =>
      createLeaderElection({
        lockName: 'res',
        channelName: 'res:bus',
        // Inject channel only — lock falls back to native and
        // throws because happy-dom doesn't have navigator.locks.
        channel: new FakeChannelRegistry().adapter('res:bus'),
      }),
    ).toThrow(LeaderElectionUnavailableError);
  });
});
