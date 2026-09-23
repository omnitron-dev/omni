/**
 * Migration 009: a check that could not tell running from stopped measured
 * neither.
 *
 * Until dea8ce80 the health checker read `pid` at the top level of
 * `omnitron status --json`, outside its `{ok, data}` envelope, so every answer
 * from a running daemon became `omnitronConnected = false`. It did so in two
 * eras:
 *
 *   - until dd38fb74 (2026-09-14) silently: `omnitron status --json
 *     2>/dev/null || echo "{"` answered `{connected: false}` with no error
 *     for a daemon running, stopped or not installed alike;
 *   - from then, with words: «omnitron status reported no running daemon».
 *
 * Either way the reading was the same whatever the node was doing, so it
 * measured nothing — and the console averaged it into «OMNITRON 6%» for a
 * node whose daemon was delivering its apps' logs to the master every day
 * from 2026-09-16.
 *
 * On the master, 2026-09-23, all for the test node: 7 637 rows with the words
 * (09-14 19:01 → 09-22 07:57) and 3 895 silent ones (07-02 → 09-12), 62 of
 * those with SSH connected, which the uptime counted as measured. The node's
 * first check by the corrected reader, 09-22 19:27, read it connected; no row
 * with either answer came after it.
 *
 * `omnitronConnected` becomes nullable — NULL is «not measured» — and those
 * rows get it, their error with it: words the reader said about every node
 * are not a finding about this one. Nothing is deleted; ping and SSH were
 * measured and stay.
 *
 * Which rows: either answer, from a node later read connected, before its
 * first connected check. That later check is what proves the reader was the
 * old one; a node never read connected has no such proof and keeps its rows,
 * and a row with either answer after a connected check came from the
 * corrected reader, which says why whenever it says «not connected».
 */

import { type Kysely, sql } from 'kysely';

/** What the old reader answered, from dd38fb74 on, for every node. */
const OLD_READERS_WORDS = 'omnitron status reported no running daemon';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE node_health_checks ALTER COLUMN "omnitronConnected" DROP NOT NULL`.execute(db);
  await sql`
    UPDATE node_health_checks AS c
       SET "omnitronConnected" = NULL,
           "omnitronError" = NULL
     WHERE c."omnitronConnected" = false
       AND (c."omnitronError" = ${OLD_READERS_WORDS} OR c."omnitronError" IS NULL)
       AND c."checkedAt" < (
             SELECT min(r."checkedAt")
               FROM node_health_checks AS r
              WHERE r."nodeId" = c."nodeId"
                AND r."omnitronConnected"
           )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Every NULL is one this migration wrote — no writer stores one — and each
  // was `false` before. The old reader's words are not put back: they were
  // the same for every node, and which rows had them is not recorded.
  await sql`UPDATE node_health_checks SET "omnitronConnected" = false WHERE "omnitronConnected" IS NULL`.execute(db);
  await sql`ALTER TABLE node_health_checks ALTER COLUMN "omnitronConnected" SET NOT NULL`.execute(db);
}
