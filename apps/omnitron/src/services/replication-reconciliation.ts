import { createHash, randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { prepareMetricSample, type MetricSample, type PostgresMetricsStorage } from '@omnitron-dev/titan-metrics';
import { createMigrationHistory, createMigrationRunner } from '../migration/index.js';
import { toIsoUtc } from '../database/sqlite-date-binding.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { SyncBatch } from './sync.service.js';

const PAGE_LIMIT = 256;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const EPOCH = /^[a-f0-9]{32}$/;
const SEQUENCE = /^[1-9]\d{0,18}$/;
const preparing = new WeakMap<Kysely<unknown>, Promise<void>>();

export interface ReconciliationPage {
  version: 1;
  nodeId: string;
  epoch: string;
  namespaceFrom: string;
  through: string;
  next: string | null;
  unverifiedRows: number;
  entries: SyncBatch['entries'];
}

export interface ReconciliationProof {
  nodeId: string;
  epoch: string;
  entryId: string;
  payloadHash: string;
  metricId: string;
  result: 'present' | 'restored';
  verifiedAt: string;
  receiptId: string;
  previousOutcome: string;
}

export interface ReconciliationSummary {
  verifiedRows: number;
  restoredRows: number;
  lastReconciledAt: string | null;
}

interface ReconciliationDatabase {
  sync_reconciliations: ReconciliationProof;
  sync_reconciliation_totals: ReconciliationSummary & { nodeId: string; epoch: string };
}

/** One identity and normalization path for live ingestion and historical repair. */
export function replicatedMetric(nodeId: string, entry: SyncBatch['entries'][number]): MetricSample & { id: string } {
  const labels = entry.payload['labels'] ?? {};
  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) throw new TypeError('Invalid metric labels');
  const timestamp = entry.payload['timestamp'] ?? toIsoUtc(entry.createdAt);
  return prepareMetricSample({
    id: `replicated:${createHash('sha256').update(JSON.stringify([nodeId, entry.id])).digest('hex')}`,
    name: entry.payload['name'] as string, value: entry.payload['value'] as number,
    timestamp: typeof timestamp === 'number' ? timestamp : Date.parse(String(timestamp)),
    labels: { ...labels as Record<string, string>,
      ...entry.payload['app'] !== undefined ? { app: entry.payload['app'] as string } : {}, node: nodeId },
  });
}

export function metricReceiptHash(epoch: string, sample: MetricSample): string {
  const s = prepareMetricSample(sample);
  return createHash('sha256').update(JSON.stringify([epoch, s.id, s.name, s.value, s.timestamp, s.labels])).digest('hex');
}

/**
 * An optional repair journal, migrated through Omnitron/Titan/Kysera. Its own
 * history lets a maintenance worker open a live older node without adding an
 * unknown migration to that node's core history or changing its running code.
 * Only explicit repair prepares this store; diagnostics remain read-only.
 */
export async function prepareReconciliationStore(db: Kysely<unknown>): Promise<void> {
  let pending = preparing.get(db);
  if (!pending) {
    pending = migrateStore(db).catch(error => { preparing.delete(db); throw error; });
    preparing.set(db, pending);
  }
  await pending;
}

