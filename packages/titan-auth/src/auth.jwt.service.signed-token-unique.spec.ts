/**
 * A link issued twice in one second.
 *
 * `createSignedToken` signed the resource, the operation and `iat`/`exp` in
 * whole seconds — nothing else — so two links to one object issued within the
 * same second were the same token, byte for byte. storage keeps each issued
 * link as a row under a unique index on the token's hash, with a use count of
 * its own: on daos/test on 2026-09-29 a download asked for twice answered
 * «Internal Server Error» (23505 on `idx_signed_urls_token_hash`), and two
 * readers of one object in one second would have shared one one-use link.
 *
 * Held here: every token carries a `jti` of its own — two issued back to back
 * for one payload differ, and each still verifies to that payload.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { decodeJwt } from 'jose';
import { JWTService } from './auth.jwt.service.js';

function mkLogger(): any {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {}, trace: () => {}, child: () => mkLogger() };
}

const service = new (JWTService as any)(
  { jwtSecret: 'jwt-secret-min-32-characters-long!!', urlSigningKey: 'url-signing-key-min-32-characters-long' },
  mkLogger(),
) as JWTService;

const payload = { resourceId: 'bucket-1', resourcePath: 'secrets/note.txt', operation: 'read' as const };

describe('a signed link is its own', () => {
  afterEach(() => vi.useRealTimers());

  it('two issued in the same second for one payload differ, and both verify to it', async () => {
    // The second pinned, so the two cannot differ by a clock tick: what tells
    // them apart has to be in the token itself. The moment is the one measured.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T15:16:17.500Z'));
    const a = await service.createSignedToken(payload, 300);
    const b = await service.createSignedToken(payload, 300);
    // Verified under the same pinned clock: by the real one they have expired.
    expect(decodeJwt(a).iat).toBe(decodeJwt(b).iat);
    expect(a).not.toBe(b);
    for (const t of [a, b]) {
      expect(await service.verifySignedToken(t)).toMatchObject(payload);
    }
  });

  it('carries a random jti', async () => {
    const jti = decodeJwt(await service.createSignedToken(payload, 60)).jti;
    expect(jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
