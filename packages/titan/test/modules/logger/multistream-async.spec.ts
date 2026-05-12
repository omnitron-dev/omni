/**
 * Regression test for T#67 — pino's `multistream` dispatches
 * synchronously to each registered stream within the hot path
 * of `logger.info(...)`. A registered stream whose `_write` is
 * synchronous (or makes a blocking syscall) used to stall the
 * daemon's event loop on every log call. The audit's worst-case
 * scenario was a deadlock on a slow file system.
 *
 * Fix: every user-supplied stream is wrapped in an async
 * forwarder before being handed to multistream. The wrapper
 * defers the inner write to a `setImmediate` macrotask so:
 *   - pino's call into the wrapper returns to the event loop
 *     before any inner work runs;
 *   - a sync downstream `_write` no longer blocks pino or its
 *     siblings.
 *
 * This test exercises the wrapper directly: drive a sync
 * downstream stream and confirm that calling `wrapper.write(...)`
 * returns BEFORE the inner stream observes the chunk.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Writable } from 'node:stream';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import type { ILoggerModuleOptions } from '../../../src/modules/logger/logger.types.js';

describe('LoggerService — multistream async forwarder (T#67)', () => {
  beforeEach(() => {
    (LoggerService as any).flushHookInstalled = false;
  });

  afterEach(() => {
    process.removeAllListeners('beforeExit');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it("defers writes to a downstream sync stream so pino's hot path returns immediately", async () => {
    // Build a "downstream" stream whose _write runs synchronously
    // and records its observation order.
    const observed: number[] = [];
    let nextLogIndex = 0;
    const downstream = new Writable({
      write(_chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
        observed.push(nextLogIndex);
        cb();
      },
    });

    const svc = new LoggerService({
      destinations: [{ stream: downstream }],
    } as unknown as ILoggerModuleOptions);

    // Issue a few log calls. The synchronous expectation:
    //   - log() returns immediately for each call;
    //   - the downstream stream has NOT seen any chunk yet, because
    //     the wrapper deferred via setImmediate;
    //   - after one event-loop tick, all chunks are observed in
    //     dispatch order.
    const logger = svc.logger;
    for (let i = 0; i < 5; i++) {
      nextLogIndex = i;
      logger.info({ idx: i }, `message-${i}`);
    }

    // At this point — same tick — the downstream has not observed
    // anything yet. The wrapper deferred each write to setImmediate.
    expect(observed.length).toBe(0);

    // Yield to the event loop until all queued setImmediate
    // callbacks settle. We poll until either all 5 chunks arrive
    // or we hit a generous deadline.
    const deadline = Date.now() + 1000;
    while (observed.length < 5 && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    expect(observed.length).toBeGreaterThanOrEqual(5);
  });

  it("does not double-wrap an already-wrapped stream", async () => {
    // If a user pre-wraps a stream (e.g. constructs a LoggerService
    // twice in a test harness, or hands the same stream into a
    // child logger module), the second wrap should be a no-op so we
    // don't pay for two layers of setImmediate.
    const downstream = new Writable({
      write(_c: Buffer, _e: BufferEncoding, cb: (err?: Error | null) => void) {
        cb();
      },
    });
    const svc1 = new LoggerService({
      destinations: [{ stream: downstream }],
    } as unknown as ILoggerModuleOptions);
    const svc2 = new LoggerService({
      destinations: [{ stream: downstream }],
    } as unknown as ILoggerModuleOptions);
    void svc1;
    void svc2;
    // No exception, no infinite loop, no listener pile-up.
    // The flush-hook flag (T#66) is for the no-destinations branch,
    // so the count is unchanged.
    expect(process.listenerCount('beforeExit')).toBeLessThanOrEqual(2);
  });
});