async function migrateStore(db: Kysely<unknown>): Promise<void> {
  await createMigrationRunner(db, [{ name: '001_replication_reconciliation', async up(connection) {
    await connection.schema.createTable('sync_reconciliations')
      .addColumn('nodeId', 'text', c => c.notNull()).addColumn('epoch', 'text', c => c.notNull())
      .addColumn('entryId', 'text', c => c.notNull()).addColumn('payloadHash', 'text', c => c.notNull())
      .addColumn('metricId', 'text', c => c.notNull()).addColumn('result', 'text', c => c.notNull())
      .addColumn('verifiedAt', 'text', c => c.notNull()).addColumn('receiptId', 'text', c => c.notNull())
      .addColumn('previousOutcome', 'text', c => c.notNull())
      .addPrimaryKeyConstraint('sync_reconciliations_pk', ['nodeId', 'epoch', 'entryId'])
      .addUniqueConstraint('sync_reconciliations_receipt', ['receiptId'])
      .addUniqueConstraint('sync_reconciliations_sample', ['nodeId', 'epoch', 'metricId'])
      .addCheckConstraint('sync_reconciliations_result', sql`result in ('present', 'restored')`).execute();
    await connection.schema.createIndex('sync_reconciliations_entry').on('sync_reconciliations').columns(['nodeId', 'entryId']).execute();
    await connection.schema.createTable('sync_reconciliation_totals')
      .addColumn('nodeId', 'text', c => c.notNull()).addColumn('epoch', 'text', c => c.notNull())
      .addColumn('verifiedRows', 'integer', c => c.notNull().defaultTo(0))
      .addColumn('restoredRows', 'integer', c => c.notNull().defaultTo(0))
      .addColumn('lastReconciledAt', 'text')
      .addPrimaryKeyConstraint('sync_reconciliation_totals_pk', ['nodeId', 'epoch']).execute();
  } }], { verbose: false, lockTimeoutMs: 5000, advisoryLockKey: 'omnitron:replication-reconciliation',
    history: createMigrationHistory({ tableName: 'sync_reconciliation_migrations', checksumColumn: 'checksum' }),
  }).up();
}

function missingStore(error: unknown): boolean {
  return /no such table: sync_reconciliation|relation ["']?sync_reconciliation\w*["']? does not exist/i.test(String(error));
}

export async function reconciliationSummaries(db: Kysely<unknown>): Promise<Array<ReconciliationSummary & { nodeId: string; epoch: string }>> {
  try {
    return await (db as Kysely<ReconciliationDatabase>).selectFrom('sync_reconciliation_totals').selectAll().execute();
  } catch (error) { if (missingStore(error)) return []; throw error; }
}

/** A normal retry can use later proof, but only for the identical metric payload. */
export async function reconciledMetricIds(db: Kysely<unknown>, nodeId: string, entries: SyncBatch['entries']): Promise<string[]> {
  if (!entries.length) return [];
  let proofs: ReconciliationProof[];
  try {
    proofs = await (db as Kysely<ReconciliationDatabase>).selectFrom('sync_reconciliations').selectAll()
      .where('nodeId', '=', nodeId).where('entryId', 'in', entries.map(e => e.id)).execute();
  } catch (error) { if (missingStore(error)) return []; throw error; }
  const byId = new Map(entries.map(e => [e.id, e])), confirmed = new Set<string>();
  for (const proof of proofs) {
    const entry = byId.get(proof.entryId)!;
    if (entry.category !== 'metrics' || metricReceiptHash(proof.epoch, replicatedMetric(nodeId, entry)) !== proof.payloadHash) {
      throw new Error('Repeated replication entry conflicts with its reconciliation proof');
    }
    confirmed.add(entry.id);
  }
  return [...confirmed];
}

function sequence(id: string, epoch: string, namespaceFrom: string): string {
  const parts = id.split(':');
  const raw = parts.length === 1 ? parts[0]! : parts[1]!;
  if (!SEQUENCE.test(raw) || BigInt(raw) > 9223372036854775807n ||
    (parts.length === 1 ? BigInt(raw) >= BigInt(namespaceFrom) :
      parts.length !== 2 || parts[0] !== epoch || BigInt(raw) < BigInt(namespaceFrom))) {
    throw new Error('Reconciliation entry belongs to another buffer epoch');
  }
  return raw;
}

function validatePage(page: ReconciliationPage): void {
  if (!page || page.version !== 1 || typeof page.nodeId !== 'string' || !page.nodeId.trim() || page.nodeId.length > 128 ||
    !EPOCH.test(page.epoch) || !SEQUENCE.test(page.namespaceFrom) || !/^\d{1,19}$/.test(page.through) ||
    BigInt(page.namespaceFrom) > 9223372036854775807n || BigInt(page.through) > 9223372036854775807n ||
    (page.next !== null && (typeof page.next !== 'string' || !SEQUENCE.test(page.next) || BigInt(page.next) > BigInt(page.through))) ||
    !Number.isSafeInteger(page.unverifiedRows) || page.unverifiedRows < 0 ||
    !Array.isArray(page.entries) || page.entries.length > PAGE_LIMIT || Buffer.byteLength(JSON.stringify(page)) > MAX_PAGE_BYTES) {
    throw new Error('Invalid or oversized reconciliation page');
  }
  const ids = new Set<string>();
  for (const entry of page.entries) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || entry.category !== 'metrics' ||
      !entry.payload || typeof entry.payload !== 'object' || Array.isArray(entry.payload)) {
      throw new Error('Reconciliation currently requires unique retained metric entries');
    }
    if (BigInt(sequence(entry.id, page.epoch, page.namespaceFrom)) > BigInt(page.through)) throw new Error('Reconciliation entry exceeds the selected frontier');
    ids.add(entry.id);
  }
}

