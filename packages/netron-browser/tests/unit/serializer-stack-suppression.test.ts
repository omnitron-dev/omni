/**
 * NB-1 regression — the browser packet serializer must NOT transmit error stack
 * traces to the server by default (it occasionally encodes errors toward the
 * server, e.g. rejected stream callbacks). This mirrors the titan server
 * serializer's T#38 suppression policy. Opt-in remains available for dev tools.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';
import { serializer, setSerializerErrorOptions } from '../../src/packet/serializer.js';
import { TitanError } from '../../src/errors/core.js';
import { ErrorCode } from '../../src/errors/codes.js';

const SENDER_FRAME = 'UNIQUE_SENDER_FRAME_NB1';

function roundTrip(err: TitanError): any {
  const buf = new SmartBuffer();
  serializer.encode(err, buf);
  buf.roffset = 0;
  return serializer.decode(buf);
}

describe('Browser packet serializer — stack-trace suppression (NB-1)', () => {
  afterEach(() => setSerializerErrorOptions({ includeStackTraces: false }));

  it('does NOT transmit the original sender stack by default', () => {
    const err = new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'boom' });
    err.stack = `Error: boom\n    at ${SENDER_FRAME} (sender.js:1:1)`;

    const decoded = roundTrip(err);

    // The decoder attaches a fresh local stack via `new TitanError`, but the
    // ORIGINAL sender frame must never be present — i.e. the wire carried null.
    expect(decoded.stack ?? '').not.toContain(SENDER_FRAME);
  });

  it('transmits the stack only when explicitly opted in', () => {
    setSerializerErrorOptions({ includeStackTraces: true });
    const err = new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'boom' });
    err.stack = `Error: boom\n    at ${SENDER_FRAME} (sender.js:1:1)`;

    const decoded = roundTrip(err);

    expect(decoded.stack ?? '').toContain(SENDER_FRAME);
  });

  it('suppresses the cause stack by default too', () => {
    const cause = new Error('root cause');
    cause.stack = `Error: root cause\n    at ${SENDER_FRAME} (cause.js:2:2)`;
    const err = new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'boom', cause });

    const decoded = roundTrip(err);

    expect((decoded.cause?.stack as string) ?? '').not.toContain(SENDER_FRAME);
  });
});
