/**
 * 76 659 warnings about one outage, and not one of them said what it was.
 *
 *     this.logger.warn(
 *       { nodeId, entryId: entry.id, category: entry.category,
 *         error: (err as Error).message },
 *       'Failed to ingest sync entry — left unacknowledged for retry');
 *
 * One line per ENTRY, and `.message` is the empty string for the commonest
 * failure there is: the database is unreachable, which arrives as an
 * `AggregateError` whose reasons live in `.errors` and whose own message is
 * `''`.
 *
 * Measured in `~/.omnitron/logs/omnitron.log`: 76 659 records, 98% of
 * everything the daemon logged at warn level or above, all inside one hour on
 * 2026-09-21 (15:00–15:37). Categories: metrics 38 606, logs 38 053. Entry
 * ids from 5574285 to 5575284 — exactly 1000 distinct entries, offered about
 * 77 times each, with `error: ""` in every single record and 94 companion
 * lines saying the batch was partially ingested.
 *
 * The cause was in the NEXT FILE, in three lines, at the same time:
 *
 *     15:14:42  Failed to provision omnitron-pg — Command failed: docker
 *               network create omnitron_default. Cannot connect to the Docker
 *               daemon at unix:///Users/…/.orbstack/run/docker.sock
 *     15:16:45  Failed to provision stack infrastructure (daos/dev) ×2 —
 *               Docker is not available
 *
 * OrbStack was down, so the master's own database never came up, so the
 * transaction behind every entry failed. Three lines name it; 76 659 do not.
 *
 * Both halves are fixed here. A refusal names its cause, taken from the same
 * `describeError` that already unwraps empty `AggregateError`s elsewhere in
 * this repository. And the per-entry line drops to debug, because a thousand
 * identical refusals are one event: the batch line carries the count and the
 * distinct causes, so an outage reads as one line per batch instead of one
 * per entry.
 */

import { describe, it, expect, vi } from 'vitest';

import { SyncService } from '../../src/services/sync.service.js';

const recordingLogger = () => {
  const logger: any = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  };
  logger.child = () => logger;
  return logger;
};

/** What a dead Postgres actually throws: no message, reasons inside. */
const unreachableDatabase = () =>
  new AggregateError(
    [new Error('connect ECONNREFUSED ::1:5433'), new Error('connect ECONNREFUSED 127.0.0.1:5433')],
    '',
  );

const ENTRIES = Array.from({ length: 4 }, (_, i) => ({
  id: String(5574285 + i),
  category: 'metrics',
  payload: {},
  createdAt: '2026-09-21T15:00:00Z',
}));

async function ingestWithFailure() {
  const logger = recordingLogger();
  const svc: any = new SyncService({} as never, logger, 'master-1', 'master', undefined as never);
  svc.checkRateLimit = () => true;
  svc.computeChecksum = async () => 'sum';
  svc.claimAndIngest = async () => {
    throw unreachableDatabase();
  };

  await svc.receiveBatch({
    nodeId: 'edge-1',
    batchId: 'batch-1',
    checksum: 'sum',
    entries: ENTRIES,
  });

  return logger;
}

const said = (fn: any) =>
  fn.mock.calls.map(([fields, msg]: [Record<string, unknown>, string]) => ({ fields, msg: String(msg) }));

describe('a refusal repeated without its reason', () => {
  it('names the cause, even when the error itself has no words', async () => {
    const logger = await ingestWithFailure();

    const batchLine = said(logger.warn).find((c: any) => /partially ingested/i.test(c.msg));
    expect(batchLine, 'the batch must report what stopped it').toBeTruthy();
    expect(JSON.stringify(batchLine.fields), 'the reason inside the AggregateError never surfaced').toMatch(
      /ECONNREFUSED/,
    );
  });

  it('a thousand identical refusals are one event, not a thousand warnings', async () => {
    const logger = await ingestWithFailure();

    // Four entries, one batch: an operator must get the batch line, not one
    // warning per entry. The per-entry detail stays available at debug.
    expect(said(logger.warn), 'one warning per batch').toHaveLength(1);
    expect(
      said(logger.debug).filter((c: any) => /ingest sync entry/i.test(c.msg)),
      'and every entry still accounted for, quietly',
    ).toHaveLength(ENTRIES.length);
  });

  it('a batch that ingests cleanly says nothing at warn level', async () => {
    // Control: silence on the happy path is the reason the warning means
    // anything at all.
    const logger = recordingLogger();
    const svc: any = new SyncService({} as never, logger, 'master-1', 'master', undefined as never);
    svc.checkRateLimit = () => true;
    svc.computeChecksum = async () => 'sum';
    svc.claimAndIngest = async () => 'accepted';

    await svc.receiveBatch({ nodeId: 'edge-1', batchId: 'batch-2', checksum: 'sum', entries: ENTRIES });

    expect(said(logger.warn)).toHaveLength(0);
  });
});
