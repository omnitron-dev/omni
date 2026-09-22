/**
 * A batch of a thousand entries was received as a thousand transactions.
 *
 * `receiveBatch` claimed and ingested each entry in a transaction of its own
 * — so that one entry the database refuses costs that entry and not the batch.
 * The price was paid on every batch: a thousand `BEGIN … COMMIT`s, and on the
 * master's omnitron-pg, which runs `synchronous_commit = on` and `fsync = on`
 * (read 2026-09-22), each COMMIT waits for its own WAL flush. That is the
 * ingest cost per entry, and it is what a heartbeat-driven pull pays for
 * every entry a node has buffered.
 *
 * It was affordable while the master's machine was idle: 10 000 entries in
 * 9–12 s, 800–1 100 a second, against 38 a second produced on the test node.
 * It stopped being affordable when the machine was not: a pull that outlasts
 * the 15 s heartbeat is joined by another over the same entries (see
 * `a-pull-that-started-again-before-it-finished.test.ts`), and the backlog
 * grew in lockstep while the log reported pulls of thousands.
 *
 * Now a batch is ONE transaction: the claims in one statement, each table's
 * rows in one more. The per-entry path is kept, and taken only when the batch
 * as a whole is refused — which is exactly when isolating the entry that
 * caused it is worth a transaction per entry.
 *
 * Against a real Postgres, because what is measured is statements and what
 * is asserted is rows: a stand-in database would be kinder than the one the
 * master has on both counts.
 *
 * Requires the test infrastructure: `pnpm test:up` (postgres on :15432).
 */

import { createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

import { SyncService, type SyncBatch, type SyncCategory } from '../../src/services/sync.service.js';
import { migrateOmnitronDb } from '../../src/database/migration-runner.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

/**
 * A database of its own. `omnitron-migrations.test.ts` drops the shared
 * database's `public` schema before each of its tests, and vitest runs files
 * in parallel.
 */
const DB_NAME = `omnitron_sync_ingest_${process.pid}`;

/** The registry uuid the master labels a node's rows with. */
const NODE = '16f3dd5a-2727-49e5-90a2-d762b57073f6';

let admin: Kysely<unknown> | undefined;
let db: Kysely<OmnitronDatabase>;
/** Every statement the service sends, as Kysely compiled it. */
const statements: string[] = [];

/**
 * A pool whose idle clients may be cut off without it being a test failure.
 * `DROP DATABASE … WITH (FORCE)` terminates whatever is still attached
 * (57P01), and a pg client with no 'error' listener turns that into an
 * unhandled error reported against whichever test ran last.
 */
function quietPool(connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on('error', () => {});
  return pool;
}

beforeAll(async () => {
  if (!testPg.ok) return;
  admin = new Kysely({ dialect: new PostgresDialect({ pool: quietPool(TEST_PG_URL, 1) }) });
  await sql.raw(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).execute(admin);
  await sql.raw(`CREATE DATABASE ${DB_NAME}`).execute(admin);

  const url = new URL(TEST_PG_URL);
  url.pathname = `/${DB_NAME}`;
  db = new Kysely<OmnitronDatabase>({
    dialect: new PostgresDialect({ pool: quietPool(url.toString(), 4) }),
    log: (event) => {
      if (event.level === 'query') statements.push(event.query.sql);
    },
  });
  await migrateOmnitronDb(db as unknown as Kysely<unknown>);
});

afterAll(async () => {
  await db?.destroy();
  if (admin) {
    await sql.raw(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`).execute(admin);
    await admin.destroy();
  }
});

beforeEach(async () => {
  if (!testPg.ok) return;
  // `alert_rules` too: its names are unique, and two tests make a rule.
  await sql`TRUNCATE sync_ingested, logs, metrics_raw, alert_events, alert_rules, traces`.execute(db);
  statements.length = 0;
});

type Entry = SyncBatch['entries'][number];

let nextId = 1;
function entry(category: SyncCategory, payload: Record<string, unknown>): Entry {
  return { id: String(nextId++), category, payload, createdAt: new Date(Date.UTC(2026, 8, 22, 17, 0, nextId % 60)).toISOString() };
}

/** A batch as the node's `drainBuffer` builds it, relabelled as the master does. */
function batch(entries: Entry[]): SyncBatch {
  return {
    nodeId: NODE,
    batchId: `daos-cpp-9700-${Date.now()}`,
    checksum: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
    entries,
  };
}

function master(sink?: (sample: { node: string; name: string; value: number }) => void) {
  const svc = new SyncService(db, createNullLogger(), 'MacBook-Pro-9700', 'master', {});
  if (sink) svc.setMetricsSink(sink as never);
  return svc;
}

async function count(table: 'sync_ingested' | 'logs' | 'metrics_raw' | 'alert_events' | 'traces'): Promise<number> {
  const r = await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(db);
  return Number(r.rows[0]!.n);
}

/** What the test node actually buffers: logs and metrics, some events, a few spans. */
function mixed(n: number): Entry[] {
  return Array.from({ length: n }, (_, i) => {
    switch (i % 10) {
      case 0: case 1: case 2: case 3:
        return entry('logs', { app: 'main', level: 'info', message: `request ${i}`, labels: { route: '/api' } });
      case 4: case 5: case 6:
        return entry('metrics', { app: 'main', name: 'rpc_requests', value: i, labels: { method: 'getUser' } });
      case 7: case 8:
        return entry('events', { app: 'main', message: `event ${i}` });
      default:
        return entry('traces', { traceId: `t${i}`, spanId: `s${i}`, operationName: 'getUser', serviceName: 'main', duration: 3 });
    }
  });
}

async function makeRule(): Promise<string> {
  const rule = await db
    .insertInto('alert_rules')
    .values({ name: 'disk', expression: 'disk > 90', type: 'metric', severity: 'warning', forDuration: null, annotations: null, labels: null, enabled: true } as never)
    .returning('id')
    .executeTakeFirstOrThrow();
  return String(rule.id);
}

describe.skipIf(!testPg.ok)('a batch received one entry at a time', () => {
  it('takes a thousand entries in a handful of statements, not a thousand transactions', async () => {
    const entries = mixed(1_000);

    const result = await master().receiveBatch(batch(entries));

    expect(result.accepted).toBe(1_000);
    expect(result.failedIds).toEqual([]);

    const claims = statements.filter((s) => /^insert into "sync_ingested"/i.test(s)).length;
    const writes = statements.filter((s) => /^insert into/i.test(s)).length;
    // Measured on the per-entry path: 1 000 claims and 1 000 data inserts.
    expect(claims, 'claim statements for 1 000 entries').toBeLessThanOrEqual(2);
    expect(writes, 'insert statements for 1 000 entries in four tables').toBeLessThanOrEqual(8);

    // And every entry landed where it belongs, under the node's name.
    expect(await count('sync_ingested')).toBe(1_000);
    expect(await count('logs')).toBe(600); // 400 logs + 200 events
    expect(await count('metrics_raw')).toBe(300);
    expect(await count('traces')).toBe(100);
    const foreign = await sql<{ n: string }>`
      SELECT count(*) AS n FROM logs WHERE "nodeId" IS DISTINCT FROM ${NODE}::uuid
    `.execute(db);
    expect(Number(foreign.rows[0]!.n), 'rows not labelled with the node').toBe(0);
  });

  it('delivers the same batch twice without applying it twice', async () => {
    const svc = master();
    const entries = mixed(200);

    await svc.receiveBatch(batch(entries));
    const again = await svc.receiveBatch(batch(entries));

    expect(again.accepted).toBe(0);
    expect(again.duplicateIds).toHaveLength(200);
    expect(await count('logs')).toBe(120);
    expect(await count('metrics_raw')).toBe(60);
  });

  it('takes an entry that appears twice in one batch once', async () => {
    const one = entry('logs', { app: 'main', message: 'once' });

    const result = await master().receiveBatch(batch([one, { ...one }]));

    expect(result.acceptedIds).toEqual([one.id]);
    expect(result.duplicateIds).toEqual([one.id]);
    expect(await count('logs')).toBe(1);
  });

  it('costs one entry the database can never store that entry, not its batch', async () => {
    const ruleId = await makeRule();
    const logs = Array.from({ length: 50 }, (_, i) => entry('logs', { app: 'main', message: `line ${i}` }));
    // `alert_events.ruleId` is a uuid with a foreign key: 'unknown' is refused
    // by the database on its content, the same way every time.
    const bad = entry('alerts', { ruleId: 'unknown', status: 'firing' });
    const good = entry('alerts', { ruleId, status: 'firing', value: 93 });

    const result = await master().receiveBatch(batch([...logs.slice(0, 25), bad, ...logs.slice(25), good]));

    expect(result.discardedIds).toEqual([bad.id]);
    expect(result.failedIds).toEqual([]);
    expect(result.accepted).toBe(51);
    expect(await count('logs')).toBe(50);
    const alerts = await sql<{ node: string }>`SELECT annotations->>'node' AS node FROM alert_events`.execute(db);
    expect(alerts.rows).toEqual([{ node: NODE }]);
  });

  it('records a metric in the console store once, after it is stored, and not when it was not', async () => {
    const recorded: number[] = [];
    const svc = master((s) => recorded.push(s.value));
    const ruleId = await makeRule();
    const metrics = [1, 2, 3].map((v) => entry('metrics', { app: 'main', name: 'cpu', value: v }));

    // A batch that has to fall back to one entry at a time: the metrics
    // must not be recorded by the attempt that was rolled back as well.
    await svc.receiveBatch(batch([...metrics, entry('alerts', { ruleId: 'unknown' }), entry('alerts', { ruleId })]));
    expect(recorded.sort()).toEqual([1, 2, 3]);

    // Offered again: already stored, so not recorded again.
    await svc.receiveBatch(batch(metrics));
    expect(recorded.sort()).toEqual([1, 2, 3]);

    // A metric the database could not store this time is retried later — and
    // recording it now would count it twice once the retry succeeds.
    recorded.length = 0;
    await sql`ALTER TABLE metrics_raw RENAME TO metrics_raw_away`.execute(db);
    try {
      const later = entry('metrics', { app: 'main', name: 'cpu', value: 4 });
      const result = await svc.receiveBatch(batch([later]));
      expect(result.failedIds).toEqual([later.id]);
      expect(recorded, 'recorded while the row it describes was never stored').toEqual([]);
    } finally {
      await sql`ALTER TABLE metrics_raw_away RENAME TO metrics_raw`.execute(db);
    }
  });
});
