import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { MetricSample, PostgresMetricsStorage } from '@omnitron-dev/titan-metrics';
import { createMigrationHistory, createMigrationRunner } from '../migration/index.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { HistoryCoverage } from '../shared/dto/project.js';
import { replicatedMetric } from './replication-reconciliation.js';

export interface HistoryEntry {
  id: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Logs are a multiset at the precision retained by the old SQLite writer. */
  count?: number;
}
export interface HistoryManifest {
  id: string;
  nodeId: string;
  category: 'metrics' | 'logs';
  sourceDigest: string;
  expectedRows: number;
  expectedPages: number;
  firstAt: string;
  lastAt: string;
  /** The final hash chain over all ordered pages; not an arbitrary success flag. */
  rootDigest: string;
  gaps: Array<{ reason: string; from: string | null; to: string | null; rows: number | null }>;
}
export interface HistoryPage {
  index: number;
  previousDigest: string;
  entries: HistoryEntry[];
}
interface HistoryDatabase {
  sync_history_sources: { id: string; nodeId: string; manifest: string; processedPages: number; processedRows: number;
    presentRows: number; restoredRows: number; expiredRows: number; chainDigest: string; verifiedAt: string | null };
  sync_history_pages: { sourceId: string; page: number; digest: string; rows: number; presentRows: number;
    restoredRows: number; expiredRows: number; committedAt: string };
}
const preparing = new WeakMap<Kysely<unknown>, Promise<void>>();
export const HISTORY_PAGE_SIZE = 2048;
export const HISTORY_EMPTY_DIGEST = '0'.repeat(64);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Canonical JSON handles nested metadata and preserves arrays and multiplicity. */
export function historyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(historyJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${historyJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function historyPageDigest(page: HistoryPage): string { return hash(historyJson(page)); }

export function historicalLog(payload: Record<string, unknown>) {
  const timestamp = new Date(String(payload['timestamp'])).toISOString();
  return { timestamp, app: payload['app'] ?? 'unknown', level: payload['level'] ?? 'info',
    message: payload['message'] ?? '', labels: payload['labels'] ?? {},
    traceId: payload['traceId'] ?? null, spanId: payload['spanId'] ?? null, metadata: payload['metadata'] ?? null };
}
export function historyLogKey(payload: Record<string, unknown>): string { return hash(historyJson(historicalLog(payload))); }

async function prepareHistoryStore(db: Kysely<unknown>): Promise<void> {
  let work = preparing.get(db);
  if (!work) {
    work = createMigrationRunner(db, [{ name: '001_retained_history', async up(connection) {
      await connection.schema.createTable('sync_history_sources')
        .addColumn('id', 'text', c => c.primaryKey()).addColumn('nodeId', 'text', c => c.notNull())
        .addColumn('manifest', 'text', c => c.notNull())
        .addColumn('processedPages', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('processedRows', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('presentRows', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('restoredRows', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('expiredRows', 'integer', c => c.notNull().defaultTo(0))
        .addColumn('chainDigest', 'text', c => c.notNull()).addColumn('verifiedAt', 'text').execute();
      await connection.schema.createTable('sync_history_pages')
        .addColumn('sourceId', 'text', c => c.notNull().references('sync_history_sources.id'))
        .addColumn('page', 'integer', c => c.notNull()).addColumn('digest', 'text', c => c.notNull())
        .addColumn('rows', 'integer', c => c.notNull()).addColumn('presentRows', 'integer', c => c.notNull())
        .addColumn('restoredRows', 'integer', c => c.notNull()).addColumn('expiredRows', 'integer', c => c.notNull()).addColumn('committedAt', 'text', c => c.notNull())
        .addPrimaryKeyConstraint('sync_history_pages_pk', ['sourceId', 'page']).execute();
    } }], { verbose: false, lockTimeoutMs: 5000, advisoryLockKey: 'omnitron:retained-history',
      history: createMigrationHistory({ tableName: 'sync_history_migrations', checksumColumn: 'checksum' }),
    }).up().then(() => {}).catch(error => { preparing.delete(db); throw error; });
    preparing.set(db, work);
  }
  await work;
}

export async function historyCoverage(db: Kysely<unknown>): Promise<Array<HistoryCoverage & { nodeId: string }>> {
  let rows: HistoryDatabase['sync_history_sources'][];
  try { rows = await (db as Kysely<HistoryDatabase>).selectFrom('sync_history_sources').selectAll().execute(); }
  catch (error) { if (/no such table: sync_history_sources|relation ["']?sync_history_sources["']? does not exist/i.test(String(error))) return []; throw error; }
  return rows.map(row => {
    const manifest = JSON.parse(row.manifest) as HistoryManifest;
    return { sourceId: row.id, nodeId: row.nodeId, category: manifest.category, expectedRows: manifest.expectedRows,
      processedRows: row.processedRows, presentRows: row.presentRows, restoredRows: row.restoredRows, expiredRows: row.expiredRows,
      firstAt: manifest.firstAt, lastAt: manifest.lastAt, verifiedAt: row.verifiedAt, gaps: manifest.gaps,
      precision: manifest.category === 'logs' ? 'millisecond' : 'original',
      status: row.verifiedAt ? 'verified' : 'partial' };
  });
}

function validate(manifest: HistoryManifest, page: HistoryPage): void {
  const digest = /^[a-f0-9]{64}$/;
  if (!manifest || !digest.test(manifest.id) || !digest.test(manifest.sourceDigest) || !digest.test(manifest.rootDigest)
    || !/^[a-f0-9-]{36}$/.test(manifest.nodeId) || !['metrics', 'logs'].includes(manifest.category)
    || !Number.isSafeInteger(manifest.expectedRows) || manifest.expectedRows < 1
    || !Number.isSafeInteger(manifest.expectedPages) || manifest.expectedPages < 1
    || !Number.isFinite(Date.parse(manifest.firstAt)) || !Number.isFinite(Date.parse(manifest.lastAt))
    || Date.parse(manifest.firstAt) > Date.parse(manifest.lastAt)
    || !Array.isArray(manifest.gaps) || manifest.gaps.length > 100 || Buffer.byteLength(historyJson(manifest)) > 65536
    || !page || !Number.isSafeInteger(page.index) || page.index < 0 || page.index >= manifest.expectedPages
    || !digest.test(page.previousDigest) || !Array.isArray(page.entries) || !page.entries.length
    || page.entries.length > HISTORY_PAGE_SIZE || Buffer.byteLength(historyJson(page)) > 4 * 1024 * 1024) throw new Error('Invalid historical source manifest or bounded page');
  let count = 0;
  const ids = new Set<string>();
  for (const entry of page.entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id.length || entry.id.length > 128 || ids.has(entry.id)
      || !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload)
      || !Number.isSafeInteger(entry.count ?? 1) || (entry.count ?? 1) < 1
      || (manifest.category === 'metrics' && (!/^[1-9]\d{0,18}$/.test(entry.id) || (entry.count ?? 1) !== 1))) throw new Error('Invalid or repeated historical identity');
    count += entry.count ?? 1; ids.add(entry.id);
    const at = manifest.category === 'metrics' ? replicatedMetric(manifest.nodeId, { ...entry, category: 'metrics' }).timestamp
      : Date.parse(historicalLog(entry.payload).timestamp);
    if (at < Date.parse(manifest.firstAt) || at > Date.parse(manifest.lastAt)) throw new Error('Historical row exceeds the source time range');
    if (manifest.category === 'logs' && entry.id !== historyLogKey(entry.payload)) throw new Error('Historical log fingerprint mismatch');
  }
  if (count > 8192) throw new Error('Historical page exceeds its row budget');
}

/**
 * A maintenance import, not a replacement delivery receipt. Snapshots stay on
 * the source host; only bounded pages cross the authenticated transport. The
 * immutable page proof and payload COMMIT together. No live gauges, source
 * counters, old claims or application processes are changed.
 */
export async function reconcileHistoryPage(db: Kysely<OmnitronDatabase>, storage: PostgresMetricsStorage<OmnitronDatabase>,
  manifest: HistoryManifest, page: HistoryPage, options: { restore: boolean; metricsMaxAgeMs?: number; logsMaxAgeMs?: number },
): Promise<{ present: number; missing: number; expired: number; replay: boolean; digest: string }> {
  validate(manifest, page);
  const digest = historyPageDigest(page), serialized = historyJson(manifest);
  const prepared = manifest.category === 'metrics' ? page.entries.map(entry => replicatedMetric(manifest.nodeId, { ...entry, category: 'metrics' })) : [];
  const maxAge = options.metricsMaxAgeMs ?? 7 * 86400_000;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1) throw new Error('Invalid metrics history horizon');
  if (options.restore && prepared.some(s => s.timestamp < Date.now() - maxAge || s.timestamp > Date.now() + 60000)) throw new Error('Metric history lies outside the configured retention horizon');
  if (options.restore) await prepareHistoryStore(db as Kysely<unknown>);
  return db.transaction().execute(async trx => {
    if (options.restore) {
      await storage.writeInTransaction(trx, []);
      const durability = (await sql<{ durable: boolean }>`SELECT bool_and(relpersistence='p') durable FROM pg_class
        WHERE oid IN ('sync_history_sources'::regclass,'sync_history_pages'::regclass,
          ${manifest.category === 'logs' ? 'logs' : 'metrics_samples'}::regclass)`.execute(trx)).rows[0];
      if (durability?.durable !== true) throw new Error('Historical payloads and proofs require logged PostgreSQL tables');
    }
    else await sql`SET LOCAL statement_timeout = '10s'`.execute(trx);
    await sql`SET LOCAL lock_timeout = '2s'`.execute(trx);
    const journal = trx as unknown as Kysely<HistoryDatabase>;
    let source: HistoryDatabase['sync_history_sources'] | undefined;
    if (options.restore) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`history:${manifest.nodeId}:${manifest.category}`},0))`.execute(trx);
      await journal.insertInto('sync_history_sources').values({ id: manifest.id, nodeId: manifest.nodeId, manifest: serialized,
        processedPages: 0, processedRows: 0, presentRows: 0, restoredRows: 0, expiredRows: 0, chainDigest: HISTORY_EMPTY_DIGEST, verifiedAt: null })
        .onConflict(oc => oc.column('id').doNothing()).execute();
      source = await journal.selectFrom('sync_history_sources').selectAll().where('id', '=', manifest.id).executeTakeFirstOrThrow();
      if (source.manifest !== serialized) throw new Error('Historical source identity conflicts with its immutable manifest');
      const prior = await journal.selectFrom('sync_history_pages').selectAll().where('sourceId', '=', manifest.id).where('page', '=', page.index).executeTakeFirst();
      if (prior) {
        if (prior.digest !== digest) throw new Error('Historical page conflicts with its committed proof');
        return { present: prior.presentRows, missing: prior.restoredRows, expired: prior.expiredRows, replay: true, digest };
      }
      if (source.processedPages !== page.index || source.chainDigest !== page.previousDigest) throw new Error('Historical page is out of order or has a broken hash chain');
    }
    let present = 0, missing = 0, expired = 0;
    if (manifest.category === 'metrics') {
      // Query by stable identity AND original content. Resampled old gauges
      // are not a match for the original timestamp/value/labels.
      const matches = (await sql<{ key: string; id: string; identity: string; name: string; value: number; timestamp: string; labels: Record<string, string> }>`
        WITH wanted AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(prepared)}::jsonb)
          AS w(id text,name text,value double precision,timestamp bigint,labels jsonb))
        SELECT w.id key, m.id, CASE WHEN m.id=w.id THEN 'stable' ELSE 'content' END identity,m.name,m.value,m.timestamp,m.labels
        FROM wanted w JOIN LATERAL (SELECT * FROM metrics_samples s WHERE s.id=w.id OR
          (s.name=w.name AND s.app=w.labels->>'app' AND s.timestamp=w.timestamp AND s.value=w.value AND s.labels=w.labels)
          ORDER BY (s.id=w.id) DESC LIMIT 1) m ON true`.execute(trx)).rows;
      const byId = new Map(matches.map(m => [m.key, m]));
      const additions: MetricSample[] = [];
      for (const sample of prepared) {
        const old = byId.get(sample.id);
        if (old && (old.name !== sample.name || old.value !== sample.value || Number(old.timestamp) !== sample.timestamp
          || historyJson(old.labels) !== historyJson(sample.labels))) throw new Error('Historical metric identity conflicts with stored data');
        if (old) present++; else additions.push(sample);
      }
      missing = additions.length;
      if (options.restore && additions.length) await storage.writeInTransaction(trx, additions);
    } else {
      const wanted = page.entries.map(entry => ({ key: entry.id, count: entry.count ?? 1, ...historicalLog(entry.payload) }));
      const matches = (await sql<{ key: string; n: number }>`WITH wanted AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(wanted)}::jsonb)
        AS w(key text,timestamp timestamptz,app text,level text,message text,labels jsonb,"traceId" text,"spanId" text,metadata jsonb)
      ) SELECT w.key, m.n FROM wanted w CROSS JOIN LATERAL (
        SELECT count(*)::int n FROM logs l WHERE l."nodeId"=${manifest.nodeId}::uuid
          AND l.timestamp>=w.timestamp AND l.timestamp<w.timestamp+interval '1 millisecond'
          AND l.app=w.app AND l.level=w.level AND l.message=w.message
          AND coalesce(l.labels,'{}'::jsonb)=w.labels AND l."traceId" IS NOT DISTINCT FROM w."traceId"
          AND l."spanId" IS NOT DISTINCT FROM w."spanId" AND l.metadata IS NOT DISTINCT FROM w.metadata
      ) m`.execute(trx)).rows;
      const counts = new Map(matches.map(m => [m.key, m.n]));
      const additions = [];
      for (const row of wanted) {
        const kept = Math.min(row.count, counts.get(row.key) ?? 0); present += kept;
        // Retention is an intentional boundary. Preserve expired records in
        // their audited source archives, not in a live table that prunes them.
        const logMaxAge = options.logsMaxAgeMs ?? 14 * 86400_000;
        if (!Number.isSafeInteger(logMaxAge) || logMaxAge < 1) throw new Error('Invalid logs history horizon');
        if (Date.parse(row.timestamp) < Date.now() - logMaxAge) { expired += row.count - kept; continue; }
        missing += row.count - kept;
        for (let i = kept; i < row.count; i++) {
          const hex = hash(historyJson([manifest.nodeId, row.key, i]));
          const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
          additions.push({ id, timestamp: row.timestamp, nodeId: manifest.nodeId, app: String(row.app), level: String(row.level),
            message: String(row.message), labels: JSON.stringify(row.labels), traceId: row.traceId as string | null,
            spanId: row.spanId as string | null, metadata: row.metadata === null ? null : JSON.stringify(row.metadata) });
        }
      }
      if (options.restore) for (let at = 0; at < additions.length; at += 500) await trx.insertInto('logs').values(additions.slice(at, at + 500)).execute();
    }
    if (options.restore) {
      const rows = present + missing + expired, total = source!.processedRows + rows, complete = page.index + 1 === manifest.expectedPages;
      if (total > manifest.expectedRows || (complete && (total !== manifest.expectedRows || digest !== manifest.rootDigest))) throw new Error('Historical source row count or final hash does not match its manifest');
      const at = new Date().toISOString();
      await journal.insertInto('sync_history_pages').values({ sourceId: manifest.id, page: page.index, digest, rows,
        presentRows: present, restoredRows: missing, expiredRows: expired, committedAt: at }).execute();
      await journal.updateTable('sync_history_sources').set({ processedPages: page.index + 1, processedRows: total,
        presentRows: source!.presentRows + present, restoredRows: source!.restoredRows + missing, expiredRows: source!.expiredRows + expired,
        chainDigest: digest, verifiedAt: complete ? at : null }).where('id', '=', manifest.id).execute();
    }
    return { present, missing, expired, replay: false, digest };
  });
}
