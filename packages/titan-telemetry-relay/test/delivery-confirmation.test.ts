import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TelemetryRelayService, TelemetryWal, type TelemetryEntry } from '../src/index.js';

const entry = (id: string): TelemetryEntry => ({ id, type: 'log', timestamp: '2026-01-01T00:00:00Z', nodeId: 'test', data: {} });
const transport = (send: (batch: TelemetryEntry[]) => Promise<number>) => ({
  send, isConnected: () => true, connect: async () => {}, disconnect: async () => {},
});
let directory: string;
beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'relay-confirmation-')); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });

describe('delivery confirmation', () => {
  it.each([undefined, null, NaN, -1, 0.5, 1, 3])('retains the original WAL after ack %s and recovers on restart', async ack => {
    const first = new TelemetryRelayService({ role: 'producer', nodeId: 'test', wal: { directory },
      transport: transport(async entries => { entries.pop(); return ack as number; }) });
    first.record(entry('one')); first.record(entry('two'));
    await first.stop();
    expect(first.stats()).toMatchObject({ totalSent: 0, totalFailed: 2, lastError: expect.stringMatching(/acknowledgement/) });
    const sent = vi.fn(async (batch: TelemetryEntry[]) => batch.length);
    const next = new TelemetryRelayService({ role: 'producer', nodeId: 'test', wal: { directory }, transport: transport(sent) });
    await next.start(); await next.stop();
    expect(sent.mock.calls[0]![0].map(e => e.id)).toEqual(['one', 'two']);
    expect(next.stats().totalSent).toBe(2);
  });

  it('retains entries when no trusted transport is available and serializes new appends behind a replay', async () => {
    const first = new TelemetryRelayService({ role: 'producer', nodeId: 'test', wal: { directory } });
    first.record(entry('first')); await first.stop();
    let release!: () => void, begun!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { begun = resolve; });
    const calls: string[][] = [];
    const next = new TelemetryRelayService({ role: 'producer', nodeId: 'test', wal: { directory },
      transport: transport(async batch => {
        calls.push(batch.map(e => e.id!));
        if (calls.length === 1) { begun(); await blocked; }
        return batch.length;
      }) });
    const startup = next.start(); await started;
    next.record(entry('during-send'));
    const stop = next.stop(); release();
    await Promise.all([startup, stop]);
    expect(calls).toEqual([['first'], ['during-send']]);
    expect(next.stats().totalSent).toBe(2);
  });

  it('flushes bounded batches on shutdown and exposes a consumer failure with WAL disabled', async () => {
    const relay = new TelemetryRelayService({ role: 'both', wal: false, buffer: { maxBatchSize: 2 } });
    const consume = vi.fn(async (_node: string, batch: TelemetryEntry[]) => batch.length);
    consume.mockRejectedValueOnce(new Error('commit unavailable'));
    relay.setAggregator({ ingest: consume, query: async () => [] });
    for (let i = 0; i < 5; i++) relay.record(entry(String(i)));
    await expect(relay.stop()).rejects.toThrow('commit unavailable');
    expect(relay.stats()).toMatchObject({ totalSent: 0, buffer: { size: 5 }, lastError: 'commit unavailable' });
    await relay.stop();
    expect(consume.mock.calls.map(([, batch]) => batch.map(e => e.id))).toEqual([['0', '1'], ['0', '1'], ['2', '3'], ['4']]);
    expect(relay.stats().totalSent).toBe(5);
  });

  it('preserves malformed WAL records across a replay and reports the read failure', async () => {
    const file = path.join(directory, '000001.wal');
    const bytes = JSON.stringify(entry('one')) + '\n{"incomplete"\n';
    writeFileSync(file, bytes);
    const consume = vi.fn(async (batch: TelemetryEntry[]) => batch.length);
    const relay = new TelemetryRelayService({ wal: { directory }, role: 'producer', transport: transport(consume) });
    await relay.start(); await relay.stop();
    expect(consume).not.toHaveBeenCalled();
    expect(relay.stats()).toMatchObject({ totalSent: 0, lastError: expect.any(String) });
    expect(readFileSync(file, 'utf8')).toBe(bytes);
  });

  it('preserves an append queued after clearing the previous batch', async () => {
    const wal = new TelemetryWal({ directory });
    wal.append([entry('acknowledged')]); wal.clear(); wal.append([entry('unconfirmed')]);
    expect((await wal.readAll()).map(e => e.id)).toEqual(['unconfirmed']);
    await wal.dispose();
  });

  it('counts capacity evictions separately from acknowledgements', async () => {
    const relay = new TelemetryRelayService({ role: 'producer', wal: { directory, maxSizeBytes: 16, maxSegments: 1 },
      buffer: { maxBatchSize: 1 } });
    relay.record(entry('old')); relay.record(entry('new'));
    await relay.stop();
    expect(relay.stats()).toMatchObject({ totalSent: 0, wal: { evictedSegments: 1 } });
    expect(relay.stats().wal!.evictedBytes).toBeGreaterThan(0);
    const recovered = new TelemetryWal({ directory });
    expect((await recovered.readAll()).map(item => item.id)).toEqual(['new']);
    await recovered.dispose();
  });

  it('retains the buffered original after a disk error and retries it after storage recovers', async () => {
    const sink = vi.fn(async (batch: TelemetryEntry[]) => batch.length);
    const relay = new TelemetryRelayService({ transport: transport(sink), wal: { directory } });
    rmSync(directory, { recursive: true });
    relay.record(entry('retry'));
    await expect(relay.stop()).rejects.toThrow(/ENOENT/);
    expect(sink).not.toHaveBeenCalled();
    expect(relay.stats()).toMatchObject({ totalSent: 0, buffer: { size: 1 }, lastError: expect.stringMatching(/ENOENT/) });
    mkdirSync(directory);
    await relay.stop();
    expect(sink.mock.calls[0]![0].map(item => item.id)).toEqual(['retry']);
  });

  it('binds every accepted entry to its authenticated source', async () => {
    const relay = new TelemetryRelayService({ role: 'aggregator' });
    const ingest = vi.fn(async (_peer: string, batch: TelemetryEntry[]) => batch.length);
    relay.setAggregator({ ingest, query: async () => [] });
    await expect(relay.receive('test', [entry('own'), { ...entry('spoofed'), nodeId: 'other' }])).rejects.toThrow('source identity mismatch');
    expect(ingest).not.toHaveBeenCalled();
    expect(relay.stats()).toMatchObject({ totalReceived: 0, totalFailed: 2 });
    await relay.stop();
  });

  it('reports stranded records on startup and resumes when a local destination becomes available', async () => {
    const first = new TelemetryRelayService({ role: 'producer', nodeId: 'test', wal: { directory } });
    first.record(entry('offline')); await first.stop();
    const next = new TelemetryRelayService({ role: 'both', nodeId: 'test', wal: { directory } });
    await next.start();
    expect(next.stats()).toMatchObject({ totalSent: 0, lastError: 'No telemetry destination configured' });
    const ingest = vi.fn(async (_peer: string, batch: TelemetryEntry[]) => batch.length);
    next.setAggregator({ ingest, query: async () => [] });
    await next.stop();
    expect(ingest.mock.calls[0]![1].map(item => item.id)).toEqual(['offline']);
    expect(next.stats()).toMatchObject({ totalSent: 1, lastError: null });
  });
});
