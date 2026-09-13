/**
 * The browser's packet codec and titan's must agree on the wire.
 *
 * `netron-browser` is a deliberate mirror of `titan/src/netron`: a browser
 * bundle cannot pull in the server package, so the packet types, their
 * msgpack type ids and the TitanError shape are written out twice. Nothing
 * kept the two copies in step — `scripts/duplicate-implementations.mjs` sees
 * the duplication and can only report that the bodies match TODAY.
 *
 * Body equality is the weaker property anyway. What matters is that bytes one
 * side writes are what the other side reads, so these tests round-trip real
 * packets ACROSS the two implementations, in both directions. A drift in a
 * type id would not change either file's tests and would corrupt every error
 * the portal receives.
 */

import { describe, it, expect } from 'vitest';

import { encodePacket as encodeBrowser, decodePacket as decodeBrowser, Packet as BrowserPacket } from '../../src/packet/index.js';
import { encodePacket as encodeServer, decodePacket as decodeServer, Packet as ServerPacket, TYPE_CALL, TYPE_TASK } from '@omnitron-dev/titan/netron';
import { TitanError, ErrorCode } from '@omnitron-dev/titan/errors';

function serverPacket(id: number, data: unknown) {
  const p = new ServerPacket(id);
  p.setImpulse(1);
  p.setType(TYPE_CALL);
  p.data = data;
  return p;
}

function browserPacket(id: number, data: unknown) {
  const p = new BrowserPacket(id);
  p.setImpulse(1);
  p.setType(TYPE_CALL);
  p.data = data;
  return p;
}

const PAYLOADS: Array<[string, unknown]> = [
  ['a scalar', 42],
  ['a string', 'hello'],
  ['a nested object', { a: 1, b: { c: [1, 2, 3] }, d: null }],
  ['a Date', new Date('2026-01-01T00:00:00.000Z')],
  ['a Map', new Map<string, unknown>([['k', 1]])],
  ['a Set', new Set([1, 2, 3])],
  ['a bigint', 9007199254740993n],
];

describe('server writes, browser reads', () => {
  for (const [name, payload] of PAYLOADS) {
    it(`round-trips ${name}`, () => {
      const decoded = decodeBrowser(encodeServer(serverPacket(7, payload)));
      expect(decoded.id).toBe(7);
      expect(decoded.data).toEqual(payload);
    });
  }
});

describe('browser writes, server reads', () => {
  for (const [name, payload] of PAYLOADS) {
    it(`round-trips ${name}`, () => {
      const decoded = decodeServer(encodeBrowser(browserPacket(9, payload)));
      expect(decoded.id).toBe(9);
      expect(decoded.data).toEqual(payload);
    });
  }
});

describe('a TitanError survives the crossing with its details', () => {
  it('keeps code, message, details and the extra fields a handler attached', () => {
    const err = new TitanError({
      code: ErrorCode.NOT_FOUND,
      message: 'no such wallet',
      details: { walletId: 'w-1' },
    });
    (err as unknown as Record<string, unknown>)['requestId'] = 'req-42';

    const decoded = decodeBrowser(encodeServer(serverPacket(11, err))).data as any;

    expect(decoded).toBeInstanceOf(Error);
    expect(decoded.code).toBe(ErrorCode.NOT_FOUND);
    expect(decoded.message).toBe('no such wallet');
    expect(decoded.details).toEqual({ walletId: 'w-1' });
    expect(decoded.requestId).toBe('req-42');
  });

  it('does not smuggle a function across as an extra field', () => {
    const err = new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'boom' });
    (err as unknown as Record<string, unknown>)['retry'] = () => 'nope';

    const decoded = decodeBrowser(encodeServer(serverPacket(12, err))).data as any;

    expect(decoded.message).toBe('boom');
    expect(decoded.retry).toBeUndefined();
  });
});

describe('the two sides share their limits, not just their features', () => {
  // Neither codec carries a raw Uint8Array — msgpack rejects it here. That is
  // a shared limit and fine; what would not be fine is ONE side learning to
  // encode it, which turns a clean throw into bytes the other side misreads.
  it('both refuse a raw Uint8Array', () => {
    const payload = new Uint8Array([1, 2, 250]);
    expect(() => encodeServer(serverPacket(21, payload))).toThrow(/not supported/i);
    expect(() => encodeBrowser(browserPacket(21, payload))).toThrow(/not supported/i);
  });
});

describe('packet header flags cross intact', () => {
  it('preserves type and impulse', () => {
    const p = serverPacket(3, 'x');
    p.setType(TYPE_TASK);
    p.setImpulse(0);

    const decoded = decodeBrowser(encodeServer(p));

    expect(decoded.getType()).toBe(TYPE_TASK);
    expect(decoded.getImpulse()).toBe(0);
  });
});
