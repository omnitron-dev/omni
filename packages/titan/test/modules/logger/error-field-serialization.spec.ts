/**
 * Error fields reach the log with their cause intact.
 *
 * pino binds a serializer to a FIELD NAME, and `pino.stdSerializers` defines
 * only `err`. Every `logger.error({ error: someError }, ...)` therefore landed
 * as `{"error":{}}` — Error's own properties are non-enumerable, so plain JSON
 * serialisation empties it. The failure was reported and the cause discarded,
 * which is the worse half of a silent failure: the log still looks like it
 * says something.
 *
 * Measured before the fix: 167 call sites in this monorepo pass `error:` or
 * `cause:` holding a real Error.
 */

import 'reflect-metadata';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Writable } from 'node:stream';

import { LoggerService } from '../../../src/modules/logger/logger.service.js';
import type { ILoggerModuleOptions } from '../../../src/modules/logger/logger.types.js';

/**
 * Wait until the capture stream HAS the record, rather than for a fixed
 * interval.
 *
 * User-supplied destinations are deliberately wrapped in an async forwarder
 * (`wrapAsyncStream`, T#67) so a slow sink cannot stall pino's hot path: every
 * write is deferred by a `setImmediate`, on top of pino's own buffering. A
 * fixed 10 ms sleep was enough on an idle machine and not enough inside the
 * full suite, where this file shares CPU with a hundred others — the test
 * passed alone and failed in company, which is the most convincing possible
 * argument for not fixing it.
 */
async function waitForLine(
  lines: () => any[],
  msg: string,
  timeoutMs = 5000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rec = lines().find((l) => l && l.msg === msg);
    if (rec) return rec;
    if (Date.now() > deadline) {
      throw new Error(`no log line with msg=${JSON.stringify(msg)} after ${timeoutMs} ms`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

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

describe('logger error-field serialization', () => {
  afterEach(() => {
    process.removeAllListeners('beforeExit');
    vi.restoreAllMocks();
  });

  for (const field of ['err', 'error', 'cause'] as const) {
    it(`carries message and stack through the \`${field}\` field`, async () => {
      const cap = captureStream();
      const svc = new LoggerService({ destinations: [{ stream: cap.stream }] } as unknown as ILoggerModuleOptions);

      svc.logger.error({ [field]: new Error('boom') }, 'it failed');

      const rec = await waitForLine(cap.lines, 'it failed');
      expect(rec[field], `\`${field}\` was dropped entirely`).toBeTruthy();
      expect(rec[field]).toMatchObject({ type: 'Error', message: 'boom' });
      expect(String(rec[field].stack)).toContain('boom');
    });
  }

  it('leaves a non-Error value in those fields untouched', async () => {
    // Many call sites pass an already-stringified message, or a plain object.
    // Aliasing the serializer must not rewrite those.
    const cap = captureStream();
    const svc = new LoggerService({ destinations: [{ stream: cap.stream }] } as unknown as ILoggerModuleOptions);

    svc.logger.error({ error: 'plain message' }, 'string case');
    svc.logger.error({ cause: { code: 'E_LIMIT', retryable: false } }, 'object case');

    expect((await waitForLine(cap.lines, 'string case')).error).toBe('plain message');
    expect((await waitForLine(cap.lines, 'object case')).cause).toEqual({
      code: 'E_LIMIT',
      retryable: false,
    });
  });
});
