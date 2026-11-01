import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeaderElection } from '../../src/cluster/leader-election.js';
import { ClusterRpcService } from '../../src/cluster/cluster.rpc-service.js';
import type { LeaseGrant, LeaseStore } from '@omnitron-dev/titan-database/coordination';

const instances: LeaderElection[] = [];
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
function fixture(overrides: Partial<LeaseStore> = {}) {
  const result: LeaseGrant = { key: 'omnitron/cluster/default', owner: 'self', incarnation: 'controller', epoch: '12', expiresAt: new Date(Date.now() + 15000).toISOString(), remainingMs: 15000 };
  const store = {
    acquire: vi.fn(async value => ({ ...result, ...value })), renew: vi.fn(async value => value),
    release: vi.fn(async () => true), read: vi.fn(async () => null), ...overrides,
  } as LeaseStore;
  const fleet = { selfNodeId: 'self', listNodes: vi.fn(async () => [{ id: 'self' }, { id: 'peer' }]) };
  const election = new LeaderElection('host', fleet as never, logger as never, store);
  instances.push(election);
  return { election, store, fleet, result };
}
afterEach(async () => { for (const election of instances.splice(0)) await election.stop(); vi.useRealTimers(); });

describe('durable cluster authority', () => {
  it('exposes no vote or heartbeat methods that could impersonate a leader', () => {
    expect(Object.getOwnPropertyNames(ClusterRpcService.prototype)).not.toContain('requestVote');
    expect(Object.getOwnPropertyNames(ClusterRpcService.prototype)).not.toContain('leaderHeartbeat');
  });
  it('requires a registered local identity', async () => {
    const { election, fleet, store } = fixture();
    fleet.selfNodeId = '';
    await expect(election.start()).rejects.toThrow('registered');
    expect(store.acquire).not.toHaveBeenCalled();
  });
  it('never treats an unavailable database as a single-node cluster', async () => {
    const { election } = fixture({ acquire: async () => { throw new Error('database unavailable'); } });
    await election.start();
    expect(election.isLeader).toBe(false);
    expect(election.getClusterState()).toMatchObject({ authority: 'unavailable', leaderId: null });
  });
  it('confirms a leader only from the durable grant and counts actual peers', async () => {
    const { election } = fixture();
    await election.start();
    expect(election.getClusterState()).toMatchObject({ nodeId: 'self', state: 'leader', term: '12', peers: 1, coordination: 'postgres-lease' });
  });
  it('refuses malformed provider grants instead of keeping unbounded authority', async () => {
    const { election } = fixture({ acquire: async value => ({ ...value, epoch: '1', remainingMs: NaN, expiresAt: new Date().toISOString() }) });
    await election.start();
    expect(election.isLeader).toBe(false);
    expect(election.getClusterState().authority).toBe('unavailable');
  });
  it('demotes immediately when a renewal fails', async () => {
    const { election } = fixture({ renew: async () => { throw new Error('partition'); } });
    await election.start();
    await election.forceElection();
    expect(election.isLeader).toBe(false);
    expect(election.getClusterState().authority).toBe('unavailable');
  });
  it('does not grant a fresh TTL to a delayed reply', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    const { election, store } = fixture({ acquire: vi.fn(async value => {
      vi.setSystemTime(Date.now() + 20000);
      return { ...value, epoch: '1', remainingMs: 15000, expiresAt: new Date().toISOString() };
    }) });
    await election.start();
    expect(election.isLeader).toBe(false);
    expect(election.getClusterState().authority).toBe('expired');
    // Wall-clock expiry is a second guard for host suspend, independently of timers.
    expect(store.acquire).toHaveBeenCalledOnce();
  });
  it('expires authority on resume even before the expiry timer executes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
    const { election } = fixture();
    await election.start();
    vi.setSystemTime(Date.now() + 20000);
    expect(election.isLeader).toBe(false);
  });
  it('coalesces concurrent reconciliation requests', async () => {
    const { election, store } = fixture();
    await election.start();
    await Promise.all([election.forceElection(), election.forceElection(), election.forceElection()]);
    expect(store.renew).toHaveBeenCalledOnce();
  });
  it('does not revive leadership from an acquire completing after stop', async () => {
    let complete!: (value: LeaseGrant) => void;
    let claimed: Partial<LeaseGrant> = {};
    const { election, result, store } = fixture({ acquire: vi.fn(value => new Promise(resolve => { claimed = value; complete = resolve; })) });
    const starting = election.start();
    await vi.waitFor(() => expect(store.acquire).toHaveBeenCalledOnce());
    const stopping = election.stop();
    Object.assign(result, claimed);
    complete(result);
    await Promise.all([starting, stopping]);
    expect(election.getClusterState()).toMatchObject({ state: 'follower', authority: 'stopped' });
    expect(store.release).toHaveBeenCalledWith(result);
  });
  it('releases only its own epoch on step-down', async () => {
    const { election, store } = fixture();
    await election.start();
    await election.stepDown();
    expect(election.isLeader).toBe(false);
    expect(store.release).toHaveBeenCalledWith(expect.objectContaining({ owner: 'self', epoch: '12' }));
    expect(election.getClusterState().reason).toMatch(/Operator/);
  });
  it('rejects unsafe intervals', () => {
    const { store, fleet } = fixture();
    expect(() => new LeaderElection('self', fleet as never, logger as never, store, { leaseTtlMs: 1000, heartbeatInterval: 900 })).toThrow('three');
  });
});
