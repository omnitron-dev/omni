/**
 * The shared `list()`: a default instead of a bound, and an order that could tie.
 *
 * `TransactionAwareRepository.list()` is the paged read every repository in the
 * platform inherits. It read:
 *
 *     const limit = options.limit ?? 20;      // a DEFAULT, not a bound
 *     const offset = options.offset ?? 0;     // no ceiling at all
 *     dataQuery = dataQuery.orderBy(orderBy, direction);   // and no tiebreak
 *
 * A default applies only when the caller OMITS the value, so `limit: 1_000_000`
 * reached SQL in full; an offset in the millions is a scan Postgres performs and
 * discards, for one request. And `createdAt` — the default sort — is `NOW()` in
 * Postgres, the TRANSACTION timestamp, so every row one transaction wrote shares
 * it to the microsecond. `LIMIT`/`OFFSET` walks a sorted list by position, so a
 * tie lets one row sit at position 50 on one read and 49 on the next: shown
 * twice, and the row it displaced shown never. Nothing fails and nothing logs.
 *
 * Measured before changing anything: no repository in this monorepo extends this
 * class outside examples and tests, and in the consuming monorepo `apps/main`
 * overrides `list()` with its own clamps and allowlist while five other apps
 * inherit it and call it nowhere. So this was a loaded gun rather than a live
 * hole — which is why the bounds here are conservative and every one of them is
 * a field a subclass can raise deliberately.
 *
 * Both roads are driven below, because a court that drives one road says nothing
 * about the other: `list()` itself, and the protected `findManyBy`/`findAll`
 * helpers that take the same `orderBy` and the same page.
 *
 * What this court reads is the SQL, not the database: Kysely compiles without a
 * connection. So it proves the statement — and NOT that a column named in it
 * exists. `hasIdColumn` is the field that answers that, and the last case here
 * is the one that pins it.
 */
import { describe, it, expect } from 'vitest';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type Generated,
} from 'kysely';

import { TransactionAwareRepository } from '../src/repository/transaction-aware.repository.js';
import type { FindManyOptions, ListOptions } from '../src/repository/transaction-aware.repository.js';

interface WidgetsTable {
  id: Generated<string>;
  name: string;
  createdAt: Date;
}
interface TestDB {
  widgets: WidgetsTable;
}

function recordingDb(): { db: Kysely<TestDB>; sql: string[] } {
  const sql: string[] = [];
  const db = new Kysely<TestDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      sql.push(event.query.sql);
    },
  });
  return { db, sql };
}

class Widgets extends TransactionAwareRepository<TestDB, 'widgets'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'widgets');
  }

  /** The protected helpers, reachable from a court without loosening them. */
  listMany(options?: FindManyOptions) {
    return this.findAll(options);
  }

  listManyBy(options?: FindManyOptions) {
    return this.findManyBy('name', 'x', options);
  }
}

/** A junction table: keyed on a pair, with no `id` of its own. */
class Junction extends Widgets {
  protected override readonly hasIdColumn = false;
}

/** A repository that pages larger on purpose. */
class BigPages extends Widgets {
  protected override readonly maxPageSize = 1000;
  protected override readonly defaultPageSize = 500;
}

/** The page statement: a page carries a limit, the count beside it does not. */
async function pageOf(run: (db: Kysely<TestDB>) => Promise<unknown>): Promise<string> {
  const { db, sql } = recordingDb();
  try {
    await run(db);
  } catch {
    // `DummyDriver` answers with no rows; the SQL is already recorded.
  }
  const page = sql.find((s) => /\slimit\s/i.test(s)) ?? sql[sql.length - 1];
  expect(page, 'nothing compiled').toBeTruthy();
  return page!;
}

/** The numbers Kysely sent, in order. */
async function paramsOf(run: (db: Kysely<TestDB>) => Promise<unknown>): Promise<number[]> {
  const { db, sql } = recordingDb();
  const numbers: number[] = [];
  const spy = new Kysely<TestDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    log: (event) => {
      sql.push(event.query.sql);
      for (const p of event.query.parameters) if (typeof p === 'number') numbers.push(p);
    },
  });
  try {
    await run(spy);
  } catch {
    // as above
  }
  void db;
  return numbers;
}

