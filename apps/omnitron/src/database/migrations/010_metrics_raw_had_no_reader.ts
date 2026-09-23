/**
 * Migration 010: a table with writers and no reader.
 *
 * `metrics_raw` on the master was written by one path — `SyncService`
 * storing the metrics its nodes replicate — and read by none: the console's
 * charts and the metrics RPC query titan-metrics, which the same ingest feeds
 * through its sink with a `node` label. The write had been kept «until the
 * console is observed showing the label»; on 2026-09-23 the master's
 * `OmnitronMetrics.querySeries` returned 19 series labelled with the test
 * node beside 19 of its own. Nothing pruned the table either — titan-metrics'
 * retention applies to its own (memory) store — so it held 8 371 210 rows,
 * 2.1 GiB, from 2026-09-14 on, ~0.93 million more a day, and `omnitron
 * doctor` flagged the database for it.
 *
 * Dropped. A node's own SQLite `metrics_raw` (`slave-storage.service.ts`) is
 * a different table — the buffer it replicates from — and is not touched.
 * `down` recreates the table as 002 made it, empty.
 */

import type { Kysely } from 'kysely';

import { up as createMetricsRaw } from './002_metrics_raw.js';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('metrics_raw').ifExists().execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await createMetricsRaw(db);
}
