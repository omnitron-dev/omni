import { describe, it, expect } from 'vitest';
import { Packet, createPacket, TYPE_CALL, TYPE_STREAM } from '../src/index.js';

describe('Packet', () => {
  it('round-trips type / impulse / error flags', () => {
    const p = createPacket(7, 1, TYPE_CALL, { a: 1 });
    expect(p.id).toBe(7);
    expect(p.getType()).toBe(TYPE_CALL);
    expect(p.getImpulse()).toBe(1);
    expect(p.data).toEqual({ a: 1 });
    p.setError(1);
    expect(p.getError()).toBe(1);
  });

  it('encodes stream info + flags', () => {
    const p = new Packet(8);
    p.setType(TYPE_STREAM);
    p.setStreamInfo(42, 3, true, true);
    expect(p.streamId).toBe(42);
    expect(p.streamIndex).toBe(3);
    expect(p.isStreamChunk()).toBe(true);
    expect(p.isLastChunk()).toBe(true);
    expect(p.isLive()).toBe(true);
  });
});
