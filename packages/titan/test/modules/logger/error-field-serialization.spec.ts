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
      await tick();

      const rec = cap.lines().find((l) => l.msg === 'it failed');
      expect(rec, 'no log line was written').toBeTruthy();
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
    await tick();

    const lines = cap.lines();
    expect(lines.find((l) => l.msg === 'string case').error).toBe('plain message');
    expect(lines.find((l) => l.msg === 'object case').cause).toEqual({
      code: 'E_LIMIT',
      retryable: false,
    });
  });
});
