import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { PostgresLeaseStore, LeaseLostError } from '@omnitron-dev/titan-database/coordination';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { StopSigner, StopRecipient } from '../../src/cluster/stop-authority.js';
import { NodeStackStop } from '../../src/project/node-stack-stop.js';
import { LeaderElection } from '../../src/cluster/leader-election.js';
import { installedAllocation } from '../helpers/installed-resume.js';

let own: OwnDatabase;
let store: PostgresLeaseStore<unknown>;
const claimant = (owner: string, incarnation = owner) => ({ key: 'cluster', owner, incarnation });
beforeAll(async () => {
  own = await databaseOfItsOwn(process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test', `omnitron_cluster_leases_${process.pid}`);
  store = new PostgresLeaseStore(own.db as never);
});
afterAll(async () => { await own?.drop(); });
beforeEach(async () => { await sql`TRUNCATE titan_database_leases`.execute(own.db); });

describe('PostgreSQL-authoritative cluster leases', () => {
  it('refuses the next installed app when PostgreSQL transfers the lease between launches', async () => {
    const { node, request, owner, restartBackend } = installedAllocation(store);
    const fleet = { selfNodeId: 'a', listNodes: async () => ['a', 'b'].map(id => ({ id })) as never };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const a = new LeaderElection('a', fleet, logger, store, { clusterId: 'west' });
    const b = new LeaderElection('b', { ...fleet, selfNodeId: 'b' }, logger, store, { clusterId: 'west' });
    try {
      await a.start(); await b.start();
      const plan = await node.prepare(request), permit = a.authorizeEffect(plan);
      owner.resumeInstalledApp.mockImplementationOnce(async () => { await a.stepDown(); await b.forceElection(); });
      const result = await node.execute({ ...request, plan, permit });
      expect(b.isLeader).toBe(true);
      expect(result).toMatchObject({ outcome: 'unconfirmed', apps: ['sample/deployed/api'] });
      expect(owner.resumeInstalledApp).toHaveBeenCalledOnce();
      expect(restartBackend().receipt(request)).toEqual(result);
      await expect(restartBackend().execute({ ...request, plan, permit })).rejects.toThrow(/lease/);
    } finally { await a.stop(); await b.stop(); }
  });
  it('fences a queued stack stop and each later effect across real controller replacement', async () => {
    const data = new Map<string, unknown>();
    const state = {
      kvGetSync: <T>(key: string) => (structuredClone(data.get(key)) ?? null) as T | null,
      kvUpdateSync: <T>(key: string, update: (previous: T | null) => T) => {
        const next = update((structuredClone(data.get(key)) ?? null) as T | null);
        data.set(key, structuredClone(next)); return next;
      },
    };
    const audience = { clusterId: 'west', nodeId: 'node-7' };
    const request = { project: 'sample', stack: 'prod', applications: true, audience };
    const runtime = { project: 'sample', stack: 'deployed' };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const controllers = ['a', 'b'].map(id => new LeaderElection(id, {
      selfNodeId: id, listNodes: async () => (['a','b'].map(n => ({ id: n })) as never),
    }, logger, store, { clusterId: audience.clusterId }));
    const [first, second] = controllers as [LeaderElection, LeaderElection];
    const ports = {
      definition: async () => ({ runtime, fingerprint: 'immutable-definition' }),
      execution: {
        inspectStackExecution: async () => ({ ...runtime, revision: 0, phase: 'running' as const, apps: [] }),
        stopStackExecution: vi.fn(async () => {
          await first.stepDown(); await second.forceElection();
          return { ...runtime, revision: 1, operationId: '', stopped: [], observedAt: new Date().toISOString() };
        }),
      },
      containers: async () => [{ id: 'a'.repeat(64), name: 'sample-db' }],
      disableResume: vi.fn(), retireInfrastructure: vi.fn(), removeContainer: vi.fn(),
    };
    const node = new NodeStackStop(state, ports);
    const recipient = new StopRecipient(audience, store, state);
    node.setRecipient(recipient);
    try {
      await first.start(); await second.start();
      const plan = await node.prepare(request);
      const permit = first.authorizeStop(plan);
      await expect(node.prepare({ ...request, audience: { ...audience, nodeId: 'other' } })).rejects.toThrow('enrollment');
      await expect(recipient.admit({ ...plan, stack: 'other' }, permit)).rejects.toThrow('signature');
      await expect(recipient.admit({ ...plan, containers: [] }, permit)).rejects.toThrow('signature');
      await expect(recipient.admit(plan, { ...permit, signature: 'A'.repeat(86) })).rejects.toThrow('signature');
      await expect(node.execute(plan)).rejects.toThrow('authority');
      expect(ports.disableResume).not.toHaveBeenCalled();
      await expect(node.execute({ ...plan, permit })).rejects.toThrow('no longer holds');
      expect(ports.execution.stopStackExecution).toHaveBeenCalledOnce();
      expect(ports.retireInfrastructure).not.toHaveBeenCalled();
      expect(ports.removeContainer).not.toHaveBeenCalled();
      expect(() => first.authorizeStop(plan)).toThrow('confirmed');
      const restarted = new NodeStackStop(state, ports);
      restarted.setRecipient(new StopRecipient(audience, store, state));
      await expect(restarted.execute({ ...plan, permit })).rejects.toThrow('no longer holds');
      const current = second.authorizeStop(plan);
      expect(BigInt(current.epoch)).toBeGreaterThan(BigInt(permit.epoch));
      await recipient.admit(plan, current);
      const old = { ...permit, key:'omnitron/cluster/west', remainingMs:10000, expiresAt:new Date(Date.now()+10000).toISOString() };
      const restored = new StopRecipient(audience, { read: async () => old }, state);
      await expect(restored.admit(plan, permit)).rejects.toThrow('durable node fence');
      const impostor = new StopSigner();
      expect(() => impostor.issue(plan, old)).toThrow('does not own');
    } finally { await first.stop(); await second.stop(); }
  });
  it('admits exactly one of concurrent controllers', async () => {
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => store.acquire(claimant(`node-${i}`), 15000)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.read('cluster'))?.epoch).toBe('1');
  });
  it('reconciles a lost acquire reply for the same incarnation without changing its epoch', async () => {
    const first = await store.acquire(claimant('a'), 15000);
    const retry = await store.acquire(claimant('a'), 15000);
    expect(retry?.epoch).toBe(first?.epoch);
    expect(await store.acquire(claimant('a', 'restarted'), 15000)).toBeNull();
  });
  it('preserves the epoch after release and fences the old controller', async () => {
    const first = (await store.acquire(claimant('a'), 15000))!;
    expect(await store.release(first)).toBe(true);
    const second = (await store.acquire(claimant('b'), 15000))!;
    expect(second.epoch).toBe('2');
    expect(await store.renew(first, 15000)).toBeNull();
    expect(await store.release(first)).toBe(false);
    expect((await store.read('cluster'))?.owner).toBe('b');
  });
  it('does not renew an expired epoch, including for the same process', async () => {
    const first = (await store.acquire(claimant('a'), 15000))!;
    await sql`UPDATE titan_database_leases SET expires_at = clock_timestamp() - interval '1 second'`.execute(own.db);
    expect(await store.renew(first, 15000)).toBeNull();
    expect(await store.read('cluster')).toBeNull();
    expect((await store.acquire(claimant('a'), 15000))?.epoch).toBe('2');
  });
  it('keeps epochs exact beyond JavaScript safe integers', async () => {
    await store.acquire(claimant('a'), 15000);
    await sql`UPDATE titan_database_leases SET epoch = 9007199254740992, expires_at = clock_timestamp() - interval '1 second'`.execute(own.db);
    expect((await store.acquire(claimant('b'), 15000))?.epoch).toBe('9007199254740993');
  });
  it('refuses an effect under a replaced epoch', async () => {
    const first = (await store.acquire(claimant('a'), 15000))!;
    await store.release(first);
    await store.acquire(claimant('b'), 15000);
    let ran = false;
    await expect(store.withLease(first, async () => { ran = true; })).rejects.toBeInstanceOf(LeaseLostError);
    expect(ran).toBe(false);
  });
  it('rolls back database effects when their lease expires before completion', async () => {
    const first = (await store.acquire(claimant('a'), 15000))!;
    await expect(store.withLease(first, async trx => {
      await sql`UPDATE titan_database_leases SET expires_at = clock_timestamp() - interval '1 second'`.execute(trx);
    })).rejects.toBeInstanceOf(LeaseLostError);
    expect(await store.read('cluster')).not.toBeNull();
  });
  it('uses synchronous commit for fenced effects', async () => {
    const first = (await store.acquire(claimant('a'), 15000))!;
    expect(await store.withLease(first, async trx => (await sql<{ synchronous_commit: string }>`SHOW synchronous_commit`.execute(trx)).rows[0]?.synchronous_commit)).toBe('on');
  });
  it('serializes transfer behind a fenced transaction', async () => {
    const first = (await store.acquire(claimant('a'), 15000))!;
    let entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const effect = store.withLease(first, async () => { entered(); await gate; });
    await entering;
    let settled = false;
    const transfer = store.acquire(claimant('b'), 15000).then(result => { settled = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(settled).toBe(false);
    finish();
    await effect;
    expect(await transfer).toBeNull();
  });
  it('rejects invalid identity/TTL before querying', async () => {
    await expect(store.acquire(claimant(''), 1000)).rejects.toThrow('owner');
    await expect(store.acquire(claimant('a'), NaN)).rejects.toThrow('TTL');
  });
});
