/**
 * Regression test for T#48 — base-transport's handshake-phase
 * "text vs binary" heuristic was dangerously permissive.
 *
 * The check was a single first-byte test: if `byte in [0x20, 0x7e]`
 * (any printable ASCII), the buffer was treated as text and
 * forwarded through `emit('data', ...)` WITHOUT going through the
 * binary packet decoder. Packet IDs are 4-byte big-endian unsigned
 * ints, so any binary packet whose ID happens to start in that
 * range — roughly a third of all valid packet IDs — was
 * misclassified. The connection's first packet was discarded as
 * "text" and `binaryMode` never flipped on.
 *
 * Fix: try-decode-first. If `decodePacket` succeeds, the buffer
 * is a binary packet; otherwise fall back to emitting as raw
 * data for the text handshake path.
 */

import { describe, it, expect, vi } from 'vitest';
import { Packet, encodePacket, TYPE_CALL } from '../../../src/netron/packet/index.js';
import { BaseConnection } from '../../../src/netron/transport/base-transport.js';

// Concrete subclass with the abstract members no-op'd so we can
// drive `handleData` directly. We're testing the heuristic, not
// the surrounding I/O.
class Harness extends BaseConnection {
  constructor() {
    super({});
  }
  protected async doSend(_data: Buffer | ArrayBuffer): Promise<void> { /* noop */ }
  protected async doClose(_code?: number, _reason?: string): Promise<void> { /* noop */ }
  protected async doReconnect(): Promise<void> { /* noop */ }
  public exposeHandleData(data: Buffer | ArrayBuffer) {
    (this as any).handleData(data);
  }
}

describe('BaseConnection.handleData — packet detection (T#48)', () => {
  it('decodes a binary packet whose ID first byte is in the printable-ASCII range', () => {
    // Craft a packet whose ID has 0x44 ('D', 0x44 in printable range) as its high byte.
    const p = new Packet(0x44_00_00_01);
    p.setType(TYPE_CALL);
    p.data = { hi: 'there' };
    const encoded = encodePacket(p);
    expect(encoded[0]).toBeGreaterThanOrEqual(0x20);
    expect(encoded[0]).toBeLessThanOrEqual(0x7e);

    const c = new Harness();
    const packetSpy = vi.fn();
    const dataSpy = vi.fn();
    c.on('packet', packetSpy);
    c.on('data', dataSpy);

    c.exposeHandleData(encoded);

    expect(packetSpy).toHaveBeenCalledTimes(1);
    expect(dataSpy).not.toHaveBeenCalled();
  });

  it('still falls back to emit(\"data\") for a buffer that is not a valid packet', () => {
    const c = new Harness();
    const packetSpy = vi.fn();
    const dataSpy = vi.fn();
    c.on('packet', packetSpy);
    c.on('data', dataSpy);

    // Two bytes of UTF-8 text — not enough to parse as a packet
    // (the decoder needs at least 5 bytes for ID + flags).
    c.exposeHandleData(Buffer.from('hi'));

    expect(packetSpy).not.toHaveBeenCalled();
    expect(dataSpy).toHaveBeenCalledTimes(1);
  });

  it('flips binaryMode on after the first successful decode', () => {
    const c = new Harness();
    expect((c as any).binaryMode).toBe(false);
    const p = new Packet(1);
    p.data = 'first';
    c.exposeHandleData(encodePacket(p));
    expect((c as any).binaryMode).toBe(true);
  });
});
