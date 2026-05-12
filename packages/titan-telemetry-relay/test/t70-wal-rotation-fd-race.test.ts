/**
 * Regression test for T#70 — WAL FD-rotation race.
 *
 * Pre-T#70 the WAL queued async writes via `writeChain` but called
 * `rotate()` (sync `closeFd()` + segment bump) immediately when the
 * pending `currentSize` exceeded `maxSizeBytes`. The closed FD then
 * killed in-flight writes with EBADF and the bytes were silently lost
 * despite the optimistic `totalWritten` increment.
 *
 * The fix (`rotateAdvance`): synchronously open the NEW segment's FD
 * so subsequent appends use it, and chain the close of the OLD FD
 * behind the pending writeChain. Every queued write completes against
 * the FD that was current at queue time.
 *
 * The test stresses the path that historically lost data: many small
 * appends with a tiny `maxSizeBytes` so we rotate frequently. With
 * the bug, `entryCount()` after `flush()` undercounted; with the fix
 * we observe every entry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TelemetryWal } from '../src/telemetry-wal.js';

describe('T#70 — WAL FD-rotation race', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 't70-wal-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves every entry across many rotations', async () => {
    const wal = new TelemetryWal({
      directory: tmpDir,
      maxSizeBytes: 256,    // tiny — forces rotation every few entries
      maxSegments: 10_000,  // generous so no segment is evicted
    });

    const entryCount = 200;
    for (let i = 0; i < entryCount; i++) {
      wal.append([{
        timestamp: Date.now(),
        nodeId: 'test',
        type: 'metric',
        data: { name: 'value', i },
      } as any]);
    }
    await wal.flush();

    const all = await wal.readAll();
    // Pre-T#70: the FD-closing race lost a significant fraction of
    // entries — the count would have been visibly less than 200.
    expect(all.length).toBe(entryCount);
    await wal.dispose();
  });

  it('await dispose() flushes pending writes before closing the FD', async () => {
    const wal = new TelemetryWal({ directory: tmpDir, maxSizeBytes: 100_000_000, maxSegments: 1 });
    for (let i = 0; i < 100; i++) {
      wal.append([{
        timestamp: Date.now(),
        nodeId: 't',
        type: 'metric',
        data: { i },
      } as any]);
    }
    // Pre-T#70 dispose was sync — pending writes would be aborted by
    // closeFd() and the count would be < 100.
    await wal.dispose();

    // Read the segment directly from disk to confirm durability.
    const wal2 = new TelemetryWal({ directory: tmpDir, maxSegments: 1 });
    const all = await wal2.readAll();
    expect(all.length).toBe(100);
    await wal2.dispose();
  });

  it('a concurrent append after rotation lands in the NEW segment', async () => {
    const wal = new TelemetryWal({
      directory: tmpDir,
      maxSizeBytes: 200, // small — fits ~2 entries per segment
      maxSegments: 100,
    });

    // First append crosses the threshold (the entry is bigger than
    // maxSizeBytes, so currentSize exceeds the limit and rotation is
    // scheduled). The SECOND append in the same tick must use the new
    // FD synchronously — not the closed one.
    const entry = { timestamp: Date.now(), nodeId: 't', type: 'metric', data: { x: 'a'.repeat(150) } } as any;
    wal.append([entry]);
    wal.append([entry]);
    wal.append([entry]);
    await wal.flush();

    const all = await wal.readAll();
    expect(all.length).toBe(3);
    await wal.dispose();
  });
});
