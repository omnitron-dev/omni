import { describe, it, expect, vi } from 'vitest';
import { MetricsService } from '../src/metrics.service.js';
import { MemoryMetricsStorage } from '../src/storage.js';
import type { MetricSample } from '../src/types.js';

const sample = (value: number): MetricSample => ({ name: 'cpu', value, timestamp: Date.now(), labels: { app: 'api' } });

describe('one bounded queue and an awaited write boundary', () => {
  it('waits for in-flight and queued writes, retries the same identities and keeps loss evidence', async () => {
    const storage = new MemoryMetricsStorage();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const batches: MetricSample[][] = [];
    let attempt = 0;
    vi.spyOn(storage, 'write').mockImplementation(async batch => {
      batches.push(batch);
      if (++attempt === 1) await gate;
      if (attempt === 2) throw new Error('database unavailable');
    });
    const errors = vi.fn();
    const svc = new MetricsService({ appName: 'test', collection: { enabled: false }, onError: errors,
      storage: { type: 'memory', batchSize: 2, maxBufferSize: 4 } }, storage);
    svc.recordBatch([sample(1), sample(2)]);
    svc.recordBatch([sample(3), sample(4), sample(5)]);
    let finished = false;
    const pending = svc.flush().finally(() => { finished = true; });
    const refusal = expect(pending).rejects.toThrow('database unavailable');
    await Promise.resolve();
    expect(finished).toBe(false);
    expect(svc.getStorageStatus()).toMatchObject({ pendingSamples: 4, writing: true, droppedSamples: 1, writtenSamples: 0 });
    release();
    await refusal;
    expect(svc.getStorageStatus()).toMatchObject({ pendingSamples: 2, failedWrites: 1, lastError: 'database unavailable' });
    await svc.stop();
    expect(batches[2]!.map(s => s.id)).toEqual(batches[1]!.map(s => s.id));
    expect(svc.getStorageStatus()).toMatchObject({ pendingSamples: 0, pendingBytes: 0, writtenSamples: 4, droppedSamples: 1, lastError: null });
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('bounds UTF-8 bytes and exposes rejected samples without an unhandled rejection', async () => {
    const storage = new MemoryMetricsStorage();
    vi.spyOn(storage, 'write').mockRejectedValue(new Error('offline'));
    const svc = new MetricsService({ appName: 'test', collection: { enabled: false },
      storage: { type: 'memory', maxBufferBytes: 300, batchSize: 1 } }, storage);
    svc.record(sample(1));
    await vi.waitFor(() => expect(svc.getStorageStatus().failedWrites).toBe(1));
    svc.record({ ...sample(2), labels: { text: 'я'.repeat(1000) } });
    expect(svc.getStorageStatus().pendingBytes).toBeLessThanOrEqual(300);
    expect(svc.getStorageStatus().droppedSamples).toBe(1);
    await expect(svc.recordDurable([sample(3)])).rejects.toThrow('cannot confirm durable');
  });

  it('does not retry committed storage when a notification fails', async () => {
    const storage = new MemoryMetricsStorage();
    const write = vi.spyOn(storage, 'write');
    const svc = new MetricsService({ appName: 'test', collection: { enabled: false }, sync: {
      enabled: true, onFlush: async () => { throw new Error('notification unavailable'); },
    } }, storage);
    svc.record(sample(1));
    await svc.flush();
    await svc.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(svc.getStorageStatus()).toMatchObject({ pendingSamples: 0, syncError: 'notification unavailable' });
  });
});
