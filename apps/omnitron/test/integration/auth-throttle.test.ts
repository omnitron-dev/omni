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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';

import { setEnvOverride, resetEnvCache } from '../../src/shared/env-config.js';
import { AuthService } from '../../src/services/auth.service.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const PASSWORD = 'correct-horse-battery-staple';

let db: Kysely<OmnitronDatabase>;
let auth: AuthService;

async function createUser(username: string): Promise<string> {
  const hash = await auth.hashPassword(PASSWORD);
  const row = await db
    .insertInto('omnitron_users')
    .values({ username, passwordHash: hash, role: 'admin', displayName: username })
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

describe('sign-in throttling (integration)', () => {
  beforeAll(async () => {
    resetEnvCache();
    setEnvOverride({ OMNITRON_DATABASE_URL: TEST_PG_URL });

    const { createOmnitronDb } = await import('../../src/database/connection.js');
    db = await createOmnitronDb({ max: 2 });

    const { sql } = await import('kysely');
    try {
      await sql`SELECT 1`.execute(db);
    } catch (err) {
      throw new Error(
        `Test PostgreSQL unreachable at ${TEST_PG_URL} — run \`pnpm test:up\` first. Cause: ${(err as Error).message}`
      );
    }

    auth = new AuthService(db, 'test-secret-for-throttle-suite');
  });

  afterAll(async () => {
    if (db) await db.destroy();
    resetEnvCache();
  });

  beforeEach(async () => {
    const { sql } = await import('kysely');
    await sql`DROP SCHEMA public CASCADE`.execute(db);
    await sql`CREATE SCHEMA public`.execute(db);

    const { migrateOmnitronDb } = await import('../../src/database/migration-runner.js');
    await migrateOmnitronDb(db as unknown as Kysely<unknown>);
    // 001 seeds a default admin; the suite works with its own users.
    await db.deleteFrom('omnitron_users').execute();
  });

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

  it('takes comparable time for an unknown username as for a wrong password', async () => {
    await createUser('known-user');

    const timeOf = async (username: string): Promise<number> => {
      const started = process.hrtime.bigint();
      await expect(auth.signIn({ username, password: 'wrong' })).rejects.toThrow('Invalid credentials');
      return Number(process.hrtime.bigint() - started) / 1e6;
    };

    // Warm up so first-call costs (decoy hash, query plans) don't skew it.
    await timeOf('no-such-user');
    await db.updateTable('omnitron_users').set({ failedLoginAttempts: 0, lockedUntil: null }).execute();

    const unknown = await timeOf('no-such-user');
    await db.updateTable('omnitron_users').set({ failedLoginAttempts: 0, lockedUntil: null }).execute();
    const known = await timeOf('known-user');

    // Both paths pay a scrypt. Asserting a RATIO rather than an absolute
    // bound keeps this meaningful on a loaded machine: before the fix the
    // unknown-user path skipped hashing entirely and was an order of
    // magnitude faster.
    const ratio = Math.max(unknown, known) / Math.max(1, Math.min(unknown, known));
    expect(ratio).toBeLessThan(4);
  });
});
