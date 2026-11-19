import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { TraceReport } from './finite-traces.js';
import { recordTraceReceipt } from './trace-receipt.js';

it('retains concurrent outcomes and their provenance without replacing an earlier result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-receipts-'));
  const options = { directory, sourceCommit: '4'.repeat(40) };
  const report: TraceReport<unknown> = {
    mode: 'bounded', verdict: 'matched', depth: 2, maxTraces: 4,
    completedTraces: 4, actions: 8, observations: 12, elapsedMs: 1,
  };
  try {
    const receipts = await Promise.all([
      recordTraceReceipt('queue', report, options),
      recordTraceReceipt('queue', { ...report, verdict: 'inconclusive', reason: 'fixture unavailable' }, options),
    ]);
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    const stored = await Promise.all(files.map(async name => (await readFile(join(directory, name), 'utf8')).trimEnd()));
    expect(new Set(stored)).toEqual(new Set(receipts));
    expect(JSON.parse(receipts[0]!)).toMatchObject({
      schemaVersion: 1, profile: 'queue', sourceCommit: options.sourceCommit, runtime: { node: process.versions.node },
    });
    await expect(recordTraceReceipt('../queue', report, options)).rejects.toThrow('profile name');
    await expect(recordTraceReceipt('queue', report, { directory, sourceCommit: 'uncommitted' })).rejects.toThrow('object ID');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
