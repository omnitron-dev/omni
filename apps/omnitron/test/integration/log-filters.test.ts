/**
 * The two log filters the schema was built for and no query used.
 *
 * `logs.nodeId` is a uuid column that `SyncService.ingestLog` fills for every
 * entry a slave sends up. `logs.labels` is jsonb with a GIN index that
 * `001_initial_schema` created, its own comment naming the query it was for:
 * `WHERE labels @> '{"env":"prod"}'`. Neither `queryLogs` nor `getRecentLogs`
 * referenced either column.
 *
 * The console's cluster node filter therefore narrowed nothing while its chip
 * stayed lit — a filter that silently does nothing, which is worse than one
 * that is missing, because the operator reads the unnarrowed result as an
 * answer about that node.
 *
 * Run against the real database because the whole claim is about SQL: a fake
 * would be asserting that this file passes the filter along, which is exactly
 * what nobody doubted.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';

import { createOmnitronDb } from '../../src/database/connection.js';
import { LogCollectorService } from '../../src/services/log-collector.service.js';

const NODE_A = '11111111-1111-4111-8111-111111111111';
const NODE_B = '22222222-2222-4222-8222-222222222222';
const APP = `log-filter-probe-${process.pid}`;

let db: Awaited<ReturnType<typeof createOmnitronDb>>;
let collector: LogCollectorService;

beforeAll(async () => {
  db = await createOmnitronDb({ max: 1, connectionTimeoutMillis: 5_000 });
  collector = new LogCollectorService(db as never, undefined as never);

  await sql`
    INSERT INTO logs (id, timestamp, "nodeId", app, level, message, labels)
    VALUES
      (gen_random_uuid(), now(), ${NODE_A}::uuid, ${APP}, 'info', 'from node a', '{"env":"prod"}'::jsonb),
      (gen_random_uuid(), now(), ${NODE_B}::uuid, ${APP}, 'info', 'from node b', '{"env":"staging"}'::jsonb),
      (gen_random_uuid(), now(), NULL,            ${APP}, 'info', 'from the master', NULL)
  `.execute(db);
});

afterAll(async () => {
  await sql`DELETE FROM logs WHERE app = ${APP}`.execute(db);
  await db.destroy();
});

describe('queryLogs', () => {
  it('narrows to one cluster node', async () => {
    const result = await collector.queryLogs({ app: APP, nodeId: NODE_A });

    expect(result.entries.map((e) => e.message)).toEqual(['from node a']);
  });

  it('leaves the master out when a node is named', async () => {
    // Locally collected entries carry a null `nodeId`, so asking for a node
    // must not fold them in — they are the master's own output.
    const result = await collector.queryLogs({ app: APP, nodeId: NODE_B });

    expect(result.entries.map((e) => e.message)).toEqual(['from node b']);
  });

  it('matches labels by containment', async () => {
    const result = await collector.queryLogs({ app: APP, labels: { env: 'prod' } });

    expect(result.entries.map((e) => e.message)).toEqual(['from node a']);
  });

  it('returns everything when neither filter is given', async () => {
    const result = await collector.queryLogs({ app: APP });

    expect(result.entries).toHaveLength(3);
  });
});

describe('getRecentLogs — the live tail', () => {
  it('applies the same node filter as the paginated query', async () => {
    // A filter honoured by one path and not the other is how a viewer
    // changes its answer when you press Live.
    const entries = await collector.getRecentLogs({ app: APP, nodeId: NODE_A, tail: 50 });

    expect(entries.map((e) => e.message)).toEqual(['from node a']);
  });

  it('applies the same label filter', async () => {
    const entries = await collector.getRecentLogs({ app: APP, labels: { env: 'staging' }, tail: 50 });

    expect(entries.map((e) => e.message)).toEqual(['from node b']);
  });

  it('returns everything when neither filter is given', async () => {
    const entries = await collector.getRecentLogs({ app: APP, tail: 50 });

    expect(entries).toHaveLength(3);
  });
});
