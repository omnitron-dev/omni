import { createHash, randomUUID } from 'node:crypto';
import type { Kysely, Transaction } from 'kysely';
import type {
  IMetricsLatestOptions, IMetricsStorage, MetricSample, MetricsQueryFilter,
  MetricsSnapshot, MetricsStorageCapabilities, MetricsTimeSeries,
} from './types.js';
import { buildSnapshot, normaliseAppScope, parseIntervalMs } from './storage.js';

/** Owned by Titan; consumers register this DDL with their migration runner. */
export const METRICS_POSTGRES_SCHEMA_V1 = [
  `CREATE TABLE metrics_samples (
    id text PRIMARY KEY, timestamp bigint NOT NULL, app text NOT NULL,
    name text NOT NULL, value double precision NOT NULL,
    labels jsonb NOT NULL, series text NOT NULL
  )`,
  'CREATE INDEX metrics_samples_time ON metrics_samples (timestamp)',
  'CREATE INDEX metrics_samples_series_time ON metrics_samples (name, app, series, timestamp DESC)',
  'CREATE INDEX metrics_samples_app_time ON metrics_samples (app, timestamp DESC)',
  'CREATE INDEX metrics_samples_labels ON metrics_samples USING GIN (labels jsonb_path_ops)',
] as const;

