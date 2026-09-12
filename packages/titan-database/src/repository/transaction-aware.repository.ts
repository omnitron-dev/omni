/**
 * Transaction-Aware Repository (GOLDEN PATH)
 *
 * A repository base class that automatically uses the current transaction
 * from AsyncLocalStorage context. Provides standard CRUD operations.
 *
 * @module
 */

import type { Kysely, Transaction, Selectable, Insertable, Updateable } from 'kysely';
import { isKyseraExecutor, getPlugins, withPluginMetadata, createExecutorSync, type Plugin } from '@kysera/executor';
import { getTimestampsConfig } from '../database.decorators.js';
import {
  getExecutor,
  isInTransactionContext,
  getCurrentTransaction,
  getTablePlugins,
  isTablePluginInitialized,
} from '../transaction/transaction.context.js';
import { applyWhereClause, type WhereClause } from '@kysera/repository';
import { upsert as kyseraUpsert, upsertMany as kyseraUpsertMany, type UpsertOptions } from '@kysera/repository';
import {
  parseDatabaseError,
  SoftDeleteError,
  formatTimestampForDb,
  detectDialect,
  type DatabaseError as KyseraDatabaseError,
  type Executor,
  type Dialect,
} from '@kysera/core';

export interface FindManyOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'asc' | 'desc';
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  direction?: 'asc' | 'desc';
  includeSoftDeleted?: boolean;
  /**
   * Skip the COUNT query (kysera 0.10 'count: none' analogue): total is
   * reported as -1 and hasMore is derived from a limit+1 probe. Use on
   * hot paths where an exact total is not worth a second query.
   * @default true
   */
  withTotal?: boolean;
}

export interface OffsetPaginatedResult<T> {
  data: T[];
  /** Exact total, or -1 when the query ran with withTotal: false */
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/**
 * NOT USED — and worse, it is the one the package's root exports as
 * `CursorOptions`.
 *
 * No method here or anywhere in this package accepts it. The type that cursor
 * pagination actually runs on is `@kysera/repository`'s, re-exported from the
 * package root under the alias `CursorPaginationOptions`. So the obvious
 * import — `import type { CursorOptions } from '@omnitron-dev/titan-database'`
 * — yields the inert one, and the working one is behind the less obvious name.
 *
 * Left in place because renaming a public export is a decision, not a fix.
 */
export interface CursorOptions {
  limit?: number;
  cursor?: string;
  orderBy: Array<{ column: string; direction: 'asc' | 'desc' }>;
}

export interface CursorResult<T> {
  data: T[];
  pagination: { hasNext: boolean; nextCursor?: string; limit: number };
}

interface CountResult {
  count: string | number | bigint;
}

type DynamicQueryBuilder = {
  selectFrom(table: string): unknown;
  insertInto(table: string): unknown;
  updateTable(table: string): unknown;
  deleteFrom(table: string): unknown;
};

/**
 * Abstract repository that automatically uses transaction context.
 */
export abstract class TransactionAwareRepository<DB, Table extends string> {
  protected readonly hasSoftDelete: boolean = false;
  protected readonly softDeleteColumn: string = 'deletedAt';
  /**
   * Opt-in timestamp management: when enabled, createdAt/updatedAt are
   * injected on create/update (explicit values in data always win). Enable
   * per repository either with the `@Timestamps()` class decorator
   * (preferred; column names configurable there) or by overriding this
   * flag. Deliberately OFF by default — many tables are append-only logs
   * or junctions without these columns, and injecting into them would be
   * a runtime SQL error.
   */
  protected readonly hasTimestamps: boolean = false;
  protected readonly createdAtColumn: string = 'createdAt';
  protected readonly updatedAtColumn: string = 'updatedAt';

