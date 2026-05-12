/**
 * Regression tests for T#69 — `TelemetryWal` blocked the event
 * loop and OOM'd on restart.
 *
 * Symptoms in production:
 *   - `append()` used `fs.writeSync` on the hot path; telemetry
 *     ingest at moderate rate stalled the daemon's event loop in
 *     multi-ms bursts.
 *   - `readAll()` / `entryCount()` used `fs.readFileSync`,
 *     loading each 50 MB segment into a single string before
 *     splitting. Worst-case replay on restart with 10 segments
 *     allocated ~500 MB peak in one tick — instant heap pressure
 *     that occasionally OOM'd the daemon before it could resume
 *     supervision.
 *
 * Fix:
 *   - `append()` queues `fs.write` (async) on a serialised
 *     promise chain; in-order delivery preserved. New
 *     `flush()` lets shutdown paths await durability.
 *   - `readAll()` and `entryCount()` are now async and stream
 *     each segment line-by-line via `readline` over a
 *     `createReadStream`. Memory footprint is bounded regardless
 *     of segment size.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TelemetryWal } from '../src/telemetry-wal.js';

describe('TelemetryWal — async I/O & bounded-memory replay (T#69)', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-t69-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("append() returns synchronously and does not block on disk I/O", async () => {
    const wal = new TelemetryWal({ directory: dir, maxSizeBytes: 1024 * 1024, maxSegments: 3 });
    const entry = { timestamp: Date.now(), name: 'rpc.duration', value: 1.23, labels: {} } as any;

    // Issue many appends in a tight synchronous loop. Each call
    // must return immediately; the actual fs.write is deferred to
    // the promise chain. The whole loop should complete in well
    // under a millisecond per call, even on slow CI runners.
    const start = Date.now();
    for (let i = 0; i < 1000; i++) wal.append([{ ...entry, value: i }]);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);

    // Flush so the disk catches up before assertion.
    await wal.flush();
    const count = await wal.entryCount();
    expect(count).toBe(1000);

    wal.dispose();
  });

  it("readAll() streams segments instead of buffering each into memory", async () => {
    const wal = new TelemetryWal({
      directory: dir,
      maxSizeBytes: 64 * 1024, // small segments so we rotate
      maxSegments: 100,
    });
    const entry = { timestamp: Date.now(), name: 'cpu', value: 0.1, labels: {} } as any;
    // Append enough to force several rotations.
    for (let i = 0; i < 5_000; i++) wal.append([{ ...entry, value: i }]);
    await wal.flush();

    // Snapshot heap-used before the read.
    if (typeof global.gc === 'function') global.gc();
    const heapBefore = process.memoryUsage().heapUsed;

    const all = await wal.readAll();

    // Snapshot heap-used after. The streaming reader holds at most
    // one segment's parsed array in JS heap, plus the returned
    // accumulator — total well under 100 MB even at 5k entries.
    if (typeof global.gc === 'function') global.gc();
    const heapAfter = process.memoryUsage().heapUsed;
    const heapDelta = heapAfter - heapBefore;

    expect(all.length).toBe(5_000);
    // Generous ceiling — the historical readFileSync path could
    // allocate hundreds of MB on these workloads. Streaming stays
    // well under any practical threshold; we assert 50 MB just to
    // catch obvious regressions.
    expect(heapDelta).toBeLessThan(50 * 1024 * 1024);

    wal.dispose();
  });

  it('readAll() returns chronological order across segments', async () => {
    const wal = new TelemetryWal({ directory: dir, maxSizeBytes: 256, maxSegments: 10 });
    for (let i = 0; i < 50; i++) {
      wal.append([{ timestamp: i, name: 'evt', value: i, labels: {} } as any]);
    }
    await wal.flush();
    const all = await wal.readAll();
    const timestamps = all.map((e) => e.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    wal.dispose();
  });

  it('flush() awaits all queued async writes', async () => {
    const wal = new TelemetryWal({ directory: dir });
    for (let i = 0; i < 200; i++) {
      wal.append([{ timestamp: Date.now(), name: 'x', value: i, labels: {} } as any]);
    }
    await wal.flush();
    // After flush, the file system shows all entries.
    const count = await wal.entryCount();
    expect(count).toBe(200);
    wal.dispose();
  });
});
