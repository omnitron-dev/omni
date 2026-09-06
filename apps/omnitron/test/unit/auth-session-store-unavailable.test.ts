/**
 * A database that cannot answer, versus a session that was revoked.
 *
 * `validateToken` returned null for both, and the daemon turns null into
 * `Session has been revoked or expired` with a 401. During a database outage
 * every operator was therefore told their session had been revoked — an
 * affirmative claim about their account, made at the one moment the platform
 * could not check it, and the kind of message that sends someone looking for
 * a security incident. Signing in again does not help: that path needs the
 * same database.
 *
 * The security outcome is unchanged in both directions — a token that does
 * not verify is still rejected, and a failed lookup still grants nothing. All
 * that changes is which of the two the caller is told.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

import { AuthService } from '../../src/services/auth.service.js';

const SECRET = 'a-secret-long-enough-for-hs256-signing-in-tests';

/** A database whose every query throws — the outage, without one. */
const brokenDb = {
  selectFrom() {
    return this;
  },
  select() {
    return this;
  },
  selectAll() {
    return this;
  },
  where() {
    return this;
  },
  executeTakeFirst(): Promise<never> {
    return Promise.reject(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5480'), { code: 'ECONNREFUSED' }));
  },
} as never;

/** A database that answers, and has no such session. */
const emptyDb = {
  selectFrom() {
    return this;
  },
  select() {
    return this;
  },
  selectAll() {
    return this;
  },
  where() {
    return this;
  },
  executeTakeFirst(): Promise<undefined> {
    return Promise.resolve(undefined);
  },
} as never;

let token: string;

beforeAll(async () => {
  token = await new SignJWT({ sid: 'session-1', role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('omnitron')
    .setSubject('user-1')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
});

describe('validateToken', () => {
  it('reports an unreachable session store rather than a revoked session', async () => {
    const auth = new AuthService(brokenDb, SECRET);

    await expect(auth.validateToken(token)).rejects.toMatchObject({
      code: 'SESSION_STORE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('keeps the original failure attached', async () => {
    // Without it the operator gets "session store is unavailable" and no way
    // to tell a refused connection from a permissions problem.
    const auth = new AuthService(brokenDb, SECRET);

    await expect(auth.validateToken(token)).rejects.toMatchObject({
      cause: { code: 'ECONNREFUSED' },
    });
  });

  it('still answers null for a session that is genuinely gone', async () => {
    const auth = new AuthService(emptyDb, SECRET);

    await expect(auth.validateToken(token)).resolves.toBeNull();
  });

  it('still answers null for a token that does not verify', async () => {
    const auth = new AuthService(emptyDb, SECRET);

    await expect(auth.validateToken('not-a-jwt')).resolves.toBeNull();
  });

  it('does not consult the store for a token signed by someone else', async () => {
    // Fails closed before the database is touched, so a broken store cannot
    // turn a forged token into a 503 that hides the forgery.
    const forged = await new SignJWT({ sid: 'session-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('omnitron')
      .setSubject('user-1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-entirely-for-this-test'));

    const auth = new AuthService(brokenDb, SECRET);

    await expect(auth.validateToken(forged)).resolves.toBeNull();
  });
});