  /**
   * Apply the plugins registered for this table via `registerTablePlugins()`.
   *
   * OFF by default, and that default is the whole point of this flag.
   *
   * `registerTablePlugins` / `getTablePlugins` is a process-global Map in
   * `transaction.context.ts`. Until this existed it had NO READER: across
   * omni and downstream the only callers of `getTablePlugins` were the three
   * registrars themselves — main's RLS policies, payments's database plugins
   * and messaging's invite-policy trigger bridge — each reading back what it
   * had just written in order to merge. Everything they registered was
   * therefore inert, including two complete row-level-security policy sets.
   *
   * The break was delivery, not identity: every downstream backend already runs
   * each RPC inside `rlsContext.runAsync(...)` through its bootstrap's
   * `invocationWrapper`, so the auth context those policies read is live. The
   * repositories simply never saw the plugins, because they are handed
   * `DATABASE_CONNECTION` — `manager.getConnectionRef(...)`, a plain Kysely —
   * and this class returned it unchanged.
   *
   * There is a second, working delivery path in this package:
   * `@Repository(...)` resolves through `manager.getExecutorRef(name,
   * allPlugins)`. Two repositories in all of downstream use it, both in pricing,
   * neither with RLS. Moving 193 hand-constructed repositories onto the
   * decorator is not the smaller change; giving the registry its reader here
   * — one choke point every repository already passes through — is.
   *
   * Deliberately off by default: turning row-level security on for a schema
   * that has never enforced it changes what every query returns. An app opts
   * in on its own base repository, and stages the rollout by choosing which
   * TABLES it registers plugins for — a table with none is unaffected either
   * way.
   */
  protected readonly applyTablePlugins: boolean = false;

  /**
   * Cache for {@link withTablePlugins}: an executor wraps one target, so it is
   * rebuilt whenever the target or the registered plugin list changes. Inside
   * a transaction the target is a fresh `Transaction` each time, which is
   * exactly when it must be rebuilt.
   */
  private tablePluginTarget?: object;
  private tablePluginList?: readonly Plugin[];
  private tablePluginExecutor?: Executor<DB>;

  constructor(
    protected db: Kysely<DB>,
    public readonly tableName: Table
  ) {
    // T#84 follow-up — the shape check below told us WHAT the executor was;
    // this is the answer to it.
    //
    // `db` is sometimes an unsettled Promise. Titan's `Container.loadModule`
    // replaces every module provider's `useFactory` with a plain arrow that
    // calls the original inside `runInModuleScope`, and registration decides
    // async-ness from `useFactory.constructor.name === 'AsyncFunction'` — of
    // the wrapper, which is always `Function`. So an `async useFactory` like
    // `DATABASE_CONNECTION` is classified as synchronous, the guard that
    // exists to stop a sync caller receiving an unsettled Promise never
    // fires, and a repository built on the sync path keeps that Promise for
    // the life of the process. Every query through it then threw here.
    //
    // Measured downstream 2026-09-11: `OrgAuditLogRepository` was one of them,
    // so `Delivery.createPickupPoint` wrote its row and answered 500 on the
    // audit write that followed, and redeeming a pickup code marked the
    // parcel delivered and then answered 500. Fixing the classification in
    // Titan is correct and is NOT this change: it makes those sync
    // resolutions throw, and main's `DeliveryModule` eager-init does exactly
    // one of them, so the app stops booting. That is a framework change with
    // its own verification.
    //
    // This is the repository layer's half, and it is sound on its own terms:
    // a connection handed to us as a promise is still the connection once it
    // settles, so adopt it then. The window is one microtask after the
    // connection resolves — long before any request — and a `db` that never
    // settles still reaches the diagnostic in `executor`.
    //
    // `DeliveryConfigRepository` in the downstream project carries a hand-rolled version of
    // this (`resolveExecutor()`, awaiting `this.db` on every call) written
    // when someone hit the same wall and patched one repository. It is
    // redundant now, and harmless.
    const maybeThenable = db as unknown as { then?: unknown };
    if (db != null && typeof maybeThenable.then === 'function') {
      void (db as unknown as Promise<Kysely<DB>>).then(
        (settled) => {
          this.db = settled;
        },
        () => {
          // Leave `db` as-is: the `executor` getter reports the shape it
          // actually has, which is more useful than a second error here.
        }
      );
    }
  }

