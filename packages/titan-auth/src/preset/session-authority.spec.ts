import { describe, expect, it, vi } from 'vitest';
import { createSharedSessionAuthManager, type SessionAuthority } from './shared-session.js';
import { SessionAuthorityService } from './session-authority.js';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';

function fixture() {
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  const row: SessionAuthority = { userId: 'alice', isRevoked: false, expiresAt: Date.now() + 60_000,
    roles: ['admin'], permissions: ['documents.*'] };
  const lookup = vi.fn(async () => row as SessionAuthority | undefined);
  const registry = { get: vi.fn(async () => 'alice'), set: vi.fn() };
  const auth = createSharedSessionAuthManager({ logger: logger as never, expectedIssuer: 'example',
    jwtService: { verify: async () => ({ sub: 'alice', sid: 'session', iss: 'example',
      exp: Math.floor(Date.now() / 1000) + 300, roles: ['admin'], permissions: ['*'] }) } as never,
    sessionRedis: registry, sessionAuthority: lookup });
  return { row, lookup, registry, auth };
}

describe('canonical session authority', () => {
  it('resolves current grants on every call, including role edits without cache invalidation', async () => {
    const { row, auth, registry } = fixture();
    expect((await auth.validateToken('same')).context?.permissions).toEqual(['documents.*']);
    row.roles = ['reader']; row.permissions = ['documents.read'];
    expect((await auth.validateToken('same')).context).toMatchObject({ roles: ['reader'], permissions: ['documents.read'] });
    row.isRevoked = true;
    expect((await auth.validateToken('same')).success).toBe(false);
    expect(registry.get).not.toHaveBeenCalled();
    expect(registry.set).not.toHaveBeenCalled();
  });

  it('refuses an unavailable canonical owner without accepting the cached session', async () => {
    const { auth, lookup } = fixture();
    lookup.mockRejectedValue(new Error('database unavailable'));
    await expect(auth.validateToken('same')).rejects.toMatchObject({ code: 503 });
  });

  it.each([{ userId: 'bob' }, { expiresAt: 0 }, { isRevoked: true }])('refuses a non-live or misbound snapshot %j', async change => {
    const { row, auth } = fixture(); Object.assign(row, change);
    expect((await auth.validateToken('same')).success).toBe(false);
  });

  it.each([{ roles: ['service_role'] }, { permissions: [null] }, { expiresAt: 'invalid' }])('treats invalid authority data as unavailable %j', async change => {
    const { row, auth } = fixture(); Object.assign(row, change);
    await expect(auth.validateToken('same')).rejects.toMatchObject({ code: 503 });
  });

  it('exposes the canonical lookup only to service principals', async () => {
    const requirement = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, SessionAuthorityService.prototype, 'resolve');
    for (const role of ['user', 'admin', 'superadmin'])
      expect(validateAccessRequirements({ userId: 'human', roles: [role], permissions: ['*'] }, requirement).allowed).toBe(false);
    expect(validateAccessRequirements({ userId: 'service', roles: ['service_role'], permissions: [] }, requirement).allowed).toBe(false);
    expect(validateAccessRequirements({ userId: 'service', roles: ['service_role'], permissions: ['sessions.resolve'] }, requirement).allowed).toBe(true);
    const lookup = vi.fn(async () => undefined);
    const service = new SessionAuthorityService(lookup);
    await expect(service.resolve({ sessionId: '', userId: 'alice' })).rejects.toMatchObject({ code: 400 });
    expect(lookup).not.toHaveBeenCalled();
    expect(await service.resolve({ sessionId: 'session', userId: 'alice' })).toBeNull();
  });
});
