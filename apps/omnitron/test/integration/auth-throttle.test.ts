import { TEST_POSTGRES_URL } from '@omnitron-dev/testing/env';
/**
 * Sign-in brute-force protection (integration, real PostgreSQL).
 *
 * ## What was wrong
 *
 * `OmnitronAuth.signIn` is `@Public({ auth: { allowAnonymous: true } })` and
 * ran straight into a scrypt comparison with no attempt limit, no lockout and
 * no record of failures — unlimited password guessing against the console
 * that controls the infrastructure.
 *
 * It also leaked which usernames exist: an unknown username returned before
 * hashing anything, a known one paid ~100ms of scrypt first. That difference
 * is trivially measurable over a network.
 *
 * Requires the test infrastructure: `pnpm test:up` (postgres on :15432).
 */

import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Kysely } from 'kysely';

import { sql } from 'kysely';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { AuthService } from '../../src/services/auth.service.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const TEST_PG_URL = TEST_POSTGRES_URL;

// Asked once, at module scope: `describe.skipIf` needs the answer before the
// suite is declared, and a `beforeAll` runs too late to skip its own suite.
// An absent database is a different finding from a defect — see the helper.
const testPg = await requiresTestPostgres(TEST_PG_URL);
const PASSWORD = 'correct-horse-battery-staple';

let own: OwnDatabase;
let db: Kysely<OmnitronDatabase>;
let auth: AuthService;

