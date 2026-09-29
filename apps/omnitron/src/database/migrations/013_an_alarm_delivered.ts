/**
 * An alarm delivered.
 *
 * A critical alert goes to the platform's alert sink (a project's
 * `monitoring.alertSink`) — and the sink is an app that is sometimes not
 * running: a deploy stops it for a minute or two, exactly when «App crashed»
 * fires. So delivery is a state, retried every evaluation tick until the sink
 * takes it: when the firing was taken, when the resolve was, and why the last
 * attempt failed while it keeps trying.
 */
import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE alert_events
      ADD COLUMN IF NOT EXISTS "deliveredAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "resolveDeliveredAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "deliveryError" text
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE alert_events
      DROP COLUMN IF EXISTS "deliveredAt",
      DROP COLUMN IF EXISTS "resolveDeliveredAt",
      DROP COLUMN IF EXISTS "deliveryError"
  `.execute(db);
}
