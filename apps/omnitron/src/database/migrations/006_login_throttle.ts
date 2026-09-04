/**
 * Migration 006 — Login throttling state
 *
 * The console's sign-in endpoint had no brute-force protection of any kind:
 * `@Public({ auth: { allowAnonymous: true } })` straight into a scrypt
 * comparison, unlimited attempts, no lockout, no record of failures. An
 * attacker could grind passwords against the infrastructure control plane at
 * whatever rate the CPU allowed.
 *
 * Counters live in the database rather than in daemon memory so a lockout
 * survives a daemon restart — otherwise `omnitron down && omnitron up`, or
 * any crash-restart the attacker can provoke, resets the defence.
 */

import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('omnitron_users')
    .addColumn('failedLoginAttempts', 'integer', (col) => col.notNull().defaultTo(0))
    .execute();

  await db.schema.alterTable('omnitron_users').addColumn('lockedUntil', 'timestamptz').execute();

  // Partial index: only locked accounts are ever scanned by the unlock sweep.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_omnitron_users_locked_until
      ON omnitron_users ("lockedUntil")
      WHERE "lockedUntil" IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_omnitron_users_locked_until`.execute(db);
  await db.schema.alterTable('omnitron_users').dropColumn('lockedUntil').execute();
  await db.schema.alterTable('omnitron_users').dropColumn('failedLoginAttempts').execute();
}
