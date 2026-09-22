/**
 * A heap that looked full because it was measured against itself.
 *
 * The memory indicator compared `heapUsed` with `heapTotal`. V8 grows
 * `heapTotal` to fit what is live plus a margin, so that ratio is the heap's
 * shape and stays high whatever the pressure. Measured in a plain Node
 * process: 70.4% for a fresh idle one holding 3.8 MB — `degraded` at the
 * default 0.7 — 85.1% at 378 MB, and 2.6% a moment after those 378 MB were
 * released. An omnitron node reported `degraded` at 79.1% with nothing wrong
 * with it.
 *
 * Pressure is how close the heap is to where allocation fails: V8's
 * `heap_size_limit`. These cases use the real limit of this process and a
 * stand-in `process.memoryUsage`, so each figure is the one V8 would report.
 */

import v8 from 'node:v8';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { MemoryHealthIndicator } from '../src/indicators/memory.indicator.js';

const LIMIT = v8.getHeapStatistics().heap_size_limit;
const MB = 1024 * 1024;

function heap(heapUsed: number, heapTotal: number) {
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    rss: heapTotal + 40 * MB,
    heapTotal,
    heapUsed,
    external: 2 * MB,
    arrayBuffers: 1 * MB,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('the memory indicator', () => {
  it('calls an idle process with a snugly committed heap healthy', async () => {
    // The first measurement above: 3.8 MB used of 5.4 MB committed, 70.4%.
    heap(3.8 * MB, 5.4 * MB);

    const result = await new MemoryHealthIndicator().check();

    expect(result.status).toBe('healthy');
    expect(result.message).toMatch(/^Memory usage is within normal limits \(0\.\d% of the [\d.]+ [MG]B heap limit\)$/);
  });

  it('calls a heap near its limit degraded, and says what it is a share of', async () => {
    heap(0.75 * LIMIT, 0.76 * LIMIT);

    const result = await new MemoryHealthIndicator().check();

    expect(result.status).toBe('degraded');
    expect(result.message).toMatch(/^Heap usage \(75\.0% of the [\d.]+ [MG]B heap limit\) exceeds degraded threshold$/);
    expect(result.details).toMatchObject({ heapUsedPercent: '75.0%' });
  });

  it('calls a heap at nine tenths of its limit unhealthy', async () => {
    heap(0.92 * LIMIT, 0.93 * LIMIT);

    const result = await new MemoryHealthIndicator().check();

    expect(result.status).toBe('unhealthy');
  });

  it('does not move with what V8 happens to have committed', async () => {
    // Same live heap, two shapes: freshly grown to fit it, and still large
    // from something just released. The pressure is the same.
    heap(100 * MB, 101 * MB);
    const snug = await new MemoryHealthIndicator().check();
    heap(100 * MB, 3_000 * MB);
    const roomy = await new MemoryHealthIndicator().check();

    expect([snug.status, roomy.status]).toEqual(['healthy', 'healthy']);
    expect(snug.details?.['heapUsedPercent']).toBe(roomy.details?.['heapUsedPercent']);
  });
});