  protected get executor(): Executor<DB> {
    const e = getExecutor(this.db);
    // T#84 — defensive shape check. T#70 surfaced a production
    // case where `e.selectFrom` was undefined at call time —
    // every repo query crashed inside one specific RPC method
    // (Delivery.getActiveOrgPgpKey). Without context on WHAT the
    // executor actually was, root cause was unreachable. The
    // check below makes the next occurrence self-diagnosing
    // (cost: one typeof + one `in` check per query, both O(1)).
    if (e == null || typeof (e as { selectFrom?: unknown }).selectFrom !== 'function') {
      const inTransaction = isInTransactionContext();
      const sample = {
        type: typeof e,
        constructorName: e?.constructor?.name ?? 'null',
        ownKeys: e ? Object.getOwnPropertyNames(e).slice(0, 10) : [],
        protoKeys: e
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(e) ?? {}).slice(0, 10)
          : [],
        hasSelect: typeof (e as { selectFrom?: unknown })?.selectFrom,
        inTransaction,
        tableName: this.tableName,
      };
      const err = new Error(
        `[TransactionAwareRepository] executor has no selectFrom — diagnostic: ${JSON.stringify(sample)}`,
      );
      // Attach diagnostic on the error itself so error.log captures
      // the shape via T#70's structured stack/error fields.
      Object.assign(err, { diagnostic: sample });
      throw err;
    }
    return this.withTablePlugins(e);
  }

  protected get inTransaction(): boolean {
    return isInTransactionContext();
  }

  protected get transaction(): Transaction<DB> | undefined {
    return getCurrentTransaction<DB>();
  }

  protected get dynamicExecutor(): DynamicQueryBuilder {
    return this.executor as unknown as DynamicQueryBuilder;
  }

  // ===========================================================================
  // EXECUTOR PLUGIN AWARENESS
  // ===========================================================================

  /**
   * Wrap the current target in the plugins registered for this table.
   *
   * Four ways to return the target untouched, in the order they are cheapest
   * to check:
   *
   *   - the repository has not opted in (the default);
   *   - no plugin is registered for this table — staging a rollout is done by
   *     registering tables, not by branching here;
   *   - the injected connection is ALREADY a kysera executor carrying
   *     plugins, which is the `@Repository(...)` path; wrapping it again
   *     would run every interceptor twice;
   *   - the cached executor still matches this target and this plugin list.
   *
   * The cache is keyed on the target's identity rather than a boolean,
   * because inside a transaction the target is a fresh `Transaction` object
   * and must get its own wrapper — a plugin bound to the pooled connection
   * would run the transaction's statements outside it.
   */
  private withTablePlugins(target: Kysely<DB> | Transaction<DB>): Executor<DB> {
    if (!this.applyTablePlugins) return target as Executor<DB>;

    const plugins = getTablePlugins(this.tableName as unknown as string);
    if (plugins.length === 0) return target as Executor<DB>;

    const alreadyPluginAware =
      isKyseraExecutor(target as Kysely<DB>) && getPlugins(target as never).length > 0;
    if (alreadyPluginAware) return target as Executor<DB>;

    // `createExecutorSync` does not run `onInit`, and `@kysera/rls` refuses to
    // intercept without it — "Plugin used before initialization". Left to
    // itself that surfaces as a 500 on a user's first query against the table,
    // with a message about a factory function this code does not call. The
    // check belongs here, where the name of the fix is known.
    const uninitialized = plugins.filter((p) => !isTablePluginInitialized(p, this.db as object));
    if (uninitialized.length > 0) {
      throw new Error(
        `[TransactionAwareRepository] table "${String(this.tableName)}" has plugins that were never initialized: ` +
          `${uninitialized.map((p) => p.name).join(', ')}. ` +
          'Call `await initializeTablePlugins(connection)` from the app bootstrap after registerTablePlugins(...).',
      );
    }

    if (
      this.tablePluginExecutor !== undefined &&
      this.tablePluginTarget === (target as unknown as object) &&
      this.tablePluginList === plugins
    ) {
      return this.tablePluginExecutor;
    }

    const built = createExecutorSync(target as Kysely<DB>, plugins) as unknown as Executor<DB>;
    this.tablePluginTarget = target as unknown as object;
    this.tablePluginList = plugins;
    this.tablePluginExecutor = built;
    return built;
  }

  /** Whether the injected db is a kysera executor carrying the named plugin. */
  protected hasExecutorPlugin(pluginName: string): boolean {
    return isKyseraExecutor(this.db) && getPlugins(this.db).some((p) => p.name === pluginName);
  }

