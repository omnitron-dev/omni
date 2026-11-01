import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { PostgresLeaseStore, LeaseLostError } from '@omnitron-dev/titan-database/coordination';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

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
