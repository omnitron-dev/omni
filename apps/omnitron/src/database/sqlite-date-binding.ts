/**
 * Let a SQLite-backed Kysely accept the `Date` values the rest of the code
 * passes it.
 *
 * `better-sqlite3` binds "numbers, strings, bigints, buffers, and null" and
 * refuses everything else, a `Date` included. Postgres's driver serialises
 * one happily. The daemon runs the SAME services against both — a master on
 * Postgres, a slave on SQLite — so any query written with a `Date` works on
 * one and throws on the other, and the schema types describe the master.
 *
 * Measured 2026-09-14 on a provisioned slave node:
 *
 *     ERROR  Log retention pass failed
 *       error: "SQLite3 can only bind numbers, strings, bigints, buffers, and null"
 *     WARN   Sync buffer retention pass failed
 *       error: "SQLite3 can only bind numbers, strings, bigints, buffers, and null"
 *
 * — the second one every thirty seconds, with the buffer bound bounding
 * nothing. Both had been unreachable until this week: the slave replication
 * path had no producer, and the bound only ran at the end of a successful
 * cycle. Making them run is what made them fail.
 *
 * Converting at the two call sites was the obvious fix and the wrong one:
 * there are two today because there are two features, and the next query
 * written against a slave's storage with a `Date` in it fails the same way.
 * The driver is where the value has to be right, so the conversion goes
 * there.
 *
 * ISO-8601 is what these columns hold, and it sorts chronologically as text —
 * which is why the comparisons this fixes are correct once the bind works.
 */

/** Replace every `Date` in a parameter list with its ISO form. */
export function serialiseDates(parameters: readonly unknown[]): readonly unknown[] {
  let changed = false;
  const out = parameters.map((value) => {
    if (value instanceof Date) {
      changed = true;
      return value.toISOString();
    }
    return value;
  });
  return changed ? out : parameters;
}

/**
 * Wrap a better-sqlite3 database so every bound `Date` becomes a string.
 *
 * Done at the driver rather than as a Kysely plugin because a plugin's
 * `transformQuery` sees the query AST, where a parameter is a
 * `ValueNode` — reachable, but only by walking every node type Kysely can
 * produce, and silently incomplete the moment it produces a new one. The
 * driver sees the finished parameter list, which is the whole of what is
 * being bound and cannot be partially traversed.
 */
export function withDateBinding<T extends { prepare(sql: string): unknown }>(database: T): T {
  const originalPrepare = database.prepare.bind(database);

  (database as { prepare(sql: string): unknown }).prepare = (sql: string) => {
    const statement = originalPrepare(sql) as Record<string, unknown>;

    for (const method of ['run', 'get', 'all', 'iterate'] as const) {
      const original = statement[method];
      if (typeof original !== 'function') continue;
      statement[method] = function wrapped(this: unknown, ...parameters: unknown[]) {
        return (original as (...a: unknown[]) => unknown).apply(this, [...serialiseDates(parameters)]);
      };
    }

    return statement;
  };

  return database;
}
