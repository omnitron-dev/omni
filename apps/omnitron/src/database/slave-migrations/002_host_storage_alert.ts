import { sql, type Kysely } from 'kysely';
import { seedStorageAlert, removeStorageAlert } from '../migrations/018_host_storage_alert.js';

export async function up(db: Kysely<unknown>) {
  const columns = await sql<{ name: string }>`PRAGMA table_info(alert_events)`.execute(db);
  if (!columns.rows.some((c) => c.name === 'originNode')) {
    await sql`ALTER TABLE alert_events ADD COLUMN originNode TEXT`.execute(db);
    // Older node databases only evaluated their own alarms. The receiver always used PostgreSQL.
    await sql`ALTER TABLE alert_events ADD COLUMN legacyOrigin INTEGER NOT NULL DEFAULT 0`.execute(db);
  }
  await sql.raw(seedStorageAlert).execute(db);
}
export async function down(db: Kysely<unknown>) {
  await sql.raw(removeStorageAlert).execute(db);
}
