/**
 * prettyPrint wiring test.
 *
 * pino-pretty writes to fd 1 via SonicBoom (it does NOT call
 * `process.stdout.write`), so its rendered output can't be captured by spying
 * stdout in-process. The rendering itself is pino-pretty's (a tested 3rd-party
 * lib) job; what this suite pins is that LoggerService ROUTES through the
 * pino-pretty branch when prettyPrint is enabled and through the async-stdout
 * branch otherwise.
 *
 * The observable signal: the bare-stdout async-destination branch (T#66)
 * installs a process-exit flush hook; the pino-pretty branch does not (pretty
 * manages its own stdout writer). So a missing flush hook under prettyPrint is
 * proof the pino-pretty branch was taken instead of the JSON async-stdout path.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import type { ILoggerModuleOptions } from '../../../src/modules/logger/logger.types.js';

describe('LoggerService — prettyPrint branch routing', () => {
  beforeEach(() => {
    (LoggerService as any).flushHookInstalled = false;
  });
  afterEach(() => {
    process.removeAllListeners('beforeExit');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('takes the pino-pretty branch (no async-stdout flush hook) when enabled', () => {
    const before = process.listenerCount('beforeExit');
    const svc = new LoggerService({ prettyPrint: true } as unknown as ILoggerModuleOptions);
    void svc;
    // pino-pretty manages its own fd-1 writes, so the T#66 async-destination
    // flush hook is NOT installed — proof we left the JSON async-stdout path.
    expect(process.listenerCount('beforeExit')).toBe(before);
  });

  it('takes the async-stdout (JSON) branch + installs the flush hook when off', () => {
    const before = process.listenerCount('beforeExit');
    const svc = new LoggerService({} as ILoggerModuleOptions);
    void svc;
    expect(process.listenerCount('beforeExit')).toBe(before + 1);
  });

  it('logging through prettyPrint does not throw', () => {
    const svc = new LoggerService({ prettyPrint: true } as unknown as ILoggerModuleOptions);
    expect(() => {
      svc.logger.info('pretty-line');
      svc.logger.error(new Error('pretty-error'));
    }).not.toThrow();
  });
});
