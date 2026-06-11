/**
 * WIRE-13 regression: StreamReference must encode correctly on the FIRST encode.
 *
 * Previously registration was lazy (async dynamic import kicked off
 * fire-and-forget from an encode monkey-patch), so the first StreamReference
 * encoded as a plain object. Registration is now eager + synchronous at module
 * load via streams/register-stream-reference.ts. This test imports it for
 * side-effect ONLY (no explicit setup call) and encodes immediately.
 */

import { describe, it, expect } from 'vitest';

// Side-effect import: this alone must register the StreamReference codec.
import '../../src/netron/streams/register-stream-reference.js';
import { StreamReference } from '../../src/netron/streams/stream-reference.js';
import { encodePacket, decodePacket, createPacket, TYPE_CALL } from '../../src/netron';

describe('WIRE-13: StreamReference eager registration', () => {
  it('round-trips a StreamReference on the first encode (not a plain object)', () => {
    const ref = new StreamReference(42, 'writable', true, 'peer-abc');
    const pkt = createPacket(1, 1, TYPE_CALL, { ref });

    const decoded = decodePacket(encodePacket(pkt));

    // The decisive assertion: a registered codec yields a StreamReference
    // INSTANCE; the old first-encode race yielded a plain object.
    expect(decoded.data.ref).toBeInstanceOf(StreamReference);
    expect(decoded.data.ref.streamId).toBe(42);
    expect(decoded.data.ref.type).toBe('writable');
    expect(decoded.data.ref.isLive).toBe(true);
    expect(decoded.data.ref.peerId).toBe('peer-abc');
  });
});
