/**
 * Tests for JWT `kid`-based key rotation in `JWTService`.
 *
 * Background
 * ----------
 * With a single shared secret, recovering from a compromise requires
 * rotating that secret and forcing every active session to re-login.
 * The `kid` (key id) header lets the verify side hold multiple keys
 * concurrently — old keys can be retired by removing them from the
 * registry once their tokens have all expired.
 *
 * This suite pins the rotation contract:
 *   1. Token with a known `kid` → verified against that key.
 *   2. Token with an unknown `kid` → InvalidTokenError, code UNKNOWN_KID.
 *      Critically, an unknown kid must NOT silently fall through to the
 *      legacy single secret — that would defeat the rotation boundary.
 *   3. Token without a `kid` header → falls back to the legacy single
 *      `jwtSecret` (back-compat during rotation introduction).
 *   4. `requireKid: true` rejects tokens without `kid` (post-grace state).
 *   5. With multiple keys registered, each key verifies only its own
 *      tokens — registering `k2` doesn't accidentally validate `k1`-
 *      signed tokens (and vice versa).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';
import { JWTService, InvalidTokenError } from './auth.jwt.service.js';
import { AUTH_OPTIONS_TOKEN } from './auth.tokens.js';
import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { IAuthModuleOptions } from './auth.types.js';

const SECRET_V1 = 'secret-version-one-min-32-chars-long!';
const SECRET_V2 = 'secret-version-two-min-32-chars-long!';
const LEGACY_SECRET = 'legacy-single-secret-for-backcompat!';

function mkLogger() {
  // Minimal ILogger surface that the service touches.
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
    trace: () => {},
    child: () => mkLogger(),
  } as any;
}

function mkService(opts: IAuthModuleOptions): JWTService {
  // Construct directly — bypass DI to keep tests hermetic.
  // The constructor signature uses @Inject for the params; in plain
  // TypeScript-without-DI invocation the values just bind positionally.
  return new (JWTService as any)(opts, mkLogger());
}

async function sign(opts: {
  secret: string;
  kid?: string;
  sub?: string;
  expiresIn?: string;
}): Promise<string> {
  const sec = new TextEncoder().encode(opts.secret);
  const header: any = { alg: 'HS256' };
  if (opts.kid) header.kid = opts.kid;
  return new SignJWT({ role: 'user' })
    .setProtectedHeader(header)
    .setSubject(opts.sub ?? 'u-1')
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(sec);
}

describe('JWTService — kid-based key rotation', () => {
  let referenceTokens: {
    k1: string;
    k2: string;
    nokid: string;
    unknownKid: string;
    legacyOnly: string;
  };

  beforeAll(async () => {
    referenceTokens = {
      k1: await sign({ secret: SECRET_V1, kid: 'k1' }),
      k2: await sign({ secret: SECRET_V2, kid: 'k2' }),
      nokid: await sign({ secret: LEGACY_SECRET }),
      unknownKid: await sign({ secret: SECRET_V1, kid: 'k99-stale' }),
      legacyOnly: await sign({ secret: LEGACY_SECRET }),
    };
  });

  it('verifies a token whose kid matches a registered key', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1, k2: SECRET_V2 },
      cacheEnabled: false,
    });
    const payload = await svc.verify(referenceTokens.k1);
    expect(payload.sub).toBe('u-1');
  });

  it('verifies a different kid in the same registry', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1, k2: SECRET_V2 },
      cacheEnabled: false,
    });
    const payload = await svc.verify(referenceTokens.k2);
    expect(payload.sub).toBe('u-1');
  });

  it('rejects an unknown kid with UNKNOWN_KID — no silent fallback to legacy secret', async () => {
    // Critical security property: an attacker who controls the JOSE
    // header can NOT bypass the registry by inventing a kid. The
    // legacy `jwtSecret` MUST NOT be tried when kid is present.
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1 },
      cacheEnabled: false,
    });
    await expect(svc.verify(referenceTokens.unknownKid)).rejects.toMatchObject({
      name: 'InvalidTokenError',
      code: 'UNKNOWN_KID',
    });
  });

  it('keys are scoped — k1-signed token does not verify under the k2 key', async () => {
    // Even though both kids are in the registry, the kid in the token
    // selects exactly one. A k1-signed token must NOT validate if k1
    // is removed from the registry — even when k2 is present.
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k2: SECRET_V2 },
      cacheEnabled: false,
    });
    await expect(svc.verify(referenceTokens.k1)).rejects.toMatchObject({
      code: 'UNKNOWN_KID',
    });
  });

  it('falls back to legacy single secret when token has no kid (back-compat)', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1 },
      cacheEnabled: false,
    });
    const payload = await svc.verify(referenceTokens.nokid);
    expect(payload.sub).toBe('u-1');
  });

  it('with requireKid: true rejects no-kid tokens (post-rotation grace state)', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1 },
      requireKid: true,
      cacheEnabled: false,
    });
    await expect(svc.verify(referenceTokens.nokid)).rejects.toMatchObject({
      code: 'KID_REQUIRED',
    });
  });

  it('still works with a plain single-secret config (no rotation registry)', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      cacheEnabled: false,
    });
    const payload = await svc.verify(referenceTokens.legacyOnly);
    expect(payload.sub).toBe('u-1');
  });

  it('ignores empty kid or empty secret entries with a warning, does not crash', async () => {
    // Defensive: a misconfigured env where one of the rotation secrets
    // is empty/undefined must not take down the verify path.
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { '': SECRET_V1, k1: '', k2: SECRET_V2 } as any,
      cacheEnabled: false,
    });
    const payload = await svc.verify(referenceTokens.k2);
    expect(payload.sub).toBe('u-1');
    // k1 was registered with an empty secret → effectively absent.
    await expect(svc.verify(referenceTokens.k1)).rejects.toMatchObject({
      code: 'UNKNOWN_KID',
    });
  });

  it('caches verified payloads (sanity: kid path participates in cache)', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1 },
      cacheEnabled: true,
      cacheTTL: 60_000,
    });
    await svc.verify(referenceTokens.k1);
    await svc.verify(referenceTokens.k1);
    const stats = svc.getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('rejects a malformed token before consulting the registry', async () => {
    const svc = mkService({
      algorithm: 'HS256',
      jwtSecret: LEGACY_SECRET,
      verificationKeys: { k1: SECRET_V1 },
      cacheEnabled: false,
    });
    await expect(svc.verify('not.a.jwt')).rejects.toBeInstanceOf(InvalidTokenError);
  });
});
