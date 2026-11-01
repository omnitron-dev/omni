import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { createMockLogger } from '../test-utils.js';

afterEach(() => vi.useRealTimers());

describe('authentication lifetime and authority cache', () => {
  it('never extends credential expiry to the cache TTL', async () => {
    vi.useFakeTimers();
    const manager = new AuthenticationManager(createMockLogger(), {
      authenticate: async () => { throw new Error('unsupported'); },
      validateToken: async () => ({ userId: 'alice', roles: ['admin'], permissions: [],
        token: { type: 'bearer', expiresAt: new Date(Date.now() + 500) } }),
      tokenCache: { enabled: true, ttl: 60_000 },
    });
    expect((await manager.validateToken('private-token')).success).toBe(true);
    vi.advanceTimersByTime(501);
    expect((await manager.validateToken('private-token')).success).toBe(false);
  });

  it('removes the previous cache when live authority is configured', async () => {
    let active = true;
    const config = {
      authenticate: async () => { throw new Error('unsupported'); },
      validateToken: async () => {
        if (!active) throw new Error('revoked');
        return { userId: 'alice', roles: ['admin'], permissions: [] };
      },
    };
    const manager = new AuthenticationManager(createMockLogger(), config);
    expect((await manager.validateToken('private-token')).success).toBe(true);
    manager.configure({ ...config, tokenCache: { enabled: false } });
    active = false;
    expect((await manager.validateToken('private-token')).success).toBe(false);
  });

  it('revalidates a persistent principal without exposing its credential in the context', async () => {
    let role = 'admin';
    const manager = new AuthenticationManager(createMockLogger(), {
      authenticate: async () => { throw new Error('unsupported'); },
      validateToken: async () => ({ userId: 'alice', roles: [role], permissions: [] }),
      tokenCache: { enabled: false },
    });
    const admitted = (await manager.validateToken('private-token')).context!;
    expect(JSON.stringify(admitted)).not.toContain('private-token');
    role = 'reader';
    expect((await manager.revalidateContext(admitted)).roles).toEqual(['reader']);
  });
});