/** Bounded keyset read. No pending entry is released or taken from normal delivery. */
export async function readUnverifiedMetrics(db: Kysely<unknown>, nodeId: string, options: {
  after?: string; through?: string; epoch?: string; limit?: number;
} = {}): Promise<ReconciliationPage> {
  const limit = options.limit ?? PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT ||
    !/^\d{1,19}$/.test(options.after ?? '0') || (options.through !== undefined && !/^\d{1,19}$/.test(options.through))) throw new Error('Invalid reconciliation cursor or limit');
  const state = (await sql<{ epoch: string; namespaceFrom: string; producedThrough: string; firstTrackedId: string; unverifiedRows: number }>`
    SELECT epoch, cast(namespaceFrom as text) namespaceFrom, cast(producedThrough as text) producedThrough,
      cast(firstTrackedId as text) firstTrackedId, unverifiedRows FROM sync_replication_state WHERE id=1`.execute(db)).rows[0];
  if (!state || (options.epoch !== undefined && options.epoch !== state.epoch)) throw new Error('Reconciliation buffer epoch changed');
  const through = options.through ?? state.producedThrough;
  if (BigInt(through) > BigInt(state.producedThrough)) throw new Error('Reconciliation frontier is in the future');
  const hasJournal = (await sql`SELECT name FROM sqlite_master WHERE type='table' AND name='sync_reconciliations'`.execute(db)).rows.length > 0;
  const unreconciled = hasJournal ? sql`AND NOT EXISTS (SELECT 1 FROM sync_reconciliations r
    WHERE r."nodeId"=${nodeId} AND r.epoch=${state.epoch}
      AND r."entryId"=CASE WHEN sync_buffer.id >= ${state.namespaceFrom} THEN ${state.epoch} || ':' || sync_buffer.id ELSE cast(sync_buffer.id as text) END)` : sql``;
  const rows = state.unverifiedRows === 0 ? [] : (await sql<{ id: string; payload: string; createdAt: string }>`
    SELECT cast(id as text) id,payload,createdAt FROM sync_buffer
    WHERE id >= ${state.firstTrackedId} AND id > ${options.after ?? '0'} AND id <= ${through}
      AND category='metrics' AND syncedAt IS NOT NULL AND coalesce(syncOutcome,'unverified')='unverified'
      ${unreconciled}
    ORDER BY id LIMIT ${limit}`.execute(db)).rows;
  const entries: SyncBatch['entries'] = [];
  let bytes = 1024;
  for (const row of rows) {
    const entry = { id: BigInt(row.id) >= BigInt(state.namespaceFrom) ? `${state.epoch}:${row.id}` : row.id,
      category: 'metrics' as const, payload: JSON.parse(row.payload) as Record<string, unknown>, createdAt: toIsoUtc(row.createdAt) };
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes + size > MAX_PAGE_BYTES) {
      if (!entries.length) throw new Error('Retained metric exceeds the reconciliation page budget');
      break;
    }
    entries.push(entry); bytes += size;
  }
  const page: ReconciliationPage = { version: 1, nodeId, epoch: state.epoch, namespaceFrom: state.namespaceFrom,
    through, next: rows.length === limit || entries.length < rows.length ? rows[entries.length - 1]!.id : null,
    unverifiedRows: state.unverifiedRows, entries };
  validatePage(page); return page;
}