describe('list() bounds the page it was asked for', () => {
  it('takes the default when the caller names none', async () => {
    expect(await paramsOf((db) => new Widgets(db).list())).toContain(20);
  });

  it('caps a limit that would export the table', async () => {
    const numbers = await paramsOf((db) => new Widgets(db).list({ limit: 1_000_000 }));
    expect(numbers).toContain(100);
    expect(numbers).not.toContain(1_000_000);
  });

  it('caps an offset that would be scanned and thrown away', async () => {
    const numbers = await paramsOf((db) => new Widgets(db).list({ offset: 5_000_000 }));
    expect(numbers).toContain(10_000);
    expect(numbers).not.toContain(5_000_000);
  });

  it('answers a nonsensical page with the default rather than with an error', async () => {
    // `LIMIT 0` returns nothing and `LIMIT -1` is an error Postgres raises; both
    // read to the caller as a broken page rather than as an answer.
    expect(await paramsOf((db) => new Widgets(db).list({ limit: 0 }))).toContain(20);
    expect(await paramsOf((db) => new Widgets(db).list({ limit: -5 }))).toContain(20);
    expect(await paramsOf((db) => new Widgets(db).list({ offset: -5 }))).toContain(0);
  });

  it('lets a subclass page larger on purpose', async () => {
    const numbers = await paramsOf((db) => new BigPages(db).list({ limit: 900 }));
    expect(numbers).toContain(900);
    expect(await paramsOf((db) => new BigPages(db).list())).toContain(500);
  });

  it('honours a reasonable page unchanged', async () => {
    const numbers = await paramsOf((db) => new Widgets(db).list({ limit: 25, offset: 50 }));
    expect(numbers).toContain(25);
    expect(numbers).toContain(50);
  });
});

describe('list() ends its order on something that cannot tie', () => {
  it('follows the sort with the key, in the same direction', async () => {
    expect(await pageOf((db) => new Widgets(db).list())).toContain('order by "createdAt" desc, "id" desc');
    expect(await pageOf((db) => new Widgets(db).list({ direction: 'asc' }))).toContain(
      'order by "createdAt" asc, "id" asc',
    );
  });

  it('does not repeat itself when the key IS the sort', async () => {
    const page = await pageOf((db) => new Widgets(db).list({ orderBy: 'id' }));
    expect(page).toContain('order by "id" desc');
    expect(page).not.toContain('"id" desc, "id" desc');
  });

  it('answers only asc or desc, whatever the caller sends', async () => {
    // Kysely throws `Invalid order by direction` on anything else, so a wire
    // value that contradicts the type would be a failed page rather than a page.
    const page = await pageOf((db) => new Widgets(db).list({ direction: 'sideways' as never }));
    expect(page).toContain('order by "createdAt" desc, "id" desc');
  });

  it('asks for no id on a table that has none', async () => {
    // A compiled order proves the SQL, not the column: `order by "id"` on a
    // junction table compiles perfectly and fails in Postgres. `hasIdColumn` is
    // the door, and it is closed here.
    const page = await pageOf((db) => new Junction(db).list());
    expect(page).toContain('order by "createdAt" desc');
    expect(page).not.toContain('"id"');
  });
});

describe('the other road: the protected helpers take the same page', () => {
  it('findAll ends on the key when an order was asked for', async () => {
    const page = await pageOf((db) =>
      new Widgets(db).listMany({ orderBy: 'name', direction: 'asc', limit: 10, offset: 20 }),
    );
    expect(page).toContain('order by "name" asc, "id" asc');
  });

  it('findManyBy too', async () => {
    const page = await pageOf((db) => new Widgets(db).listManyBy({ orderBy: 'createdAt', limit: 10, offset: 20 }));
    expect(page).toContain('order by "createdAt" desc, "id" desc');
  });

  it('and neither invents an order where the caller asked for none', async () => {
    // Imposing one would change which rows an existing caller gets back. Named
    // here rather than done, so the next reader knows it was a decision.
    const page = await pageOf((db) => new Widgets(db).listMany({ limit: 10 }));
    expect(page).not.toContain('order by');
  });

  it('nor a key the table has not got', async () => {
    const page = await pageOf((db) => new Junction(db).listMany({ orderBy: 'name', limit: 10 }));
    expect(page).toContain('order by "name" desc');
    expect(page).not.toContain('"id"');
  });
});

describe('the contract this court speaks for', () => {
  it('leaves ListOptions and FindManyOptions as they were', () => {
    // The change is behaviour behind the same shape: nothing here is new to a
    // caller, which is why five apps can inherit it without a change of their own.
    const list: ListOptions = { limit: 1, offset: 0, orderBy: 'id', direction: 'asc' };
    const find: FindManyOptions = { limit: 1, offset: 0, orderBy: 'id', direction: 'asc' };
    expect([list.limit, find.limit]).toEqual([1, 1]);
  });
});
