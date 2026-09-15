/**
 * Which engine a Kysely instance is talking to, and the queries that have to
 * ask differently.
 *
 * The daemon runs the SAME services against two databases — a master on
 * Postgres, a slave on SQLite — while the schema types describe the master
 * only. Every query written without that in mind works on one and fails on
 * the other, and it fails where nobody is looking: on a remote node, in a
 * pass whose failure is a log line.
 *
 * Found this way, in one week, all on paths that had just become reachable:
 *
 *   - a `Date` binding better-sqlite3 refuses    → `sqlite-date-binding.ts`
 *   - `pg_total_relation_size` on a slave's WAL  → `sync.service.ts`
 *   - `labels @> ?::jsonb` on a slave's logs     → here
 *
 * The last one is not a wrong answer but a syntax error — SQLite reads `@`
 * as an unrecognized token and refuses the whole statement, so a log query
 * with any label filter throws on every slave. Measured against the live
 * node's own database file.
 *
 * Most portability questions are answered by writing the query in terms both
 * engines share, and that is always the first choice. This module exists for
 * the rest: where the dialects differ in what they can make FAST, and the
 * portable form would give up an index on the side that has the volume.
 */

import { sql, PostgresAdapter, type Kysely } from 'kysely';

export type SqlDialect = 'postgres' | 'sqlite' | 'unknown';

/**
 * Ask the database object, rather than track what we built.
 *
 * A registry of "this connection is SQLite" is one more thing to keep in
 * step with reality, and it goes stale silently — a Kysely built somewhere
 * new is simply absent from it, and absence reads as a default. The adapter
 * is the engine's own answer, and it cannot disagree with itself.
 */
export function dialectOf(db: Kysely<any>): SqlDialect {
  try {
    const adapter = db.getExecutor().adapter;
    if (adapter instanceof PostgresAdapter) return 'postgres';
    return adapter?.constructor?.name === 'SqliteAdapter' ? 'sqlite' : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * "This JSON column contains every one of these key/value pairs."
 *
 * Postgres gets `@>`, which is the operator its GIN index answers — the
 * master's `logs` table reached 13 GB on a development host, so giving up
 * that index is not a portability tax worth paying.
 *
 * Everything else — SQLite, and any engine this cannot identify — gets one
 * `->>` comparison per key, AND-ed. `->>` is understood by both (Postgres
 * since 14, SQLite since 3.38), so the fallback is correct on the master
 * too; it is only slower there, which is the right way round for a branch
 * that might one day be taken by mistake.
 *
 * Equivalent for the flat `Record<string, string>` these filters carry: `@>`
 * is structural containment, and for one level of string values that is what
 * the AND-ed comparisons compute.
 *
 * An empty set of pairs constrains nothing, and the caller is expected to
 * have decided that already — a filter that silently matches everything is
 * worse than no filter, because the unnarrowed result reads as an answer.
 */
export function jsonContains(
  db: Kysely<any>,
  column: string,
  pairs: Record<string, string>,
) {
  const ref = sql.ref(column);
  const entries = Object.entries(pairs);
  if (entries.length === 0) return sql<boolean>`(1 = 1)`;

  if (dialectOf(db) === 'postgres') {
    return sql<boolean>`(${ref} @> ${JSON.stringify(pairs)}::jsonb)`;
  }

  return entries
    .map(([key, value]) => sql<boolean>`(${ref} ->> ${key} = ${String(value)})`)
    .reduce((left, right) => sql<boolean>`(${left} AND ${right})`);
}
