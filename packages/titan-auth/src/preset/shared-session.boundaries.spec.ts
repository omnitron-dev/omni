import { describe, expect, it, vi } from 'vitest';
import { createSharedSessionAuthManager } from './shared-session.js';

function manager(overrides: Record<string, unknown> = {}, session = 'alice') {
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  const claims = { sub: 'alice', sid: 'session-a', iss: 'example', roles: ['user'],
    exp: Math.floor(Date.now() / 1000) + 300, ...overrides };
  const redis = { get: vi.fn(async () => session) };
  return { redis, auth: createSharedSessionAuthManager({
    logger: logger as never, jwtService: { verify: async () => claims } as never,
    sessionRedis: redis, expectedIssuer: 'example',
  }) };
}

describe('shared-session authority boundaries', () => {
  it('binds the credential subject to the session owner', async () => {
    const { auth } = manager({}, 'bob');
    expect((await auth.validateToken('signed-but-misbound')).success).toBe(false);
  });

  it('rejects a human credential claiming a service-only role', async () => {
    const { auth } = manager({ roles: ['user', 'service_role'] });
    expect((await auth.validateToken('human-service-claim')).success).toBe(false);
  });

  it.each([null, 0, {}, [], ''].map(sid => ({ sid })))('rejects a malformed session id $sid', async ({ sid }) => {
    const { auth } = manager({ sid, roles: ['service_role'] });
    expect((await auth.validateToken('ambiguous-principal')).success).toBe(false);
  });

  it.each([undefined, NaN, Infinity, 0, '9999999999'])('requires a bounded expiry %j', async (exp) => {
    const { auth } = manager({ exp });
    expect((await auth.validateToken('unbounded-token')).success).toBe(false);
  });

  it.each([['user', {}], 'admin', [1], null].map(roles => ({ roles })))('rejects malformed roles $roles', async ({ roles }) => {
    const { auth } = manager({ roles });
    expect((await auth.validateToken('malformed-authority')).success).toBe(false);
  });

  it('applies session revocation to the next validation without a confirmation secret', async () => {
    const { auth, redis } = manager();
    expect((await auth.validateToken('same-token')).success).toBe(true);
    redis.get.mockResolvedValue('');
    expect((await auth.validateToken('same-token')).success).toBe(false);
  });

  it('does not accept an invalid expiry from the canonical store', async () => {
    const noop = () => {};
    const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
    const auth = createSharedSessionAuthManager({
      logger: logger as never,
      jwtService: { verify: async () => ({ sub: 'alice', sid: 'session-a', iss: 'example', roles: ['user'],
        exp: Math.floor(Date.now() / 1000) + 300 }) } as never,
      sessionRedis: { get: async () => null }, expectedIssuer: 'example',
      sessionLookup: async () => ({ userId: 'alice', isRevoked: false, expiresAt: 'invalid' }),
    });
    await expect(auth.validateToken('corrupt-store')).rejects.toMatchObject({
      message: 'Authentication service is temporarily unavailable',
    });
  });
});
