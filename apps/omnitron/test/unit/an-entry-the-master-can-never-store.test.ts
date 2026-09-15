/**
 * One malformed entry would have stopped a node replicating, permanently.
 *
 * `receiveBatch` leaves a failed entry unacknowledged so the slave offers it
 * again. That is right when the master was momentarily unable — a dropped
 * connection, a deadlock, a full disk — and wrong when the DATA cannot be
 * stored, because the answer is the same every time and the entry sits at
 * the head of the buffer with everything behind it.
 *
 * Not hypothetical. `alert_events.ruleId` is a `uuid` with a foreign key to
 * `alert_rules`, and `ingestAlert` writes `payload.ruleId ?? 'unknown'`:
 *
 *     select 'unknown'::uuid;
 *     ERROR:  invalid input syntax for type uuid: "unknown"
 *
 * A slave's alert rules are its own, so the same is true of any real ruleId
 * the master does not share. The first alert a node raised would have wedged
 * that node's entire replication, and the only symptom is one "Sync pull
 * stalled" line per sweep.
 *
 * The same function already draws this distinction for an unknown category —
 * "retrying cannot make it known" — and drops it.
 */

import { describe, it, expect } from 'vitest';

import { classifyIngestFailure, deliveredIds } from '../../src/services/sync-policy.js';

const pgError = (code: string, message = 'refused') => Object.assign(new Error(message), { code });

describe('classifying an ingest failure', () => {
  it('calls a malformed value permanent', () => {
    // 22P02 — invalid_text_representation, which is what `'unknown'::uuid` is.
    expect(classifyIngestFailure(pgError('22P02', 'invalid input syntax for type uuid: "unknown"'))).toBe('permanent');
  });

  it('calls a foreign key the master does not have permanent', () => {
    expect(classifyIngestFailure(pgError('23503'))).toBe('permanent');
    expect(classifyIngestFailure(pgError('23502'))).toBe('permanent'); // not-null
    expect(classifyIngestFailure(pgError('23514'))).toBe('permanent'); // check
  });

  it('calls a database that is momentarily unable transient', () => {
    expect(classifyIngestFailure(pgError('08006', 'connection failure'))).toBe('transient');
    expect(classifyIngestFailure(pgError('40P01', 'deadlock detected'))).toBe('transient');
    expect(classifyIngestFailure(pgError('53100', 'disk full'))).toBe('transient');
    expect(classifyIngestFailure(pgError('57014', 'canceling statement'))).toBe('transient');
  });

  it('understands the other engine s spelling', () => {
    expect(classifyIngestFailure(pgError('SQLITE_CONSTRAINT_FOREIGNKEY'))).toBe('permanent');
    expect(classifyIngestFailure(pgError('SQLITE_BUSY'))).toBe('transient');
  });

  it('reads the text when a driver reports no code', () => {
    expect(classifyIngestFailure(new Error('invalid input syntax for type uuid: "unknown"'))).toBe('permanent');
    expect(classifyIngestFailure(new Error('violates foreign key constraint "alert_events_ruleId_fkey"'))).toBe('permanent');
  });

  it('treats anything it does not recognise as transient', () => {
    // The direction matters: getting this wrong here costs a retry. Getting
    // it wrong the other way discards data.
    expect(classifyIngestFailure(new Error('something nobody has seen'))).toBe('transient');
    expect(classifyIngestFailure(undefined)).toBe('transient');
    expect(classifyIngestFailure({ code: 99 })).toBe('transient');
  });
});

describe('what a slave may release', () => {
  const outcome = (over: Partial<Parameters<typeof deliveredIds>[0]> = {}) => ({
    accepted: [], duplicates: [], failed: [], discarded: [], ...over,
  });

  it('releases what the master holds', () => {
    expect(deliveredIds(outcome({ accepted: ['1'], duplicates: ['2'] }))).toEqual(['1', '2']);
  });

  it('keeps what the master could not take this time', () => {
    // Data the master rejected because it was momentarily unable is still
    // data the slave holds.
    expect(deliveredIds(outcome({ failed: ['3'] }))).toEqual([]);
  });

  it('releases what the master will never take', () => {
    // Holding it does not preserve it: it parks it at the head of the buffer
    // with everything behind it waiting, until the bound drops the lot.
    expect(deliveredIds(outcome({ accepted: ['1'], discarded: ['4'], failed: ['3'] }))).toEqual(['1', '4']);
  });
});

// =============================================================================
// The node a remote alert or span came from
// =============================================================================

const { SyncService } = await import('../../src/services/sync.service.js');

const silent: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silent,
};

/** Captures the row an ingest would write. */
function capturingDb() {
  const rows: Array<{ table: string; values: any }> = [];
  return {
    rows,
    insertInto: (table: string) => ({
      values: (values: any) => ({ execute: async () => { rows.push({ table, values }); } }),
    }),
  };
}

const master = () => new SyncService({} as never, silent, 'master-1', 'master', undefined as never);

describe('a replicated alert says which machine raised it', () => {
  it('records the node in the annotations', async () => {
    const db = capturingDb();

    await (master() as unknown as {
      ingestAlert(db: unknown, nodeId: string, entry: { payload: Record<string, unknown>; createdAt: string }): Promise<void>;
    }).ingestAlert(db, 'edge-7', {
      payload: { ruleId: 'b0a7…', status: 'firing', annotations: { summary: 'disk above 90%' } },
      createdAt: '2026-09-15T00:00:00Z',
    });

    // `nodeId` was `_nodeId` here — accepted and discarded. `alert_events`
    // has no node column, so an alert that says "disk above 90%" could not
    // say whose disk.
    const written = JSON.parse(db.rows[0]!.values.annotations);
    expect(written).toEqual({ summary: 'disk above 90%', node: 'edge-7' });
  });

  it('records it even for an alert that carried no annotations', async () => {
    const db = capturingDb();

    await (master() as unknown as { ingestAlert(db: unknown, nodeId: string, entry: unknown): Promise<void> })
      .ingestAlert(db, 'edge-7', { payload: { ruleId: 'b0a7…' }, createdAt: '2026-09-15T00:00:00Z' });

    expect(JSON.parse(db.rows[0]!.values.annotations)).toEqual({ node: 'edge-7' });
  });
});

describe('a replicated span says which machine produced it', () => {
  it('keeps the span s own tags and adds the node', async () => {
    const db = capturingDb();

    await (master() as unknown as { ingestTrace(db: unknown, nodeId: string, entry: unknown): Promise<void> })
      .ingestTrace(db, 'edge-7', {
        payload: { traceId: 't1', spanId: 's1', tags: { 'http.method': 'GET' } },
        createdAt: '2026-09-15T00:00:00Z',
      });

    // This was `entry.payload['tags'] ?? { nodeId }` — a fallback, so the
    // node was recorded ONLY for a span with no tags at all, and dropped for
    // every span that carried any. The `??` fires exactly when there is
    // nothing to lose and is skipped exactly when there is.
    expect(JSON.parse(db.rows[0]!.values.tags)).toEqual({ 'http.method': 'GET', node: 'edge-7' });
  });

  it('records it for a span with no tags', async () => {
    const db = capturingDb();

    await (master() as unknown as { ingestTrace(db: unknown, nodeId: string, entry: unknown): Promise<void> })
      .ingestTrace(db, 'edge-7', { payload: { traceId: 't1', spanId: 's1' }, createdAt: '2026-09-15T00:00:00Z' });

    expect(JSON.parse(db.rows[0]!.values.tags)).toEqual({ node: 'edge-7' });
  });
});
