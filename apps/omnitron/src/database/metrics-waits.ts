import { sql, type Kysely } from 'kysely';

interface SessionGroup {
  state: string;
  waitType: string | null;
  waitEvent: string | null;
  holdsMetricsLock: boolean;
  blocked: boolean;
  sessions: number;
}

/** Aggregate PostgreSQL's own observations. Never fetch query text or application rows. */
export async function readMetricsWaits<DB>(db: Kysely<DB>) {
  const table = await sql<{ live: string; dead: string; inserted: string; deleted: string }>`
    SELECT n_live_tup AS live, n_dead_tup AS dead, n_tup_ins AS inserted, n_tup_del AS deleted
    FROM pg_catalog.pg_stat_user_tables
    WHERE relid = pg_catalog.to_regclass('metrics_samples')
  `.execute(db);
  if (table.rows.length !== 1) throw Error('The configured PostgreSQL database has no visible metrics_samples table');
  const waits = await sql<SessionGroup>`
    WITH active AS (
      SELECT a.state, a.wait_event_type, a.wait_event,
             EXISTS (SELECT 1 FROM pg_catalog.pg_locks l WHERE l.pid = a.pid
                     AND l.database = a.datid AND l.relation = pg_catalog.to_regclass('metrics_samples')
                     AND l.granted) AS holds_metrics_lock,
             cardinality(pg_catalog.pg_blocking_pids(a.pid)) > 0 AS blocked
      FROM pg_catalog.pg_stat_activity a
      WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()
        AND a.state IS NOT NULL AND a.state <> 'idle'
    )
    SELECT state, wait_event_type AS "waitType", wait_event AS "waitEvent",
           holds_metrics_lock AS "holdsMetricsLock", blocked, count(*)::int AS sessions
    FROM active GROUP BY state, wait_event_type, wait_event, holds_metrics_lock, blocked
    ORDER BY sessions DESC, state, wait_event_type, wait_event, holds_metrics_lock, blocked
  `.execute(db);
  return { observedAt: new Date().toISOString(), table: table.rows[0]!, waits: waits.rows };
}