export const METRICS_SQLITE_SCHEMA_V1 = [
  `CREATE TABLE IF NOT EXISTS metrics_samples (
    id text PRIMARY KEY, timestamp integer NOT NULL, app text NOT NULL,
    name text NOT NULL, value real NOT NULL, labels text NOT NULL, series text NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS metrics_samples_time ON metrics_samples (timestamp)',
  'CREATE INDEX IF NOT EXISTS metrics_samples_series_time ON metrics_samples (name, app, series, timestamp DESC)',
  'CREATE INDEX IF NOT EXISTS metrics_samples_app_time ON metrics_samples (app, timestamp DESC)',
] as const;

export interface MetricsDatabase {
  metrics_samples: {
    id: string;
    timestamp: number | string;
    app: string;
    name: string;
    value: number;
    labels: string;
    series: string;
  };
}

export interface SqlMetricsStorageOptions {
  /** Optional transactional outbox. Failure rolls back samples AND the outbox together. */
  afterWrite?: (transaction: Transaction<MetricsDatabase>, samples: MetricSample[]) => Promise<void>;
  /** Rows per INSERT (default: 500); a write's chunks commit atomically. */
  batchSize?: number;
  /** SQLite only: run Titan's idempotent DDL (default: true). */
  initializeSchema?: boolean;
  /** Per-query result budget. Excess results fail with a narrowing instruction. */
  maxQueryPoints?: number;
  /** Maximum series per query (default: 1024, maximum: 4096). */
  maxQuerySeries?: number;
  /** PostgreSQL statement timeout, including retention (default: 10000ms). */
  statementTimeoutMs?: number;
}

/** Assign once, before retrying a possibly committed write. Never mutate caller labels. */
export function prepareMetricSample(sample: MetricSample): MetricSample & { id: string } {
  if (!sample || typeof sample.name !== 'string' || sample.name.length === 0 || sample.name.length > 512
    || !Number.isFinite(sample.value) || !Number.isSafeInteger(sample.timestamp) || sample.timestamp < 0
    || !sample.labels || Array.isArray(sample.labels) || typeof sample.labels !== 'object'
    || Object.keys(sample.labels).length > 64
    || Object.entries(sample.labels).some(([key, value]) => key.length > 256 || typeof value !== 'string' || value.length > 4096)
    || Buffer.byteLength(JSON.stringify(sample.labels)) > 8192
    || (sample.id !== undefined && (typeof sample.id !== 'string' || sample.id.length === 0 || sample.id.length > 512))) {
    throw new TypeError('Invalid metric sample: require a name, finite value, epoch milliseconds and bounded string labels');
  }
  const normalized = normaliseAppScope(sample);
  return { ...normalized, id: sample.id ?? randomUUID(), labels: Object.fromEntries(Object.entries(normalized.labels).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) };
}

function epoch(value: string | number | undefined, fallback: number): number {
  const ms = value === undefined ? fallback : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms < 0) throw new TypeError('Metric query time must be epoch milliseconds or an ISO date');
  return ms;
}

type StoredPoint = { name: string; app: string; labels: string | Record<string, string>; timestamp: string | number; value: number };
type StoredSeries = Pick<StoredPoint, 'name' | 'app' | 'labels'> & { points: string | Array<{ timestamp: number | string; value: number }> };
function labelsOf(row: Pick<StoredPoint, 'labels'>): Record<string, string> {
  return typeof row.labels === 'string' ? JSON.parse(row.labels) as Record<string, string> : row.labels;
}

/** No timers and no buffer: write completion is the database transaction boundary. */
class SqlMetricsStorage<DB extends MetricsDatabase> implements IMetricsStorage {
  readonly capabilities: MetricsStorageCapabilities;
  private readonly batchSize: number;
  private readonly maxQueryPoints: number;
  private readonly maxQuerySeries: number;
  private readonly statementTimeoutMs: number;
  private initializing: Promise<void> | null = null;
  private initialized = false;
  // Restrict queries to Titan's table even when the connection exposes an application schema.
  protected readonly db: Kysely<MetricsDatabase>;

  constructor(db: Kysely<DB>, private readonly dialect: 'postgres' | 'sqlite', private readonly options: SqlMetricsStorageOptions = {}) {
    this.db = db as unknown as Kysely<MetricsDatabase>;
    this.capabilities = { type: dialect, durability: dialect === 'postgres' ? 'persistent' : 'unknown' };
    this.batchSize = options.batchSize ?? 500;
    this.maxQueryPoints = options.maxQueryPoints ?? 100_000;
    this.maxQuerySeries = options.maxQuerySeries ?? 1024;
    this.statementTimeoutMs = options.statementTimeoutMs ?? 10_000;
    for (const [key, value, maximum] of [
      ['batchSize', this.batchSize, 4000], ['maxQueryPoints', this.maxQueryPoints, 100_000],
      ['maxQuerySeries', this.maxQuerySeries, 4096],
      ['statementTimeoutMs', this.statementTimeoutMs, 60_000],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`Invalid metrics ${key}: 1..${maximum} required`);
    }
  }

  /** Verify the caller's journaling/sync policy without changing its connection. */
  async initialize(): Promise<void> {
    if (this.initialized || this.dialect === 'postgres') return;
    if (!this.initializing) this.initializing = this.initializeSqlite().finally(() => { this.initializing = null; });
    await this.initializing;
  }

  private async initializeSqlite(): Promise<void> {
    const { sql } = await import('kysely');
    const databases = await sql<{ name: string; file: string }>`PRAGMA database_list`.execute(this.db);
    const persistent = !!databases.rows.find(row => row.name === 'main')?.file;
    if (persistent) await this.assertSqliteDurability(this.db);
    if (this.options.initializeSchema !== false) {
      await this.db.transaction().execute(async trx => {
        for (const statement of METRICS_SQLITE_SCHEMA_V1) await sql.raw(statement).execute(trx);
      });
    }
    this.capabilities.durability = persistent ? 'persistent' : 'volatile';
    this.initialized = true;
  }

  private async assertSqliteDurability(db: Kysely<MetricsDatabase>): Promise<void> {
    const { sql } = await import('kysely');
    const sync = Number((await sql<{ synchronous: number }>`PRAGMA synchronous`.execute(db)).rows[0]?.synchronous);
    const mode = (await sql<{ journal_mode: string }>`PRAGMA journal_mode`.execute(db)).rows[0]?.journal_mode;
    // FULL does not promise power-loss durability with a rollback journal.
    // See https://sqlite.org/pragma.html#pragma_synchronous.
    if (!mode || !['wal', 'delete', 'truncate', 'persist'].includes(mode)) {
      throw new Error('Persistent metrics require SQLite WAL or a disk rollback journal; OFF/MEMORY cannot confirm durability');
    }
    if (!Number.isInteger(sync) || sync > 3 || sync < (mode === 'wal' ? 2 : 3)) {
      throw new Error(mode === 'wal'
        ? 'Persistent metrics require SQLite synchronous=FULL or EXTRA in WAL mode'
        : 'Persistent metrics require SQLite synchronous=EXTRA with a rollback journal (or WAL with FULL)');
    }
  }

  async write(samples: MetricSample[]): Promise<void> {
    // Assign identities outside the transaction so internal chunking never changes them.
    const prepared = samples.map(prepareMetricSample);
    await this.initialize();
    await this.db.transaction().execute(trx => this.writeInTransaction(trx, prepared));
  }

  /** Participates in the caller's transaction. ONLY its successful outer commit proves persistence. */
  async writeInTransaction(trx: Transaction<MetricsDatabase> | Transaction<DB>, samples: MetricSample[]): Promise<void> {
    if (!trx.isTransaction) throw new TypeError('Metric writeInTransaction requires an active database transaction');
    if (this.dialect === 'sqlite' && !this.initialized) throw new Error('Initialize SQLite metrics before joining a transaction');
    const executor = trx as unknown as Transaction<MetricsDatabase>;
    const { sql } = await import('kysely');
    if (this.dialect === 'postgres') {
      // Override a relaxed session setting for the whole transaction, including the caller's receipt.
      const durability = await sql<{ fsync: string; full_pages: string; persistence: string }>`SELECT
        set_config('synchronous_commit', 'on', true),
        set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true),
        current_setting('fsync') AS fsync, current_setting('full_page_writes') AS full_pages,
        (SELECT relpersistence FROM pg_class WHERE oid = 'metrics_samples'::regclass) AS persistence`.execute(executor);
      if (durability.rows[0]?.fsync !== 'on' || durability.rows[0]?.full_pages !== 'on' || durability.rows[0]?.persistence !== 'p') throw new Error('Durable metrics require PostgreSQL fsync=on, full_page_writes=on and a logged metrics_samples table');
    } else if (this.capabilities.durability === 'persistent') {
      await this.assertSqliteDurability(executor);
    }
    const prepared = samples.map(prepareMetricSample);
    const rows = prepared.map(sample => {
      const s = prepareMetricSample(sample);
      return { id: s.id, timestamp: s.timestamp, app: s.labels['app']!, name: s.name, value: s.value,
        labels: JSON.stringify(s.labels), series: createHash('sha256').update(JSON.stringify(s.labels)).digest('hex') };
    });
    const inserted = new Set<string>();
    for (let offset = 0; offset < rows.length; offset += this.batchSize) {
      const part = rows.slice(offset, offset + this.batchSize);
      const added = await executor.insertInto('metrics_samples').values(part)
        .onConflict(oc => oc.column('id').doNothing()).returning('id').execute();
      for (const row of added) inserted.add(row.id);
      // A stable ID may only replay the same immutable sample. Never certify
      // different data merely because its identifier already exists.
      if (added.length < part.length) {
        const existing = await executor.selectFrom('metrics_samples').selectAll().where('id', 'in', part.map(row => row.id)).execute();
        const byId = new Map(existing.map(row => [row.id, row]));
        for (const row of part) {
          const old = byId.get(row.id);
          if (!old || old.name !== row.name || old.app !== row.app || old.series !== row.series
            || Number(old.timestamp) !== row.timestamp || Number(old.value) !== row.value) {
            throw Object.assign(new Error('Metric identity conflicts with an existing sample'), { code: '22023' });
          }
        }
      }
    }
    if (this.options.afterWrite && inserted.size) {
      const once = prepared.filter(sample => inserted.delete(sample.id!));
      await this.options.afterWrite(executor, once);
    }
  }

  async query(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]> {
    await this.initialize();
    const { sql } = await import('kysely');
    const from = epoch(filter.from, Math.max(0, Date.now() - 86_400_000));
    const to = epoch(filter.to, Date.now());
    const limit = filter.limit ?? 120;
    if (from > to || !Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new RangeError('Metric query requires from <= to and 1..2000 points per series');
    if (filter.names?.length === 0 || filter.apps?.length === 0) return [];
    if ((filter.names?.length ?? 0) > 256 || (filter.apps?.length ?? 0) > 256 || Object.keys(filter.labels ?? {}).length > 64) throw new RangeError('Too many metric query filters');
    let query = this.db.selectFrom('metrics_samples').selectAll()
      .where('timestamp', '>=', from).where('timestamp', '<=', to);
    if (filter.names?.length) query = filter.names.length === 1 ? query.where('name', '=', filter.names[0]!) : query.where('name', 'in', filter.names);
    if (filter.apps?.length) query = filter.apps.length === 1 ? query.where('app', '=', filter.apps[0]!) : query.where('app', 'in', filter.apps);
    if (filter.labels) {
      if (Object.values(filter.labels).some(value => typeof value !== 'string')) throw new TypeError('Metric label filters require strings');
      if (this.dialect === 'postgres') query = query.where(sql<boolean>`labels @> ${JSON.stringify(filter.labels)}::jsonb`);
      else for (const [key, value] of Object.entries(filter.labels)) {
        // json_each avoids JSONPath parsing/escaping and keeps all user input bound.
        query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM json_each(metrics_samples.labels) WHERE key = ${key} AND value = ${value})`);
      }
    }
    let points = sql`SELECT name, app, series, labels, timestamp, value, id FROM filtered`;
    if (filter.interval) {
      if (!/^([1-9]\d*)(s|m|h|d)$/.test(filter.interval)) throw new TypeError('Invalid metric interval');
      const interval = parseIntervalMs(filter.interval);
      if (!Number.isSafeInteger(interval)) throw new RangeError('Metric interval is too large');
      const bucket = sql`CAST(timestamp / ${interval} AS BIGINT) * ${interval}`;
      points = sql`SELECT name, app, series, labels, bucket AS timestamp, MIN(id) AS id,
        CASE WHEN substr(name, length(name) - 5, 6) IN ('_total', '_count')
          THEN MAX(CASE WHEN bucket_rank = 1 THEN value END) ELSE AVG(value) END AS value
        FROM (SELECT *, ${bucket} AS bucket,
          ROW_NUMBER() OVER (PARTITION BY name, app, series, ${bucket} ORDER BY timestamp DESC, id DESC) AS bucket_rank
          FROM filtered) AS buckets GROUP BY name, app, series, labels, bucket`;
    }
    // Return labels once per series, not repeated on every sample. Otherwise
    // a bounded point count can still expand into hundreds of MB of labels.
    const aggregation = this.dialect === 'postgres'
      ? sql`json_agg(json_build_object('timestamp', timestamp, 'value', value) ORDER BY timestamp)`
      : sql`json_group_array(json_object('timestamp', timestamp, 'value', value) ORDER BY timestamp)`;
    const resultQuery = sql<StoredSeries>`WITH filtered AS ${query}, points AS (${points}),
      ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY name, app, series ORDER BY timestamp DESC, id DESC) AS point_rank FROM points),
      limited AS (SELECT * FROM ranked WHERE point_rank <= ${limit} ORDER BY timestamp ASC LIMIT ${this.maxQueryPoints + 1})
      SELECT name, app, labels, ${aggregation} AS points FROM limited GROUP BY name, app, series, labels`;
    const read = async (connection: Kysely<MetricsDatabase>) => {
      const identities = await connection.selectFrom(query.as('candidates')).select(['name', 'app', 'series']).distinct().limit(this.maxQuerySeries + 1).execute();
      if (identities.length > this.maxQuerySeries) throw new RangeError(`Metric query exceeds ${this.maxQuerySeries} series; narrow names, apps or labels`);
      return resultQuery.execute(connection);
    };
    const result = await this.withStatementTimeout(read);
    const series: MetricsTimeSeries[] = [];
    let pointCount = 0;
    for (const row of result.rows) {
      const labels = { ...labelsOf(row) };
      delete labels['app'];
      const values = typeof row.points === 'string' ? JSON.parse(row.points) as Exclude<StoredSeries['points'], string> : row.points;
      pointCount += values.length;
      if (pointCount > this.maxQueryPoints || series.length >= this.maxQuerySeries) throw new RangeError('Metric query exceeds its result budget; narrow names, apps, labels or time range');
      series.push({ name: row.name, app: row.app, labels,
        points: values.map(point => ({ timestamp: Number(point.timestamp), value: Number(point.value) })) });
    }
    return series;
  }

  async getLatest(apps?: string[], opts?: IMetricsLatestOptions): Promise<MetricsSnapshot> {
    const now = Date.now();
    const series = await this.query({ apps, from: Math.max(0, now - (opts?.staleAfterMs ?? 300_000)), to: now, limit: 1 });
    const appMap = new Map<string, Map<string, MetricSample>>();
    for (const group of series) {
      const point = group.points.at(-1)!;
      const app = appMap.get(group.app) ?? new Map<string, MetricSample>();
      if ((app.get(group.name)?.timestamp ?? -1) <= point.timestamp) app.set(group.name, { ...point, name: group.name, labels: { ...group.labels, app: group.app } });
      appMap.set(group.app, app);
    }
    return buildSnapshot(now, appMap);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new RangeError('Metrics retention must be positive milliseconds');
    await this.initialize();
    const cutoff = Date.now() - maxAgeMs;
    // Small transactions bound lock/WAL pressure. The next sweep resumes
    // after this pass's time budget instead of monopolizing the database.
    const until = Date.now() + 15_000;
    do {
      const removed = await this.withStatementTimeout(db => db.deleteFrom('metrics_samples').where('id', 'in',
        db.selectFrom('metrics_samples').select('id').where('timestamp', '<', cutoff).orderBy('timestamp').limit(10_000)).executeTakeFirst());
      if (Number(removed.numDeletedRows) < 10_000) break;
    } while (Date.now() < until);
  }

  async evictApp(app: string): Promise<void> {
    await this.initialize();
    await this.withStatementTimeout(db => db.deleteFrom('metrics_samples').where('app', '=', app).execute());
  }

  private async withStatementTimeout<T>(operation: (db: Kysely<MetricsDatabase>) => Promise<T>): Promise<T> {
    if (this.dialect !== 'postgres') return operation(this.db);
    const { sql } = await import('kysely');
    return this.db.transaction().execute(async trx => {
      await sql`SELECT set_config('statement_timeout', ${String(this.statementTimeoutMs)}, true)`.execute(trx);
      return operation(trx);
    });
  }

  /** No owned connection or background timer. The caller owns database shutdown. */
  dispose(): void {}
}

export class PostgresMetricsStorage<DB extends MetricsDatabase = MetricsDatabase> extends SqlMetricsStorage<DB> {
  constructor(db: Kysely<DB>, options?: SqlMetricsStorageOptions) { super(db, 'postgres', options); }
}

export class SQLiteMetricsStorage<DB extends MetricsDatabase = MetricsDatabase> extends SqlMetricsStorage<DB> {
  constructor(db: Kysely<DB>, options?: SqlMetricsStorageOptions) { super(db, 'sqlite', options); }
}
