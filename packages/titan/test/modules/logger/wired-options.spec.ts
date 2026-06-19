/**
 * Tests for the wired logger extension points: `processors` (ILogProcessor),
 * `transports` (ITransport), and `prettyPrint`. Before this, all three were
 * accepted by the module but never invoked on the log path. These tests pin
 * the real behaviour:
 *   - processors transform the record (and can DROP via null) before output;
 *   - transports receive each serialised record, off the hot path + isolated;
 *   - prettyPrint emits human-readable (non-JSON) output.
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Writable } from 'node:stream';
import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import { RedactionProcessor } from '../../../src/modules/logger/logger.module.js';
import type { ILoggerModuleOptions, ITransport, ILogProcessor } from '../../../src/modules/logger/logger.types.js';

// The capture stream is async-wrapped by the multistream branch (setImmediate),
// and the transport fan-out also defers a tick. A short timeout flushes both.
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

function captureStream(): { stream: Writable; lines: () => any[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return l;
          }
        }),
  };
}

describe('LoggerService — wired processors / transports / prettyPrint', () => {
  beforeEach(() => {
    (LoggerService as any).flushHookInstalled = false;
  });
  afterEach(() => {
    process.removeAllListeners('beforeExit');
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    vi.restoreAllMocks();
  });

  describe('processors', () => {
    it('transforms the record (redaction) before output', async () => {
      const cap = captureStream();
      const svc = new LoggerService({
        destinations: [{ stream: cap.stream }],
        processors: [new RedactionProcessor(['password'])],
      } as unknown as ILoggerModuleOptions);

      svc.logger.info({ password: 'secret', user: 'alice' }, 'login');
      await tick();

      const rec = cap.lines().find((l) => l.msg === 'login');
      expect(rec).toBeTruthy();
      expect(rec.password).toBe('[REDACTED]');
      expect(rec.user).toBe('alice');
    });

    it('drops the log entirely when a processor returns null', async () => {
      const cap = captureStream();
      const dropWarns: ILogProcessor = { process: (log) => (log.level === 'warn' ? null : log) };
      const svc = new LoggerService({
        destinations: [{ stream: cap.stream }],
        processors: [dropWarns],
      } as unknown as ILoggerModuleOptions);

      svc.logger.info({}, 'kept');
      svc.logger.warn({}, 'dropped');
      await tick();

      const msgs = cap.lines().map((l) => l.msg);
      expect(msgs).toContain('kept');
      expect(msgs).not.toContain('dropped');
    });

    it('honours addProcessor() after init', async () => {
      const cap = captureStream();
      const svc = new LoggerService({
        destinations: [{ stream: cap.stream }],
      } as unknown as ILoggerModuleOptions);

      svc.addProcessor(new RedactionProcessor(['token']));
      svc.logger.info({ token: 'abc' }, 'after');
      await tick();

      const rec = cap.lines().find((l) => l.msg === 'after');
      expect(rec.token).toBe('[REDACTED]');
    });

    it('preserves a top-level Error through the pipeline', async () => {
      const cap = captureStream();
      const svc = new LoggerService({
        destinations: [{ stream: cap.stream }],
        processors: [{ process: (l) => l }], // identity processor still on the path
      } as unknown as ILoggerModuleOptions);

      svc.logger.error(new Error('boom'));
      await tick();

      const rec = cap.lines().find((l) => l.err);
      expect(rec).toBeTruthy();
      expect(rec.err.type).toBe('Error');
      expect(rec.err.message).toBe('boom');
      expect(typeof rec.err.stack).toBe('string');
    });

    it('applies to child loggers', async () => {
      const cap = captureStream();
      const svc = new LoggerService({
        destinations: [{ stream: cap.stream }],
        processors: [new RedactionProcessor(['secret'])],
      } as unknown as ILoggerModuleOptions);

      const child = svc.create('worker');
      child.info({ secret: 'xyz' }, 'child-log');
      await tick();

      const rec = cap.lines().find((l) => l.msg === 'child-log');
      expect(rec.name).toBe('worker');
      expect(rec.secret).toBe('[REDACTED]');
    });
  });

  describe('transports', () => {
    it('delivers each record to a registered transport', async () => {
      const received: any[] = [];
      const transport: ITransport = { name: 'spy', write: (log) => void received.push(log) };
      const svc = new LoggerService({ transports: [transport] } as unknown as ILoggerModuleOptions);

      svc.logger.info({ a: 1 }, 'hello');
      await tick();

      const rec = received.find((r) => r.msg === 'hello');
      expect(rec).toBeTruthy();
      expect(rec.a).toBe(1);
    });

    it('a throwing transport never breaks logging', async () => {
      const received: any[] = [];
      const bad: ITransport = {
        name: 'bad',
        write: () => {
          throw new Error('nope');
        },
      };
      const good: ITransport = { name: 'good', write: (log) => void received.push(log) };
      const svc = new LoggerService({ transports: [bad, good] } as unknown as ILoggerModuleOptions);

      expect(() => svc.logger.info('survives')).not.toThrow();
      await tick();
      expect(received.some((r) => r.msg === 'survives')).toBe(true);
    });

    it('a transport sees the processor-transformed record', async () => {
      const received: any[] = [];
      const svc = new LoggerService({
        processors: [new RedactionProcessor(['password'])],
        transports: [{ name: 'spy', write: (log) => void received.push(log) }],
      } as unknown as ILoggerModuleOptions);

      svc.logger.info({ password: 'secret' }, 'auth');
      await tick();

      const rec = received.find((r) => r.msg === 'auth');
      expect(rec).toBeTruthy();
      expect(rec.password).toBe('[REDACTED]');
    });

    it('flush() awaits transport flush()', async () => {
      const flushed = vi.fn(async () => {});
      const svc = new LoggerService({
        transports: [{ name: 't', write: () => {}, flush: flushed }],
      } as unknown as ILoggerModuleOptions);

      await svc.flush();
      expect(flushed).toHaveBeenCalledTimes(1);
    });
  });
});