function sameSample(row: { name: string; value: number; timestamp: number | string; labels: unknown }, sample: MetricSample): boolean {
  const labels = typeof row.labels === 'string' ? JSON.parse(row.labels) : row.labels;
  const stored = prepareMetricSample({ name: row.name, value: row.value, timestamp: Number(row.timestamp), labels: labels as Record<string, string> });
  return stored.name === sample.name && stored.value === sample.value && stored.timestamp === sample.timestamp && JSON.stringify(stored.labels) === JSON.stringify(sample.labels);
}

/** Counts only newly inserted immutable proofs, in the same transaction. */
async function addTotals(db: Kysely<ReconciliationDatabase>, proofs: ReconciliationProof[]): Promise<void> {
  if (!proofs.length) return;
  const first = proofs[0]!;
  const verified = proofs.filter(p => p.result === 'present').length, restored = proofs.length - verified;
  const last = proofs.map(p => p.verifiedAt).sort().at(-1)!;
  await db.insertInto('sync_reconciliation_totals').values({ nodeId: first.nodeId, epoch: first.epoch,
    verifiedRows: verified, restoredRows: restored, lastReconciledAt: last })
    .onConflict(oc => oc.columns(['nodeId', 'epoch']).doUpdateSet({
      verifiedRows: sql`sync_reconciliation_totals."verifiedRows" + ${verified}`,
      restoredRows: sql`sync_reconciliation_totals."restoredRows" + ${restored}`,
      lastReconciledAt: sql`CASE WHEN sync_reconciliation_totals."lastReconciledAt" > ${last} THEN sync_reconciliation_totals."lastReconciledAt" ELSE ${last} END`,
    })).execute();
}

/**
 * Explicit repair only. Original claims stay immutable: the new journal states
 * whether a matching payload was present or was restored at a NEW commit.
 * Failed transactions issue no proof; replay validates identity and is a no-op.
 */
