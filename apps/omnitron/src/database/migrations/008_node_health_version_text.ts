/**
 * Migration 008: `node_health_checks."omnitronVersion"` — text, not varchar(32).
 *
 * A node running a bundle built from a working tree reports its version with
 * build metadata — `0.2.0+local.<sha>.<stamp>`, 37 characters
 * (`services/local-bundle.ts`) — and the column held 32. The health-monitor
 * worker writes a round as ONE insert with a row per node, so the first node
 * that answered with such a version failed the whole statement, every round,
 * and the history of every node stopped with it. On the master, 2026-09-22:
 * no row after 12:15:55 UTC, while Postgres logged once a minute
 *
 *     ERROR:  value too long for type character varying(32)
 *
 * — and nobody saw it, because the worker's own warning went nowhere (see
 * `SystemWorkerManager.forwardLog`).
 *
 * A version is an operator's answer to «which build is on this node»;
 * cutting it to fit would cut exactly the part that answers that. varchar to
 * text is binary-compatible in Postgres, so the table is not rewritten.
 */

import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('node_health_checks')
    .alterColumn('omnitronVersion', (col) => col.setDataType('text'))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Back to the old width, keeping what fits: a longer value would refuse the ALTER.
  await sql`
    ALTER TABLE node_health_checks
      ALTER COLUMN "omnitronVersion" TYPE varchar(32) USING left("omnitronVersion", 32)
  `.execute(db);
}
