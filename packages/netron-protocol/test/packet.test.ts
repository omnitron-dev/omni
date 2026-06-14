import { describe, it, expect } from 'vitest';
import {
  Packet,
  createPacket,
  TYPE_PING,
  TYPE_GET,
  TYPE_SET,
  TYPE_CALL,
  TYPE_TASK,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
} from '../src/index.js';

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

  it('every TYPE_* opcode round-trips through setType/getType', () => {
    for (const t of [
      TYPE_PING, TYPE_GET, TYPE_SET, TYPE_CALL, TYPE_TASK,
      TYPE_STREAM, TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE,
    ]) {
      const p = new Packet(1);
      p.setType(t);
      expect(p.getType()).toBe(t);
    }
  });

  it('type / impulse / error flags occupy independent bits (no cross-talk)', () => {
    const p = new Packet(1);
    p.setType(TYPE_TASK);
    p.setImpulse(1);
    p.setError(1);
    expect(p.getType()).toBe(TYPE_TASK);
    expect(p.getImpulse()).toBe(1);
    expect(p.getError()).toBe(1);

    // Flipping one flag back leaves the others intact.
    p.setError(0);
    expect(p.getError()).toBe(0);
    expect(p.getImpulse()).toBe(1);
    expect(p.getType()).toBe(TYPE_TASK);
  });

  it('a non-stream packet reports no stream chunk', () => {
    const p = createPacket(1, 0, TYPE_CALL, null);
    expect(p.isStreamChunk()).toBe(false);
  });
});