export async function reconcileMetricPage(db: Kysely<OmnitronDatabase>, storage: PostgresMetricsStorage<OmnitronDatabase>, page: ReconciliationPage,
  options: { restore: boolean; maxAgeMs?: number },
): Promise<{ present: number; missing: number; alreadyReconciled: number; proofs: ReconciliationProof[] }> {
  validatePage(page);
  const prepared = page.entries.map(entry => ({ entry, sample: replicatedMetric(page.nodeId, entry) }));
  const maxAge = options.maxAgeMs ?? 7 * 86400_000;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1) throw new Error('Invalid reconciliation history horizon');
  if (options.restore && prepared.some(p => p.sample.timestamp < Date.now() - maxAge || p.sample.timestamp > Date.now() + 60_000)) {
    throw new Error('Reconciliation sample is outside the configured history horizon');
  }
  if (options.restore) await prepareReconciliationStore(db as Kysely<unknown>);
  return db.transaction().execute(async transaction => {
    // Uses Titan's actual durable transaction contract, even for present data.
    if (options.restore) await storage.writeInTransaction(transaction, []);
    else await sql`SET LOCAL statement_timeout = '10s'`.execute(transaction);
    const journal = transaction as unknown as Kysely<ReconciliationDatabase>;
    if (options.restore) {
      // Repair competes only with repair, never with normal node ingestion.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reconcile:${page.nodeId}:${page.epoch}`}, 0))`.execute(transaction);
    }
    const ids = prepared.map(p => p.entry.id);
    if (!ids.length) return { present: 0, missing: 0, alreadyReconciled: 0, proofs: [] };
    const claims = await transaction.selectFrom('sync_ingested').select(['entryId', 'outcome'])
      .where('nodeId', '=', page.nodeId).where('entryId', 'in', ids).execute();
    const claimById = new Map(claims.map(c => [c.entryId, c.outcome]));
    let previous: ReconciliationProof[] = [];
    // Avoid a missing-table statement in a PostgreSQL transaction (which
    // would abort it). Discovery is read-only and doesn't prepare the store.
    const exists = (await sql<{ name: string | null }>`SELECT to_regclass('sync_reconciliations')::text name`.execute(transaction)).rows[0]?.name;
    if (exists) previous = await journal.selectFrom('sync_reconciliations').selectAll().where('nodeId', '=', page.nodeId)
      .where('epoch', '=', page.epoch).where('entryId', 'in', ids).execute();
    const priorById = new Map(previous.map(p => [p.entryId, p]));
    const stored = await (transaction as unknown as Kysely<OmnitronDatabase & {
      metrics_samples: { id: string; name: string; value: number; timestamp: number | string; labels: string; app: string };
    }>).selectFrom('metrics_samples').selectAll().where('id', 'in', [...prepared.map(p => p.sample.id), ...previous.map(p => p.metricId)]).execute();
    const storedById = new Map(stored.map(row => [row.id, row]));
    const candidates = (await sql<{ entryId: string; id: string }>`WITH wanted AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(prepared.filter(p => !priorById.has(p.entry.id)).map(p => ({
        entryId: p.entry.id, name: p.sample.name, app: p.sample.labels['app'], timestamp: p.sample.timestamp,
        value: p.sample.value, labels: p.sample.labels,
      })))}::jsonb) AS x("entryId" text,name text,app text,timestamp bigint,value double precision,labels jsonb)
    ) SELECT wanted."entryId",matched.id FROM wanted JOIN LATERAL (
      SELECT id FROM metrics_samples WHERE name=wanted.name AND app=wanted.app AND timestamp=wanted.timestamp
        AND value=wanted.value AND labels=wanted.labels ORDER BY id LIMIT 1
    ) matched ON true`.execute(transaction)).rows;
    const candidateById = new Map(candidates.map(row => [row.entryId, row]));
    const proofs: ReconciliationProof[] = [], fresh: ReconciliationProof[] = [], missing: MetricSample[] = [];
    let present = 0, alreadyReconciled = 0;
    for (const { entry, sample } of prepared) {
      const hash = metricReceiptHash(page.epoch, sample), prior = priorById.get(entry.id), exact = storedById.get(prior?.metricId ?? sample.id);
      if (exact && !sameSample(exact, sample)) throw new Error('Reconciliation metric identity conflicts with existing data');
      if (prior) {
        if (prior.payloadHash !== hash) throw new Error('Reconciliation proof conflicts with the source payload');
        // The proof records a past COMMIT; normal history retention does not
        // invalidate it or authorize resurrection of expired samples.
        proofs.push(prior); alreadyReconciled++; continue;
      }
      const claim = claimById.get(entry.id);
      if (claim === 'discarded') throw new Error('Cannot reconcile a permanently rejected entry');
      const match = exact ?? candidateById.get(entry.id);
      if (!match && claim === 'committed') throw new Error('A committed payload is absent; inspect its retention or deletion before restoring');
      if (match) present++; else missing.push(sample);
      if (options.restore) {
        const proof: ReconciliationProof = { nodeId: page.nodeId, epoch: page.epoch, entryId: entry.id, payloadHash: hash,
          metricId: match?.id ?? sample.id, result: match ? 'present' : 'restored', verifiedAt: new Date().toISOString(),
          receiptId: randomUUID(), previousOutcome: claim ?? 'missing' };
        proofs.push(proof); fresh.push(proof);
      }
    }
    if (options.restore && fresh.length) {
      await storage.writeInTransaction(transaction, missing);
      await journal.insertInto('sync_reconciliations').values(fresh).execute();
      await addTotals(journal, fresh);
    }
    return { present, missing: missing.length, alreadyReconciled, proofs };
  });
}

