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

/**
 * Replace every `Date` in a statement's arguments with its ISO form.
 *
 * better-sqlite3 accepts bindings two ways — `stmt.all(a, b)` and
 * `stmt.all([a, b])` — and Kysely's SQLite driver uses the SECOND:
 *
 *     rows: stmt.all(parameters)
 *     const { changes } = stmt.run(parameters)
 *
 * So this is handed ONE argument which is the array of bindings, and a
 * version that looked only at the top level found no Date and changed
 * nothing.
 *
 * That is exactly what happened. The first fix converted the spread form,
 * its test called it the spread way, both were green, and the failure it was
 * written for went on every thirty seconds on a real node — visible only
 * because the node was watched after the version shipped:
 *
 *     05:53:02  Sync buffer retention pass failed
 *     05:53:32  Sync buffer retention pass failed   ← on the FIXED build
 *
 * A test that calls the code differently from its only caller tests a
 * different thing.
 */
export function serialiseDates(args: readonly unknown[]): readonly unknown[] {
  let changed = false;

  const convert = (value: unknown): unknown => {
    if (value instanceof Date) {
      changed = true;
      return value.toISOString();
    }
    // One level of nesting, because that is the shape a driver passes: an
    // array OF bindings. Deeper is not a thing SQLite binds, and walking
    // arbitrary structures would convert Dates inside a JSON column's value,
    // which the caller serialised deliberately.
    if (Array.isArray(value)) {
      let innerChanged = false;
      const inner = value.map((v) => {
        if (v instanceof Date) {
          innerChanged = true;
          return v.toISOString();
        }
        return v;
      });
      if (innerChanged) {
        changed = true;
        return inner;
      }
      return value;
    }
    return value;
  };

  const out = args.map(convert);
  return changed ? out : args;
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
