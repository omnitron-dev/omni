import { describe, expect, it } from 'vitest';
import { clusterDatabaseUrl, clusterEnrollment } from '../../src/cluster/enrollment.js';

describe('daemon cluster enrollment', () => {
  it('persists an explicit audience and refuses an accidental downgrade or reassignment', () => {
    let value: unknown = null;
    const state = { kvGetSync: <T>() => value as T | null, kvUpdateSync: <T>(_key: string, update: (before: T | null) => T) => {
      const next = update(value as T | null); value = next; return next;
    } };
    const config = { enabled: true, clusterId: 'west', recipientId: 'worker-1' };
    expect(clusterEnrollment(undefined, state)).toBeNull();
    expect(() => clusterEnrollment({ ...config, leaseTtlMs: 100 }, state)).toThrow('Lease TTL');
    expect(value).toBeNull();
    expect(clusterEnrollment(config, state)).toEqual({ clusterId: 'west', nodeId: 'worker-1' });
    expect(clusterEnrollment(config, state)).toEqual(value);
    expect(() => clusterEnrollment(undefined, state)).toThrow('enrolled');
    expect(() => clusterEnrollment({ enabled: false }, state)).toThrow('enrolled');
    expect(() => clusterEnrollment({ ...config, recipientId: 'worker-2' }, state)).toThrow('identity');
  });
  it('requires an explicit primary and verified TLS on non-loopback connections', () => {
    expect(() => clusterDatabaseUrl(undefined)).toThrow('OMNITRON_CLUSTER_DATABASE_URL');
    expect(() => clusterDatabaseUrl('postgres://pg.test/authority?sslmode=require')).toThrow('verify-full');
    expect(() => clusterDatabaseUrl('postgres://pg.test/authority?sslmode=verify-full&sslmode=disable')).toThrow('parameters');
    expect(() => clusterDatabaseUrl('postgres://pg.test/authority?sslmode=verify-full&host=other')).toThrow('parameters');
    expect(clusterDatabaseUrl('postgres://127.0.0.1/authority')).toBe('postgres://127.0.0.1/authority');
    expect(clusterDatabaseUrl('postgres://pg.test/authority?sslmode=verify-full')).toContain('verify-full');
  });
});