/** Verify each proof against the still-retained, immutable source before applying it. */
export async function acknowledgeReconciliation(db: Kysely<unknown>, nodeId: string, proofs: ReconciliationProof[]): Promise<{ reconciled: number }> {
  if (!Array.isArray(proofs) || proofs.length > PAGE_LIMIT || Buffer.byteLength(JSON.stringify(proofs)) > MAX_PAGE_BYTES) throw new Error('Invalid reconciliation proof page');
  if (!proofs.length) return { reconciled: 0 };
  const mode = (await sql<{ journal_mode: string }>`PRAGMA journal_mode`.execute(db)).rows[0]?.journal_mode;
  const sync = (await sql<{ synchronous: number }>`PRAGMA synchronous`.execute(db)).rows[0]?.synchronous;
  if (mode !== 'wal' || sync === undefined || sync < 2) throw new Error('Reconciliation acknowledgement requires SQLite WAL and synchronous FULL or EXTRA');
  await prepareReconciliationStore(db);
  return db.transaction().execute(async transaction => {
    const state = (await sql<{ epoch: string; namespaceFrom: string; firstTrackedId: string }>`SELECT epoch,
      cast(namespaceFrom as text) namespaceFrom,cast(firstTrackedId as text) firstTrackedId FROM sync_replication_state WHERE id=1`.execute(transaction)).rows[0];
    if (!state) throw new Error('Replication state is unavailable');
    const journal = transaction as Kysely<ReconciliationDatabase>, fresh: ReconciliationProof[] = [];
    for (const proof of proofs) {
      if (proof.nodeId !== nodeId || proof.epoch !== state.epoch || !['present', 'restored'].includes(proof.result) ||
        !/^[a-f0-9]{64}$/.test(proof.payloadHash) || !/^[a-f0-9-]{36}$/.test(proof.receiptId) ||
        typeof proof.metricId !== 'string' || !proof.metricId.length || proof.metricId.length > 512 ||
        !['unverified', 'committed', 'missing'].includes(proof.previousOutcome) || !Number.isFinite(Date.parse(proof.verifiedAt))) throw new Error('Invalid reconciliation proof');
      const id = sequence(proof.entryId, state.epoch, state.namespaceFrom);
      if (BigInt(id) < BigInt(state.firstTrackedId)) throw new Error('Reconciliation proof precedes the tracked evidence');
      const prior = await journal.selectFrom('sync_reconciliations').selectAll().where('nodeId', '=', nodeId).where('epoch', '=', state.epoch).where('entryId', '=', proof.entryId).executeTakeFirst();
      if (prior) {
        if (JSON.stringify(Object.entries(prior).sort()) !== JSON.stringify(Object.entries(proof).sort())) throw new Error('Conflicting reconciliation proof replay');
        continue;
      }
      const row = (await sql<{ payload: string; createdAt: string }>`SELECT payload,createdAt FROM sync_buffer
        WHERE id=${id} AND category='metrics' AND syncedAt IS NOT NULL AND coalesce(syncOutcome,'unverified')='unverified'`.execute(transaction)).rows[0];
      if (!row) throw new Error('Source payload is no longer retained and unverified; proof cannot settle this gap');
      const sample = replicatedMetric(nodeId, { id: proof.entryId, category: 'metrics', payload: JSON.parse(row.payload), createdAt: toIsoUtc(row.createdAt) });
      if (metricReceiptHash(state.epoch, sample) !== proof.payloadHash) throw new Error('Reconciliation proof does not match the retained payload');
      await journal.insertInto('sync_reconciliations').values(proof).execute(); fresh.push(proof);
    }
    if (fresh.length) {
      const last = fresh.map(p => p.verifiedAt).sort().at(-1)!;
      const changed = await sql`UPDATE sync_replication_state SET
        unverifiedRows=unverifiedRows-${fresh.length},committedRows=committedRows+${fresh.length},
        firstUncommittedId=CASE WHEN unverifiedRows=${fresh.length} AND discardedRows=0 AND evictedRows=0 THEN NULL ELSE firstUncommittedId END,
        lastCommittedAt=CASE WHEN lastCommittedAt > ${last} THEN lastCommittedAt ELSE ${last} END
        WHERE id=1 AND epoch=${state.epoch} AND unverifiedRows>=${fresh.length}`.execute(transaction);
      if (Number(changed.numAffectedRows) !== 1) throw new Error('Reconciliation counters disagree with the retained source');
      await addTotals(journal, fresh);
    }
    return { reconciled: fresh.length };
  });
}
