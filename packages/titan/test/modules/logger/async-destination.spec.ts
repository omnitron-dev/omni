/**
 * Regression tests for T#66 — `LoggerService.onModuleInit` used
 * `pino(pinoOptions)` with no second argument, which defaults
 * to a SYNCHRONOUS stdout destination in pino 7+. Every
 * `logger.info(...)` call became a blocking `write()` syscall.
 * On a daemon that logs heavily, or whose stdout is piped to a
 * slow consumer (file, network, sluggish terminal), each call
 * added milliseconds of event-loop pause that compounded into
 * seconds of stall.
 *
 * Fix: when no destinations are configured, build pino with an
 * explicit async destination (`pino.destination({ dest: 1, sync:
 * false })`). On process exit (clean termination, SIGTERM,
 * SIGINT) call `destination.flushSync()` so the last buffered
 * batch isn't lost. SIGKILL still drops unflushed lines —
 * there's no user-space recovery for that.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import type { ILoggerModuleOptions } from '../../../src/modules/logger/logger.types.js';

// We can't trivially observe pino's internal "sync vs async" mode
// from the outside without leaning on its private fields. Instead
// we test the OBSERVABLE consequence of T#66: when no
// `destinations` are supplied, the LoggerService installs a
// process-exit hook so buffered lines are flushed on graceful
// termination. The hook's existence is the strong signal that we
// went down the async path.

function fakeConfigService(): any {
  return undefined; // exercise the default-config branch
}

describe('LoggerService — async stdout destination + flush hook (T#66)', () => {
  beforeEach(() => {
    // Reset the static flushHookInstalled flag so each test gets
    // a fresh "first init" condition.
    (LoggerService as any).flushHookInstalled = false;
  });

  afterEach(() => {
    // Don't leave dangling listeners on the test runner's process.
    process.removeAllListeners('beforeExit');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('installs a process-exit flush hook on the FIRST init with no destinations', async () => {
    const before = {
      beforeExit: process.listenerCount('beforeExit'),
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    };

    const svc = new LoggerService({} as ILoggerModuleOptions);

    expect(process.listenerCount('beforeExit')).toBe(before.beforeExit + 1);
    expect(process.listenerCount('SIGTERM')).toBe(before.sigterm + 1);
    expect(process.listenerCount('SIGINT')).toBe(before.sigint + 1);
  });

  it('does NOT install the flush hook a second time (idempotent across re-inits)', () => {
    const svc1 = new LoggerService({} as ILoggerModuleOptions);
    void svc1;
    const after1 = {
      beforeExit: process.listenerCount('beforeExit'),
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    };

    const svc2 = new LoggerService({} as ILoggerModuleOptions);
    void svc2;
    expect(process.listenerCount('beforeExit')).toBe(after1.beforeExit);
    expect(process.listenerCount('SIGTERM')).toBe(after1.sigterm);
    expect(process.listenerCount('SIGINT')).toBe(after1.sigint);
  });

  it('does NOT install the flush hook when explicit destinations are provided', async () => {
    // The multistream branch is responsible for its own write
    // semantics — the LoggerService should not add the
    // single-destination flush hook on top.
    const before = process.listenerCount('beforeExit');
    const fakeStream: any = {
      write: vi.fn((_d: any, cb: any) => cb?.()),
    };
    const svc = new LoggerService(
      { destinations: [{ stream: fakeStream }] } as unknown as ILoggerModuleOptions,
    );
    expect(process.listenerCount('beforeExit')).toBe(before);
  });
});