  /**
   * Resolved timestamp columns, or null when this repository has not opted
   * in. `@Timestamps()` decorator config wins over the class-field defaults;
   * the decorator (or the flag) alone is sufficient — injection does not
   * depend on any executor plugin, so it works on a raw Kysely too.
   */
  protected timestampsColumns(): { createdAt: string; updatedAt: string } | null {
    const decoratorConfig = getTimestampsConfig(
      this.constructor as Parameters<typeof getTimestampsConfig>[0]
    ) as { createdAt?: string; updatedAt?: string } | undefined;
    if (decoratorConfig) {
      return {
        createdAt: decoratorConfig.createdAt ?? this.createdAtColumn,
        updatedAt: decoratorConfig.updatedAt ?? this.updatedAtColumn,
      };
    }
    if (this.hasTimestamps) {
      return { createdAt: this.createdAtColumn, updatedAt: this.updatedAtColumn };
    }
    return null;
  }

  protected get softDeletePluginActive(): boolean {
    return this.hasExecutorPlugin('@kysera/soft-delete');
  }

  /**
   * Executor for statements that must SEE soft-deleted rows (restore, hard
   * delete, includeSoftDeleted reads): scopes the soft-delete plugin's
   * `includeDeleted` opt-out to this statement. A no-op passthrough when the
   * resolved executor is a plain Kysely/Transaction.
   */
  protected get executorIncludingDeleted(): Executor<DB> {
    return withPluginMetadata(this.executor as Kysely<DB>, { includeDeleted: true }) as Executor<DB>;
  }

  protected get dynamicExecutorIncludingDeleted(): DynamicQueryBuilder {
    return this.executorIncludingDeleted as unknown as DynamicQueryBuilder;
  }

  /** Inject created/updated timestamps for repositories that opted in. */
  private applyTimestamps<T>(data: T, mode: 'create' | 'update'): T {
    const columns = this.timestampsColumns();
    if (!columns) return data;
    const record = { ...(data as Record<string, unknown>) };
    const now = formatTimestampForDb(new Date(), detectDialect(this.db) as Dialect);
    if (mode === 'create' && record[columns.createdAt] === undefined) {
      record[columns.createdAt] = now;
    }
    if (record[columns.updatedAt] === undefined) {
      record[columns.updatedAt] = now;
    }
    return record as T;
  }

  // ===========================================================================
  // QUERY HELPERS
  // ===========================================================================

