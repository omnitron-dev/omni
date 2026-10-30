import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDaemonPrincipalValidator, createDaemonTokenValidator } from '../../src/services/daemon-authority.js';

const identity = () => ({ sub: 'user', sid: 'session', role: 'admin', iss: 'omnitron', exp: Math.floor(Date.now() / 1000) + 3600 });
const sessions = { validateSessionAuthority: vi.fn(async () => ({ userId: 'user', sessionId: 'session', role: 'admin' })) };
beforeEach(() => { sessions.validateSessionAuthority.mockReset().mockResolvedValue({ userId: 'user', sessionId: 'session', role: 'admin' }); });

describe('daemon authority admission and continuing permission', () => {
  it.each([
    { sid: undefined }, { sid: '' }, { role: 'owner' }, { sub: '' }, { iss: 'another-issuer' },
    { exp: undefined }, { exp: 1 }, { exp: Number.POSITIVE_INFINITY }, { exp: 3.5 },
  ])('rejects incomplete or invalid human claims %j before reading a session', async change => {
    await expect(createDaemonTokenValidator(async () => ({ ...identity(), ...change }), sessions)('signed'))
      .rejects.toMatchObject({ code: 'SESSION_REVOKED', statusCode: 401 });
    expect(sessions.validateSessionAuthority).not.toHaveBeenCalled();
  });

  it('takes the role from the live session and rejects humans on nodes without a session store', async () => {
    sessions.validateSessionAuthority.mockResolvedValue({ userId: 'user', sessionId: 'session', role: 'viewer' });
    const validate = createDaemonTokenValidator(async () => identity(), sessions);
    const context = await validate('signed');
    expect(context).toMatchObject({ roles: ['viewer'], metadata: { principalType: 'human', sessionId: 'session' } });
    await expect(createDaemonPrincipalValidator(sessions)(context)).resolves.toBeUndefined();
    await expect(createDaemonTokenValidator(async () => identity(), null)('signed')).rejects.toThrow('active session');
  });

  it('rechecks a previously admitted administrator on every call and never mutates their admitted role', async () => {
    const context = await createDaemonTokenValidator(async () => identity(), sessions)('signed');
    const revalidate = createDaemonPrincipalValidator(sessions);
    await revalidate(context);
    sessions.validateSessionAuthority.mockResolvedValue({ userId: 'user', sessionId: 'session', role: 'viewer' });
    await expect(revalidate(context)).rejects.toThrow('role changed');
    expect(context.roles).toEqual(['admin']);
    sessions.validateSessionAuthority.mockResolvedValue(null as never);
    await expect(revalidate(context)).rejects.toThrow('revoked');
  });

  it('keeps session-store outages distinct from revocation', async () => {
    const context = await createDaemonTokenValidator(async () => identity(), sessions)('signed');
    sessions.validateSessionAuthority.mockRejectedValue(Object.assign(new Error('Session store is unavailable'), { code: 'SESSION_STORE_UNAVAILABLE', statusCode: 503 }));
    await expect(createDaemonPrincipalValidator(sessions)(context)).rejects.toMatchObject({ statusCode: 503 });
    await expect(createDaemonTokenValidator(async () => identity(), sessions)('signed')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('expires persistent service identities and refuses a service credential with a human session', async () => {
    const verify = async () => ({ ...identity(), sid: undefined, role: 'service_role' });
    const context = await createDaemonTokenValidator(verify, null)('signed');
    await expect(createDaemonPrincipalValidator(null)(context)).resolves.toBeUndefined();
    context.metadata!['expiresAt'] = Date.now();
    await expect(createDaemonPrincipalValidator(null)(context)).rejects.toThrow('expired');
    expect(sessions.validateSessionAuthority).not.toHaveBeenCalled();
    await expect(createDaemonTokenValidator(async () => ({ ...identity(), role: 'service_role' }), sessions)('signed'))
      .rejects.toThrow('human session');
  });

  it('trusts only the reserved local socket identity, never a network principal carrying the same name', async () => {
    const validate = createDaemonPrincipalValidator(null);
    const context = { userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } };
    await expect(validate(context)).resolves.toBeUndefined();
    await expect(validate({ ...context, metadata: {} })).rejects.toThrow('expired');
    await expect(validate({ ...context, userId: 'user' })).rejects.toThrow('expired');
  });
});
