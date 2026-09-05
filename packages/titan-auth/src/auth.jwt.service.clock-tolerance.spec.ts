/**
 * Clock skew between issuer and verifier.
 *
 * `clockTolerance` was named in the security checklist — "use the smallest
 * workable `clockTolerance` (default 5 s is usually right)" — and the option
 * did not exist. Nothing was passed to `jwtVerify`, so the effective value was
 * jose's own default of **0**: a token from a server whose clock runs a second
 * ahead fails its `nbf`/`iat` check, and one expiring this instant fails `exp`.
 * In a fleet without tight clock discipline that shows up as intermittent auth
 * failures nobody can attribute.
 *
 * The option now exists and is passed through. The default is still 0 — the
 * module does not invent a skew window on the caller's behalf — so these pin
 * both halves: zero by default, honoured when set.
 */
import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';

import { JWTService, InvalidTokenError } from './auth.jwt.service.js';
import type { IAuthModuleOptions } from './auth.types.js';

const SECRET = 'clock-tolerance-secret-min-32-chars!!';

const mkLogger = (): any => ({
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  fatal: () => {}, trace: () => {}, child: () => mkLogger(),
});

const mkService = (opts: Partial<IAuthModuleOptions> = {}): JWTService =>
  new (JWTService as any)({ algorithm: 'HS256', jwtSecret: SECRET, ...opts }, mkLogger());

/** A token that expired `agoSeconds` ago. */
const expiredToken = (agoSeconds: number): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u-1')
    .setIssuedAt(now - agoSeconds - 60)
    .setExpirationTime(now - agoSeconds)
    .sign(new TextEncoder().encode(SECRET));
};

/** A token that only becomes valid `inSeconds` from now. */
const futureToken = (inSeconds: number): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: 'user' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u-1')
    .setIssuedAt(now + inSeconds)
    .setNotBefore(now + inSeconds)
    .setExpirationTime(now + inSeconds + 3600)
    .sign(new TextEncoder().encode(SECRET));
};

describe('JWTService clock tolerance', () => {
  it('rejects a just-expired token when no tolerance is configured', async () => {
    const token = await expiredToken(3);

    await expect(mkService().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('accepts it within the configured tolerance', async () => {
    const token = await expiredToken(3);

    const payload = await mkService({ clockTolerance: 30 }).verify(token);
    expect(payload.sub).toBe('u-1');
  });

  it('accepts a token from a clock that runs ahead', async () => {
    // The other direction, and the one that bites in practice: the issuer's
    // clock is ahead, so `nbf`/`iat` are in the verifier's future.
    const token = await futureToken(3);

    await expect(mkService().verify(token)).rejects.toBeInstanceOf(InvalidTokenError);
    const payload = await mkService({ clockTolerance: 30 }).verify(token);
    expect(payload.sub).toBe('u-1');
  });

  it('accepts jose\'s string form', async () => {
    const token = await expiredToken(3);

    const payload = await mkService({ clockTolerance: '30s' }).verify(token);
    expect(payload.sub).toBe('u-1');
  });

  it('still rejects a token expired well beyond the tolerance', async () => {
    // The window must not become an open door.
    const token = await expiredToken(600);

    await expect(mkService({ clockTolerance: 30 }).verify(token)).rejects.toBeInstanceOf(
      InvalidTokenError
    );
  });
});