async function createUser(username: string): Promise<string> {
  const hash = await auth.hashPassword(PASSWORD);
  const row = await db
    .insertInto('omnitron_users')
    .values({ username, passwordHash: hash, role: 'admin', displayName: username, totpEnabled: false, pgpEnabled: false })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function attemptsFor(userId: string) {
  return db
    .selectFrom('omnitron_users')
    .select(['failedLoginAttempts', 'lockedUntil'])
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
}

// Hold completed password checks at the boundary before their database effects.
function holdChecks(service: AuthService, count = 1) {
  const reached = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const verify = service.verifyPassword.bind(service);
  let completed = 0;
  const spy = vi.spyOn(service, 'verifyPassword').mockImplementation(async (password, hash) => {
    const valid = await verify(password, hash);
    if (++completed === count) reached.resolve();
    await released.promise;
    return valid;
  });
  return {
    reached: reached.promise,
    release() { spy.mockRestore(); released.resolve(); },
  };
}

describe.skipIf(!testPg.ok)('sign-in throttling (integration)', () => {
  beforeAll(async () => {
    own = await databaseOfItsOwn(TEST_PG_URL, `auth_throttle_${randomUUID().replaceAll('-', '')}`);
    db = own.db;
    auth = new AuthService(db, 'test-secret-for-throttle-suite');
  });

  afterAll(async () => { await own?.drop(); });

  it('counts consecutive failures', async () => {
    const userId = await createUser('counter');

    for (let i = 1; i <= 3; i++) {
      await expect(auth.signIn({ username: 'counter', password: 'wrong' })).rejects.toThrow('Invalid credentials');
      expect((await attemptsFor(userId)).failedLoginAttempts).toBe(i);
    }

    // Still below the threshold — not locked.
    expect((await attemptsFor(userId)).lockedUntil).toBeNull();
  });

  it('locks the account once the threshold is crossed', async () => {
    const userId = await createUser('locky');

    for (let i = 0; i < 5; i++) {
      await expect(auth.signIn({ username: 'locky', password: 'wrong' })).rejects.toThrow('Invalid credentials');
    }

    const state = await attemptsFor(userId);
    expect(state.failedLoginAttempts).toBe(5);
    expect(state.lockedUntil).not.toBeNull();
    expect(new Date(state.lockedUntil!).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects the CORRECT password while locked out', async () => {
    await createUser('locked-out');

    for (let i = 0; i < 5; i++) {
      await expect(auth.signIn({ username: 'locked-out', password: 'wrong' })).rejects.toThrow();
    }

    // The whole point: knowing the password does not help until the lock expires.
    await expect(auth.signIn({ username: 'locked-out', password: PASSWORD })).rejects.toThrow(
      /Account temporarily locked/
    );
  });

  it('lengthens the lockout with each further failure', async () => {
    const userId = await createUser('escalate');

    /**
     * The lockout's DURATION, measured from just before the attempt that set
     * it.
     *
     * Comparing the two `lockedUntil` instants directly proves nothing: the
     * second lock is set later in wall-clock time, so its deadline is later
     * whatever the policy does. The previous version of this test did exactly
     * that, and it passed with the escalation removed — `computeLockout`
     * returning a flat `LOCKOUT_BASE_MS` left it green. A test named for
     * escalation that cannot see escalation is worse than no test.
     *
     * The measurement over-states each duration by however long the sign-in
     * round trip takes, and identically for both, while the policy doubles
     * from sixty seconds. There is no contest.
     */
    const lockoutAfterFailure = async (): Promise<number> => {
      const before = Date.now();
      await expect(auth.signIn({ username: 'escalate', password: 'wrong' })).rejects.toThrow();
      return new Date((await attemptsFor(userId)).lockedUntil!).getTime() - before;
    };

    for (let i = 0; i < 4; i++) {
      await expect(auth.signIn({ username: 'escalate', password: 'wrong' })).rejects.toThrow();
    }
    const first = await lockoutAfterFailure();

    // Clear the lock (not the streak) to let one more attempt through, as the
    // passage of time would.
    await db.updateTable('omnitron_users').set({ lockedUntil: null }).where('id', '=', userId).execute();
    const second = await lockoutAfterFailure();

    expect(second).toBeGreaterThan(first);
    // Doubling, not merely "more": a policy that added a second per failure
    // would satisfy the line above and protect nobody.
    expect(second).toBeGreaterThanOrEqual(first * 1.5);
  });

  it('clears the streak on a successful sign-in', async () => {
    const userId = await createUser('recover');

    for (let i = 0; i < 3; i++) {
      await expect(auth.signIn({ username: 'recover', password: 'wrong' })).rejects.toThrow();
    }
    expect((await attemptsFor(userId)).failedLoginAttempts).toBe(3);

    const result = await auth.signIn({ username: 'recover', password: PASSWORD });
    expect(result.accessToken).toBeTruthy();

    const state = await attemptsFor(userId);
    expect(state.failedLoginAttempts).toBe(0);
    expect(state.lockedUntil).toBeNull();
  });

  it('counts every independently admitted failure exactly once', async () => {
    const username = 'parallel';
    const userId = await createUser(username);
    const attempts = 7;
    const checks = holdChecks(auth, attempts);
    const pending = Promise.all(Array.from({ length: attempts }, () =>
      expect(auth.signIn({ username, password: 'wrong' })).rejects.toThrow('Invalid credentials')));
    try { await checks.reached; } finally { checks.release(); }
    await pending;
    const state = await attemptsFor(userId);
    expect(state.failedLoginAttempts).toBe(attempts);
    expect(state.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    await expect(auth.signIn({ username, password: 'wrong again' })).rejects.toThrow('temporarily locked');
    expect(await attemptsFor(userId)).toEqual(state);
  });

  it('refuses an in-flight correct password when another client reaches the lockout threshold', async () => {
    const username = 'parallel-lockout';
    const userId = await createUser(username);
    const second = new AuthService(db, 'test-secret-for-throttle-suite');
    const checks = holdChecks(auth);
    const pending = expect(auth.signIn({ username, password: PASSWORD })).rejects.toThrow('temporarily locked');
    try {
      await checks.reached;
      for (let attempt = 0; attempt < 5; attempt++)
        await expect(second.signIn({ username, password: 'wrong' })).rejects.toThrow('Invalid credentials');
    } finally { checks.release(); }
    await pending;
    expect((await attemptsFor(userId)).failedLoginAttempts).toBe(5);
    expect(await auth.getActiveSessions(userId)).toHaveLength(0);
  });

  it('issues the current role after a change during verification', async () => {
    const username = 'revalidate-role';
    const userId = await createUser(username);
    const role = holdChecks(auth);
    const pendingRole = auth.signIn({ username, password: PASSWORD });
    try {
      await role.reached;
      await db.updateTable('omnitron_users').set({ role: 'viewer' }).where('id', '=', userId).execute();
    } finally { role.release(); }
    const result = await pendingRole;
    expect(result.user.role).toBe('viewer');
    expect(await auth.validateToken(result.accessToken)).toMatchObject({ role: 'viewer' });
    expect(decodeJwt(result.accessToken)['role']).toBe('viewer');
  });

  it('refuses the previous password after a rotation during verification', async () => {
    const username = 'revalidate-password';
    const userId = await createUser(username);
    const second = new AuthService(db, 'test-secret-for-throttle-suite');
    const password = holdChecks(auth);
    const stale = expect(auth.signIn({ username, password: PASSWORD })).rejects.toThrow('Invalid credentials');
    try {
      await password.reached;
      await second.changePassword(userId, PASSWORD, 'a-new-secret-for-auth-regression');
    } finally { password.release(); }
    await stale;
    expect(await auth.getActiveSessions(userId)).toHaveLength(0);
  });

  it('only accepts one concurrent rotation verified against the previous password', async () => {
    const userId = await createUser('rotate');
    const checks = holdChecks(auth, 2);
    const passwords = ['a-first-replacement-for-the-test', 'another-replacement-for-the-test'];
    const pending = Promise.allSettled(passwords.map(password => auth.changePassword(userId, PASSWORD, password)));
    try { await checks.reached; } finally { checks.release(); }
    const results = await pending;
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')?.reason).toHaveProperty('message', 'Invalid current password');
    const password = passwords[results.findIndex(r => r.status === 'fulfilled')]!;
    expect((await auth.signIn({ username: 'rotate', password })).user.id).toBe(userId);
  });

  it('rolls back the session if persisting successful sign-in fails', async () => {
    const username = 'rollback';
    const userId = await createUser(username);
    await expect(auth.signIn({ username, password: 'wrong' })).rejects.toThrow('Invalid credentials');
    await sql`ALTER TABLE omnitron_users ADD CONSTRAINT reject_test_login
      CHECK (username <> 'rollback' OR "lastLoginAt" IS NULL)`.execute(db);
    try {
      await expect(auth.signIn({ username, password: PASSWORD })).rejects.toThrow('reject_test_login');
      expect(await auth.getActiveSessions(userId)).toHaveLength(0);
      expect((await attemptsFor(userId)).failedLoginAttempts).toBe(1);
    } finally {
      await sql`ALTER TABLE omnitron_users DROP CONSTRAINT reject_test_login`.execute(db);
    }
  });

  it('takes comparable time for an unknown username as for a wrong password', async () => {
    await createUser('known-user');

    const timeOf = async (username: string): Promise<number> => {
      const started = process.hrtime.bigint();
      await expect(auth.signIn({ username, password: 'wrong' })).rejects.toThrow('Invalid credentials');
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    // Warm up so first-call costs (decoy hash, query plans) don't skew it.
    await timeOf('no-such-user');
    await db.updateTable('omnitron_users').set({ failedLoginAttempts: 0, lockedUntil: null }).where('username', '=', 'known-user').execute();

    const unknown = await timeOf('no-such-user');
    await db.updateTable('omnitron_users').set({ failedLoginAttempts: 0, lockedUntil: null }).where('username', '=', 'known-user').execute();
    const known = await timeOf('known-user');

    // Both paths pay a scrypt. Asserting a RATIO rather than an absolute
    // bound keeps this meaningful on a loaded machine: before the fix the
    // unknown-user path skipped hashing entirely and was an order of
    // magnitude faster.
    const ratio = Math.max(unknown, known) / Math.max(1, Math.min(unknown, known));
    expect(ratio).toBeLessThan(4);
  });
});
