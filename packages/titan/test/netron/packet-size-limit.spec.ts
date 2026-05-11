/**
 * Regression tests for T#40 — `decodePacket` had no absolute size
 * ceiling. A peer could ship a multi-GB frame and force the msgpack
 * decoder to allocate matching scratch buffers, OOM-ing the host
 * with a single packet. HTTP had its own 10 MiB cap and WebSocket's
 * `maxPayload` was a per-instance opt-in, but TCP / Unix and the
 * raw `decodePacket` entry point had nothing.
 *
 * Fix: `decodePacket(buf, maxSize?)` enforces an explicit byte
 * ceiling BEFORE handing the buffer to the deserializer. The
 * default is 16 MiB (`DEFAULT_MAX_PACKET_SIZE`); transports and
 * the netron each accept overrides. These tests pin the behaviour
 * at the decoder boundary so a future "performance optimisation"
 * cannot silently remove it.
 */

import { describe, it, expect } from 'vitest';
import { decodePacket, encodePacket, Packet, DEFAULT_MAX_PACKET_SIZE } from '../../src/netron/packet/index.js';

function tinyPacket(): Buffer {
  const p = new Packet(1);
  p.data = { hello: 'world' };
  return encodePacket(p);
}

describe('decodePacket — packet size cap (T#40)', () => {
  it('decodes a normal small packet under the default cap', () => {
    const encoded = tinyPacket();
    const decoded = decodePacket(encoded);
    expect(decoded.data).toEqual({ hello: 'world' });
  });

  it('rejects a buffer larger than the default ceiling', () => {
    // Allocate a single byte over the default cap and call decode.
    // We never actually need msgpack-valid contents — the size
    // guard fires before the decoder runs.
    const oversize = Buffer.alloc(DEFAULT_MAX_PACKET_SIZE + 1, 0);
    expect(() => decodePacket(oversize)).toThrow(/maximum allowed size/);
  });

  it('honours an explicit per-call cap below the default', () => {
    const encoded = tinyPacket(); // ~17 bytes
    expect(() => decodePacket(encoded, 8)).toThrow(/maximum allowed size/);
  });

  it('accepts a buffer at exactly the configured cap', () => {
    const encoded = tinyPacket();
    // Pass a cap matching the actual size; should not throw.
    expect(() => decodePacket(encoded, encoded.length)).not.toThrow();
  });

  it('accepts ArrayBuffer inputs with the same cap semantics', () => {
    const encoded = tinyPacket();
    const ab = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);
    expect(() => decodePacket(ab, encoded.byteLength)).not.toThrow();
    expect(() => decodePacket(ab, encoded.byteLength - 1)).toThrow(/maximum allowed size/);
  });

  it('exports a default ceiling matching the documented value', () => {
    expect(DEFAULT_MAX_PACKET_SIZE).toBe(16 * 1024 * 1024);
  });
});