  protected async findOneBy<K extends string>(
    field: K,
    value: unknown
  ): Promise<Selectable<DB[Table & keyof DB]> | null> {
    type QR = {
      selectAll(): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where(field, '=', value)
      .executeTakeFirst();

    return result ?? null;
  }

  protected async findManyBy<K extends string>(
    field: K,
    value: unknown,
    options?: FindManyOptions
  ): Promise<Selectable<DB[Table & keyof DB]>[]> {
    type QR = {
      selectAll(): QR;
      where(field: string, op: string, value: unknown): QR;
      orderBy(column: string, direction: 'asc' | 'desc'): QR;
      limit(n: number): QR;
      offset(n: number): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR).selectAll().where(field, '=', value);
    if (options?.orderBy) query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    if (options?.limit !== undefined) query = query.limit(options.limit);
    if (options?.offset !== undefined) query = query.offset(options.offset);
    return await query.execute();
  }

  protected async findAll(options?: FindManyOptions): Promise<Selectable<DB[Table & keyof DB]>[]> {
    type QR = {
      selectAll(): QR;
      orderBy(column: string, direction: 'asc' | 'desc'): QR;
      limit(n: number): QR;
      offset(n: number): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR).selectAll();
    if (options?.orderBy) query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    if (options?.limit !== undefined) query = query.limit(options.limit);
    if (options?.offset !== undefined) query = query.offset(options.offset);
    return await query.execute();
  }

  protected async countBy<K extends string>(field: K, value: unknown): Promise<number> {
    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type QR = {
      select(fn: (eb: CEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<CountResult | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: CEB) => eb.fn.count('id').as('count'))
      .where(field, '=', value)
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  protected async existsBy<K extends string>(field: K, value: unknown): Promise<boolean> {
    type LEB = { lit<V>(value: V): { as(alias: string): unknown } };
    type QR = {
      select(fn: (eb: LEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      limit(n: number): QR;
      executeTakeFirst(): Promise<unknown | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: LEB) => eb.lit(1).as('exists'))
      .where(field, '=', value)
      .limit(1)
      .executeTakeFirst();

    return result !== undefined;
  }

  // ===========================================================================
  // STANDARD CRUD
  // ===========================================================================

  async findById(id: string): Promise<Selectable<DB[Table & keyof DB]> | null> {
    return this.findOneBy('id', id);
  }

  async findByIds(ids: string[]): Promise<Selectable<DB[Table & keyof DB]>[]> {
    if (ids.length === 0) return [];

    type QR = {
      selectAll(): QR;
      where(field: string, op: string, values: string[]): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    return (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where('id', 'in', ids)
      .execute();
  }

  async create(data: Insertable<DB[Table & keyof DB]>): Promise<Selectable<DB[Table & keyof DB]>> {
    type QR = {
      values(data: unknown): QR;
      returningAll(): QR;
      executeTakeFirstOrThrow(): Promise<Selectable<DB[Table & keyof DB]>>;
    };

    return (this.dynamicExecutor.insertInto(this.tableName) as QR)
      .values(this.applyTimestamps(data, 'create'))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async createMany(data: Insertable<DB[Table & keyof DB]>[]): Promise<Selectable<DB[Table & keyof DB]>[]> {
    if (data.length === 0) return [];

    type QR = {
      values(data: unknown[]): QR;
      returningAll(): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    return (this.dynamicExecutor.insertInto(this.tableName) as QR)
      .values(data.map((row) => this.applyTimestamps(row, 'create')))
      .returningAll()
      .execute();
  }

  async update(id: string, data: Updateable<DB[Table & keyof DB]>): Promise<Selectable<DB[Table & keyof DB]> | null> {
    type QR = {
      set(data: unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      returningAll(): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set(this.applyTimestamps(data, 'update'))
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  async delete(id: string): Promise<boolean> {
    type QR = {
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<{ numDeletedRows: bigint } | undefined>;
    };

    // Hard delete means DELETE even for soft-deleted rows — scope the
    // soft-delete plugin's mutation narrowing out of this statement.
    const result = await (this.dynamicExecutorIncludingDeleted.deleteFrom(this.tableName) as QR)
      .where('id', '=', id)
      .executeTakeFirst();

    return (result?.numDeletedRows ?? 0n) > 0n;
  }

  // ===========================================================================
  // SOFT DELETE
  // ===========================================================================

  async softDelete(id: string): Promise<boolean> {
    if (!this.hasSoftDelete) {
      throw new SoftDeleteError(
        `softDelete() called on table "${this.tableName}" which does not support soft delete`,
        `Table "${this.tableName}" has hasSoftDelete=false`
      );
    }

    type QR = {
      set(data: unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<{ numUpdatedRows: bigint } | undefined>;
    };

    const dialect = detectDialect(this.db) as Dialect;
    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set({ [this.softDeleteColumn]: formatTimestampForDb(new Date(), dialect) })
      .where('id', '=', id)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) > 0n;
  }

  async restore(id: string): Promise<Selectable<DB[Table & keyof DB]> | null> {
    if (!this.hasSoftDelete) {
      throw new SoftDeleteError(
        `restore() called on table "${this.tableName}" which does not support soft delete`,
        `Table "${this.tableName}" has hasSoftDelete=false`
      );
    }

    type QR = {
      set(data: unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      returningAll(): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    // The soft-delete plugin narrows UPDATEs to live rows — without the
    // includeDeleted opt-out this restore would never match its target.
    const result = await (this.dynamicExecutorIncludingDeleted.updateTable(this.tableName) as QR)
      .set({ [this.softDeleteColumn]: null })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    return result ?? null;
  }

  // ===========================================================================
  // LIST WITH PAGINATION
  // ===========================================================================

  async list(options: ListOptions = {}): Promise<OffsetPaginatedResult<Selectable<DB[Table & keyof DB]>>> {
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const orderBy = options.orderBy ?? 'createdAt';
    const direction = options.direction ?? 'desc';
    const includeSoftDeleted = options.includeSoftDeleted ?? false;

    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type CountQR = {
      select(fn: (eb: CEB) => unknown): CountQR;
      where(field: string, op: string, value: unknown): CountQR;
      executeTakeFirst(): Promise<{ count: string | number | bigint } | undefined>;
    };

    // includeSoftDeleted must also opt out of the soft-delete plugin's
    // filter; and when the plugin is active it owns the WHERE — adding the
    // native filter again would double it on every query.
    const qb = includeSoftDeleted ? this.dynamicExecutorIncludingDeleted : this.dynamicExecutor;
    const applyNativeSoftDeleteFilter =
      this.hasSoftDelete && !includeSoftDeleted && !this.softDeletePluginActive;

    const withTotal = options.withTotal ?? true;

    type SelectQR = {
      selectAll(): SelectQR;
      where(field: string, op: string, value: unknown): SelectQR;
      orderBy(column: string, direction: 'asc' | 'desc'): SelectQR;
      limit(n: number): SelectQR;
      offset(n: number): SelectQR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let dataQuery = (qb.selectFrom(this.tableName) as SelectQR).selectAll();
    if (applyNativeSoftDeleteFilter) {
      dataQuery = dataQuery.where(this.softDeleteColumn, 'is', null);
    }
    dataQuery = dataQuery.orderBy(orderBy, direction);

    if (!withTotal) {
      // COUNT skipped: fetch limit+1 to derive hasMore, report total = -1
      const probe = await dataQuery
        .limit(limit + 1)
        .offset(offset)
        .execute();
      const hasMore = probe.length > limit;
      return { data: probe.slice(0, limit), total: -1, limit, offset, hasMore };
    }

    let countQuery = (qb.selectFrom(this.tableName) as CountQR).select(
      (eb: CEB) => eb.fn.count('id').as('count')
    );
    if (applyNativeSoftDeleteFilter) {
      countQuery = countQuery.where(this.softDeleteColumn, 'is', null);
    }
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count ?? 0);

    const data = await dataQuery.limit(limit).offset(offset).execute();

    return { data, total, limit, offset, hasMore: offset + data.length < total };
  }

  // ===========================================================================
  // EXISTS / COUNT
  // ===========================================================================

  async exists(id: string, includeSoftDeleted = false): Promise<boolean> {
    type LEB = { lit<V>(value: V): { as(alias: string): unknown } };
    type QR = {
      select(fn: (eb: LEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      limit(n: number): QR;
      executeTakeFirst(): Promise<unknown | undefined>;
    };

    const qb = includeSoftDeleted ? this.dynamicExecutorIncludingDeleted : this.dynamicExecutor;
    let query = (qb.selectFrom(this.tableName) as QR)
      .select((eb: LEB) => eb.lit(1).as('exists'))
      .where('id', '=', id);

    if (this.hasSoftDelete && !includeSoftDeleted && !this.softDeletePluginActive) {
      query = query.where(this.softDeleteColumn, 'is', null);
    }

    const result = await query.limit(1).executeTakeFirst();
    return result !== undefined;
  }

  async count(includeSoftDeleted = false): Promise<number> {
    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type QR = {
      select(fn: (eb: CEB) => unknown): QR;
      where(field: string, op: string, value: unknown): QR;
      executeTakeFirst(): Promise<{ count: string | number | bigint } | undefined>;
    };

    const qb = includeSoftDeleted ? this.dynamicExecutorIncludingDeleted : this.dynamicExecutor;
    let query = (qb.selectFrom(this.tableName) as QR).select((eb: CEB) =>
      eb.fn.count('id').as('count')
    );
    if (this.hasSoftDelete && !includeSoftDeleted && !this.softDeletePluginActive) {
      query = query.where(this.softDeleteColumn, 'is', null);
    }
    const result = await query.executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  // ===========================================================================
  // WHERE-CLAUSE QUERIES (using @kysera/repository applyWhereClause)
  // ===========================================================================

  async findWhere(
    where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>,
    options?: FindManyOptions
  ): Promise<Selectable<DB[Table & keyof DB]>[]> {
    type QR = {
      selectAll(): QR;
      where(fn: (eb: unknown) => unknown): QR;
      orderBy(column: string, direction: 'asc' | 'desc'): QR;
      limit(n: number): QR;
      offset(n: number): QR;
      execute(): Promise<Selectable<DB[Table & keyof DB]>[]>;
    };

    let query = (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>));

    if (options?.orderBy) query = query.orderBy(options.orderBy, options.direction ?? 'desc');
    if (options?.limit !== undefined) query = query.limit(options.limit);
    if (options?.offset !== undefined) query = query.offset(options.offset);
    return await query.execute();
  }

  async findOneWhere(
    where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>
  ): Promise<Selectable<DB[Table & keyof DB]> | null> {
    type QR = {
      selectAll(): QR;
      where(fn: (eb: unknown) => unknown): QR;
      limit(n: number): QR;
      executeTakeFirst(): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .selectAll()
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .limit(1)
      .executeTakeFirst();

    return result ?? null;
  }

  async countWhere(where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>): Promise<number> {
    type CEB = { fn: { count(column: string): { as(alias: string): unknown } } };
    type QR = {
      select(fn: (eb: CEB) => unknown): QR;
      where(fn: (eb: unknown) => unknown): QR;
      executeTakeFirst(): Promise<{ count: string | number | bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.selectFrom(this.tableName) as QR)
      .select((eb: CEB) => eb.fn.count('id').as('count'))
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .executeTakeFirst();

    return Number(result?.count ?? 0);
  }

  async deleteWhere(where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>): Promise<number> {
    type QR = {
      where(fn: (eb: unknown) => unknown): QR;
      executeTakeFirst(): Promise<{ numDeletedRows: bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.deleteFrom(this.tableName) as QR)
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .executeTakeFirst();

    return Number(result?.numDeletedRows ?? 0n);
  }

  async updateWhere(
    where: WhereClause<Selectable<DB[Table & keyof DB]>> | Record<string, unknown>,
    data: Updateable<DB[Table & keyof DB]>
  ): Promise<number> {
    type QR = {
      set(data: unknown): QR;
      where(fn: (eb: unknown) => unknown): QR;
      executeTakeFirst(): Promise<{ numUpdatedRows: bigint } | undefined>;
    };

    const result = await (this.dynamicExecutor.updateTable(this.tableName) as QR)
      .set(this.applyTimestamps(data, 'update'))
      .where((eb: unknown) => applyWhereClause(eb as never, where as Record<string, unknown>))
      .executeTakeFirst();

    return Number(result?.numUpdatedRows ?? 0n);
  }

  // ===========================================================================
  // UPSERT
  // ===========================================================================

  async upsert(
    data: Insertable<DB[Table & keyof DB]>,
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>> & { returning: true }
  ): Promise<Selectable<DB[Table & keyof DB]>>;
  async upsert(
    data: Insertable<DB[Table & keyof DB]>,
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>>
  ): Promise<Selectable<DB[Table & keyof DB]> | undefined>;
  async upsert(
    data: Insertable<DB[Table & keyof DB]>,
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>>
  ): Promise<Selectable<DB[Table & keyof DB]> | undefined> {
    return kyseraUpsert(this.executor as never, this.tableName as never, data as never, options as never) as Promise<
      Selectable<DB[Table & keyof DB]> | undefined
    >;
  }

  async upsertMany(
    data: Insertable<DB[Table & keyof DB]>[],
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>> & { returning: true }
  ): Promise<Selectable<DB[Table & keyof DB]>[]>;
  async upsertMany(
    data: Insertable<DB[Table & keyof DB]>[],
    options: Omit<UpsertOptions<Insertable<DB[Table & keyof DB]>>, 'returning'>
  ): Promise<void>;
  async upsertMany(
    data: Insertable<DB[Table & keyof DB]>[],
    options: UpsertOptions<Insertable<DB[Table & keyof DB]>>
  ): Promise<Selectable<DB[Table & keyof DB]>[] | void> {
    return kyseraUpsertMany(
      this.executor as never,
      this.tableName as never,
      data as never,
      options as never
    ) as Promise<Selectable<DB[Table & keyof DB]>[] | void>;
  }

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  parseError(error: unknown, dialect: 'postgres' | 'mysql' | 'sqlite' | 'mssql' = 'postgres'): KyseraDatabaseError {
    return parseDatabaseError(error, dialect);
  }
}
