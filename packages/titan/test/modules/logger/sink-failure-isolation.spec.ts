import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import { LogSinkGuard } from '../../../src/modules/logger/sink-guard.js';
const full = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
const turn = () => new Promise(resolve => setImmediate(resolve));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('log destination failure isolation', () => {
  it('keeps healthy sync and async journals receiving records when a synchronous sink throws', async () => {
    const accepted: string[] = [];
    const bad = Object.assign(new EventEmitter(), { write: () => { throw full; } });
    const good = new Writable({ write(chunk, _encoding, done) { if (chunk.length) accepted.push(String(chunk)); done(); } });
    const service = new LoggerService({ destinations: [{ stream: bad as unknown as NodeJS.WritableStream, delivery: 'sync' }, { stream: good, delivery: 'sync' }] });
    expect(() => service.child({ component: 'test' }).info('still delivered')).not.toThrow();
    expect(accepted).toHaveLength(1);
    await expect(service.flush()).rejects.toThrow('Logger delivery could not be confirmed');
    expect(service.getSinkHealth().find(item => item.name === 'destination:0')).toMatchObject({ failedWrites: 1, error: full.message });
  });

  it('contains callback and emitted stream errors instead of creating an unhandled error event', async () => {
    const bad = new Writable({ write(_chunk, _encoding, done) { done(full); } });
    const guard = new LogSinkGuard('fixture', bad, true);
    guard.write('record\n'); await turn(); await turn();
    expect(guard.health().failedWrites).toBe(1);
    await expect(guard.confirm()).rejects.toThrow('delivery is incomplete');
  });

  it('bounds retry frequency and queue bytes, recovers future delivery without replaying ambiguous records', async () => {
    let fail = true; const writes: string[] = [];
    const sink = Object.assign(new EventEmitter(), { write(value: Buffer) { if (fail) throw full; writes.push(String(value)); return true; } });
    const guard = new LogSinkGuard('fixture', sink as unknown as NodeJS.WritableStream, false);
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    guard.write('failed'); guard.write('suppressed');
    expect(guard.health()).toMatchObject({ failedWrites: 1, droppedBytes: 10 });
    fail = false; now.mockReturnValue(2100); guard.write('recovered');
    expect(writes).toEqual(['recovered']);
    expect(guard.health().error).toBeNull();
    await expect(guard.confirm()).rejects.toThrow('unconfirmed bytes');
    guard.write(Buffer.alloc(2 * 1024 * 1024));
    expect(guard.health().pendingBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(guard.health().droppedBytes).toBeGreaterThanOrEqual(2 * 1024 * 1024);
  });

  it('records an asynchronous host stdout error while the healthy destination still receives its record', async () => {
    const accepted: string[] = [];
    const stdout = Object.assign(new EventEmitter(), { write() { return true; }, flush(done: () => void) { done(); } });
    vi.spyOn(pino, 'destination').mockReturnValue(stdout as unknown as ReturnType<typeof pino.destination>);
    const journal = new Writable({ write(chunk, _encoding, done) { accepted.push(String(chunk)); done(); } });
    const service = new LoggerService({ destinations: [{ stream: journal, delivery: 'sync' }] });
    expect(() => service.logger.info('one')).not.toThrow();
    stdout.emit('error', full);
    expect(accepted).toHaveLength(1);
    expect(JSON.parse(accepted[0]!).msg).toBe('one');
    expect(service.getSinkHealth().find(item => item.name === 'stdout')).toMatchObject({ failedWrites: 1, error: full.message });
    await expect(service.flush()).rejects.toThrow('Logger delivery could not be confirmed');
  });

  it('a rejected transport cannot suppress healthy siblings and remains visible at flush', async () => {
    const good = vi.fn();
    const service = new LoggerService({ transports: [{ name: 'bad', write: () => Promise.reject(full) }, { name: 'good', write: good }] });
    service.logger.info('transport record');
    await expect(service.flush()).rejects.toThrow('Logger delivery could not be confirmed');
    expect(good).toHaveBeenCalledTimes(1);
    expect(service.getSinkHealth().find(item => item.name === 'transport:bad')).toMatchObject({ failedWrites: 1, error: full.message });
  });

  it('does not enqueue more underlying writes after a sink times out until that write settles', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const write = vi.fn((_chunk, _encoding, done) => { release = done; });
    const guard = new LogSinkGuard('stalled', new Writable({ write }), false);
    guard.write('one');
    await vi.advanceTimersByTimeAsync(30_001);
    await vi.advanceTimersByTimeAsync(30_001);
    guard.write('two');
    expect(write).toHaveBeenCalledTimes(1);
    expect(guard.health().droppedBytes).toBe(3);
    release();
    guard.write('three');
    expect(write).toHaveBeenCalledTimes(2);
    release();
    await expect(guard.confirm()).rejects.toThrow('unconfirmed bytes');
  });

});
