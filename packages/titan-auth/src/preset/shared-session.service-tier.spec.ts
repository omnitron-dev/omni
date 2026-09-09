/**
 * A session-bearing token is never a service principal.
 *
 * `metadata.isServiceRole` is the strongest flag this preset produces.
 * Downstream it means "skip the checks a human is subject to": daos's
 * `requireAdmin()` returns success on it alone, tier-visibility stops
 * filtering rows above the viewer's tier, and messaging's whole admin
 * surface is `@Public()` plus `requireAdmin()` with nothing in between.
 *
 * It used to follow from the `service_role` claim by itself. The claim
 * follows from whatever the minting side puts in `roles[]`, and on daos
 * that is `expandRoles(users."platformRole")` over a varchar column with
 * an explicit `case 'service_role'`. So the flag was reachable by writing
 * a string into a user's row — no S2S secret, no service subject.
 *
 * The two tiers are structurally exclusive and always were: an S2S token
 * is minted by `signServiceToken`, which sets a service subject and no
 * `sid`; a user token is refused outright unless it carries one. This
 * suite pins that, in both directions, so a future mint path cannot
 * promote a human session by naming a role.
 */

import { describe, it, expect } from 'vitest';
import { createSharedSessionAuthManager } from './shared-session.js';

const SESSION_KEY = 'omni:session:sess-1';
const USER_ID = 'user-uuid-1';

function mkLogger() {
  const noop = () => {};
  return { debug: noop, info: noop, warn: noop, error: noop, trace: noop, fatal: noop,
           child: () => mkLogger() } as never;
}

/** A jwtService whose `verify` hands back exactly the payload under test. */
function mkJwt(payload: Record<string, unknown>) {
  return { verify: async () => payload } as never;
}

const redisWithLiveSession = {
  get: async (key: string) => (key === SESSION_KEY ? USER_ID : null),
  set: async () => undefined,
};

function mkManager(payload: Record<string, unknown>) {
  return createSharedSessionAuthManager({
    logger: mkLogger(),
    jwtService: mkJwt(payload),
    sessionRedis: redisWithLiveSession,
  });
}

const serviceRoleClaims = { sub: USER_ID, iss: 'omnitron', roles: ['service_role'] };

describe('service tier is decided by the absence of a session, not by a claim', () => {
  it('refuses service tier to a token that carries a sid', async () => {
    // Exactly the token daos mints for a user whose `platformRole`
    // column reads `service_role`: a real session, claiming the S2S tier.
    const res = await mkManager({ ...serviceRoleClaims, sid: 'sess-1' }).validateToken('t');

    expect(res.success).toBe(true);
    expect(res.context?.metadata?.['isServiceRole']).toBe(false);
    // The claim itself is preserved — the token is still authenticated and
    // still carries the role it asked for. Only the privilege is withheld,
    // so a legitimate `roles: ['service_role']` gate still refuses it for
    // the ordinary reason (no matching role) rather than silently passing.
    expect(res.context?.roles).toContain('service_role');
  });

  it('grants service tier to a real S2S token, which has no sid', async () => {
    const res = await mkManager({ ...serviceRoleClaims, sub: 'main-service-account' })
      .validateToken('t');

    expect(res.success).toBe(true);
    expect(res.context?.metadata?.['isServiceRole']).toBe(true);
  });

  it('honours the singular `role` claim for S2S too, and still not with a sid', async () => {
    const withoutSid = await mkManager({
      sub: 'storage-service-account', iss: 'omnitron', role: 'service_role',
    }).validateToken('t');
    expect(withoutSid.context?.metadata?.['isServiceRole']).toBe(true);

    const withSid = await mkManager({
      sub: USER_ID, iss: 'omnitron', role: 'service_role', sid: 'sess-1',
    }).validateToken('t');
    expect(withSid.context?.metadata?.['isServiceRole']).toBe(false);
  });

  it('still requires a sid from every token that does not claim the service tier', async () => {
    // The waiver is unchanged: it is the CLAIM that waives `sid`, so a
    // plain user token with no session is still refused. Tightening the
    // grant must not accidentally open this.
    const res = await mkManager({ sub: USER_ID, iss: 'omnitron', roles: ['user'] })
      .validateToken('t');

    expect(res.success).toBe(false);
  });

  it('never reports service tier for an ordinary user session', async () => {
    const res = await mkManager({
      sub: USER_ID, iss: 'omnitron', roles: ['user', 'admin'], sid: 'sess-1',
    }).validateToken('t');

    expect(res.success).toBe(true);
    expect(res.context?.metadata?.['isServiceRole']).toBe(false);
  });
});
