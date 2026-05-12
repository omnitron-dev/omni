/**
 * Regression test for T#68 — `PostgresMetricsStorage` /
 * `SQLiteMetricsStorage` retried failed flushes by re-enqueueing
 * the full batch at the head of the buffer, with no upper bound.
 * During a sustained PG outage the buffer grew without limit:
 *
 *     write()     → buffer.push(...samples)
 *     flush()     → splice, insert FAILS, buffer.unshift(...batch)
 *     write()     → buffer.push(...newSamples)     (newer than the failed batch)
 *     flush()     → splice, insert FAILS, buffer.unshift(...batch)
 *     ...
 *
 * 5 s flush interval × 24 h outage × 100 samples/s ≈ 8.6 M samples
 * in memory. A typical sample is ~100 bytes; that's nearly 1 GB
 * just for the failure backlog — the daemon ran out of RAM long
 * before the operator noticed.
 *
 * Fix: cap the in-memory buffer at `maxBufferSize` (default 50k).
 * On overflow drop OLDEST samples (the failed-batch front of the
 * buffer) and report the cumulative dropped count via the optional
 * `onDrop` callback so the operator sees the data loss.
 */

import { describe, it, expect, vi } from 'vitest';
import { PostgresMetricsStorage, DAEMON_APP_LABEL } from '../src/index.js';
import type { MetricSample } from '../src/types.js';

function failingDb() {
  return {
    insertInto: () => ({
      values: () => ({
        execute: vi.fn().mockRejectedValue(new Error('connection refused')),
      }),
    }),
    selectFrom: () => ({}),
    deleteFrom: () => ({}),
    schema: { createTable: vi.fn(), createIndex: vi.fn() },
  } as any;
}

function smp(name: string, value: number): MetricSample {
  return { name, value, timestamp: Date.now(), labels: { app: 'main' } };
}

describe('PostgresMetricsStorage — bounded retry on flush failure (T#68)', () => {
  it('caps the buffer at maxBufferSize when the DB is down', async () => {
    const dropEvents: number[] = [];
    const storage = new PostgresMetricsStorage(failingDb(), {
      batchSize: 10_000_000, // disable size-driven auto-flush
      flushInterval: 60_000, // disable periodic flush in this test
      maxBufferSize: 100, // small cap so we hit it quickly
      onDrop: (n) => dropEvents.push(n),
    });

    // Write 250 samples — 150 over the cap.
    const batch: MetricSample[] = [];
    for (let i = 0; i < 250; i++) batch.push(smp('rpc_requests_total', i));
    await storage.write(batch);

    // Buffer must not exceed the cap.
    expect((storage as any).buffer.length).toBeLessThanOrEqual(100);

    // The onDrop callback fired with the dropped count.
    expect(dropEvents.length).toBeGreaterThan(0);
    const lastReport = dropEvents[dropEvents.length - 1]!;
    expect(lastReport).toBe(150);

    storage.dispose();
  });

  it('preserves NEWEST samples (drops oldest) when re-enqueueing a failed batch', async () => {
    const storage = new PostgresMetricsStorage(failingDb(), {
      batchSize: 10_000_000,
      flushInterval: 60_000,
      maxBufferSize: 5,
    });

    // 5 samples written, buffer at the cap.
    for (let i = 0; i < 5; i++) await storage.write([smp('a', i)]);
    expect((storage as any).buffer.length).toBe(5);

    // Manually trigger a flush — DB fails, batch re-enqueued at the
    // front, ENFORCEMENT drops oldest. But the buffer was already
    // at the cap, so all 5 originals come back through unshift, no
    // newer samples arrived in between, so cap stays at 5 with the
    // SAME samples (idempotent under outage with no new traffic).
    await (storage as any).flushBuffer();
    expect((storage as any).buffer.length).toBe(5);
    expect((storage as any).buffer.map((s: MetricSample) => s.value)).toEqual([0, 1, 2, 3, 4]);

    // Now write 5 NEW samples while the DB is still down.
    for (let i = 5; i < 10; i++) await storage.write([smp('a', i)]);
    // The cap was enforced on each write; the oldest 5 dropped to
    // make room for the newest 5.
    expect((storage as any).buffer.length).toBe(5);
    expect((storage as any).buffer.map((s: MetricSample) => s.value)).toEqual([5, 6, 7, 8, 9]);

    storage.dispose();
  });

  it('resets the dropped counter after a successful flush', async () => {
    let succeed = false;
    const db: any = {
      insertInto: () => ({
        values: () => ({
          execute: vi.fn(async () => {
            if (!succeed) throw new Error('down');
          }),
        }),
      }),
      selectFrom: () => ({}),
      deleteFrom: () => ({}),
    };

    const storage = new PostgresMetricsStorage(db, {
      batchSize: 10_000_000,
      flushInterval: 60_000,
      maxBufferSize: 3,
    });

    // Phase 1: outage. Push enough to overflow.
    for (let i = 0; i < 10; i++) await storage.write([smp('a', i)]);
    expect((storage as any).droppedDuringOutage).toBeGreaterThan(0);

    // Phase 2: DB recovers; manual flush drains and clears counter.
    succeed = true;
    await (storage as any).flushBuffer();
    expect((storage as any).buffer.length).toBe(0);
    expect((storage as any).droppedDuringOutage).toBe(0);

    storage.dispose();
  });

  it('daemon-scoped samples (T#63) participate in the same cap', async () => {
    const storage = new PostgresMetricsStorage(failingDb(), {
      batchSize: 10_000_000,
      flushInterval: 60_000,
      maxBufferSize: 5,
    });
    // Mix of app samples and daemon-scoped (no app label) samples.
    for (let i = 0; i < 10; i++) {
      await storage.write([{ name: 'd', value: i, timestamp: Date.now(), labels: {} }]);
    }
    expect((storage as any).buffer.length).toBe(5);
    // All surviving samples were normalised to __daemon__.
    expect(
      (storage as any).buffer.every((s: MetricSample) => s.labels.app === DAEMON_APP_LABEL),
    ).toBe(true);
    storage.dispose();
  });
});
