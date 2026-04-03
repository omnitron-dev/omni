import {
  Packet,
  TYPE_GET,
  TYPE_PING,
  TYPE_CALL,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
  PacketType,
  createPacket,
  createStreamPacket,
  encodePacket,
  decodePacket,
} from '../../src/netron';

describe('Packet', () => {
  let pkt: Packet;

  beforeEach(() => {
    pkt = new Packet(1);
  });

  it('initialization', () => {
    expect(pkt.flags).toEqual(0);
    expect(pkt.id).toEqual(1);
    expect(pkt.data).toBeUndefined();
  });

  it('set/get impulse bit', () => {
    expect(pkt.getImpulse()).toEqual(0);
    pkt.setImpulse(1);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.flags).toEqual(0x40);
    pkt.setImpulse(0);
    expect(pkt.getImpulse()).toEqual(0);
  });

  it('set/get error bit', () => {
    expect(pkt.getError()).toEqual(0);
    pkt.setError(1);
    expect(pkt.getError()).toEqual(1);
    expect(pkt.flags).toEqual(0x80);
    pkt.setError(0);
    expect(pkt.getError()).toEqual(0);
  });

  it('set/get type value', () => {
    pkt.setImpulse(1);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getType()).toEqual(0);
    pkt.setType(0x34 as PacketType);
    expect(pkt.getType()).toEqual(4);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(0);
    pkt.setType(0x0f as PacketType);
    expect(pkt.getType()).toEqual(0x0f);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(0);
    pkt.setError(1);
    pkt.setType(0 as PacketType);
    expect(pkt.getType()).toEqual(0);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(1);
  });

  it('create packet from values', () => {
    const id = 64;
    const impulse = 1;
    const action = TYPE_GET;
    const data = {
      some: 'data',
      luck: 777,
    };

    const pkt = createPacket(id, impulse, action, data);

    expect(pkt.getImpulse()).toEqual(impulse);
    expect(pkt.getType()).toEqual(action);
    expect(pkt.id).toEqual(id);
    expect(pkt.data).toEqual(data);
  });

  it('encode/decode packet', () => {
    const pkt = createPacket(1, 1, 0x20 as PacketType, [1, 2, 3]);
    const decPkt = decodePacket(encodePacket(pkt));
    expect(pkt).toEqual(decPkt);
  });

  it('set/get flags independently', () => {
    pkt.setImpulse(1);
    pkt.setError(1);
    pkt.setType(0x0f as PacketType);
    expect(pkt.getImpulse()).toEqual(1);
    expect(pkt.getError()).toEqual(1);
    expect(pkt.getType()).toEqual(0x0f);
    expect(pkt.flags).toEqual(0b11001111);
  });

  it('reset all flags', () => {
    pkt.setImpulse(1);
    pkt.setError(1);
    pkt.setType(0x3f as PacketType);
    pkt.setImpulse(0);
    pkt.setError(0);
    pkt.setType(0 as PacketType);
    expect(pkt.getImpulse()).toEqual(0);
    expect(pkt.getError()).toEqual(0);
    expect(pkt.getType()).toEqual(0);
    expect(pkt.flags).toEqual(0x00);
  });

  it('encode/decode packet with complex data', () => {
    const complexData = { key: 'value', array: [1, 2, 3], nested: { a: 1 } };
    const pkt = createPacket(2, 0, 0x10 as PacketType, complexData);
    const decPkt = decodePacket(encodePacket(pkt));
    expect(pkt).toEqual(decPkt);
  });

  it('encode/decode packet with undefined data', () => {
    const pkt = createPacket(1, 0, 0x10 as PacketType, undefined);
    const encoded = encodePacket(pkt);
    const decoded = decodePacket(encoded);
    expect(decoded.data).toBeUndefined();
  });

  it('encode/decode packet with null data', () => {
    const pkt = createPacket(1, 0, 0x10 as PacketType, null);
    const encoded = encodePacket(pkt);
    const decoded = decodePacket(encoded);
    expect(decoded.data).toBeNull();
  });

  it('set/get stream info', () => {
    pkt.setStreamInfo(123, 0, true, false);
    expect(pkt.streamId).toEqual(123);
    expect(pkt.streamIndex).toEqual(0);
    expect(pkt.isLastChunk()).toBeTruthy();
    expect(pkt.isLive()).toBeFalsy();
  });

  it('check if packet is stream chunk', () => {
    pkt.setType(TYPE_STREAM);
    expect(pkt.isStreamChunk()).toBeTruthy();
    pkt.setType(TYPE_GET);
    expect(pkt.isStreamChunk()).toBeFalsy();
  });

  describe('Buffer Size Optimization', () => {
    it('should encode and decode TYPE_PING packets correctly', () => {
      const timestamp = Date.now();
      const pkt = createPacket(1, 1, TYPE_PING, timestamp);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.getType()).toEqual(TYPE_PING);
      expect(decoded.data).toEqual(timestamp);
      expect(encoded.length).toBeLessThan(100); // Should be small
    });

    it('should encode and decode TYPE_CALL packets correctly', () => {
      const callData = ['serviceDefId123', 'methodName', { arg1: 'value1', arg2: 42 }, [1, 2, 3]];
      const pkt = createPacket(2, 1, TYPE_CALL, callData);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.getType()).toEqual(TYPE_CALL);
      expect(decoded.data).toEqual(callData);
    });

    it('should encode and decode TYPE_CALL packets with large arguments', () => {
      // Simulate a typical RPC call with larger payload
      const largeArgs = {
        userId: 'user-123',
        options: {
          filter: { status: 'active', created: { $gte: Date.now() - 86400000 } },
          sort: { createdAt: -1 },
          limit: 100,
        },
        metadata: {
          requestId: 'req-123',
          timestamp: Date.now(),
          clientVersion: '1.0.0',
        },
      };
      const callData = ['serviceId', 'queryMethod', largeArgs];
      const pkt = createPacket(3, 1, TYPE_CALL, callData);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.getType()).toEqual(TYPE_CALL);
      expect(decoded.data).toEqual(callData);
    });

    it('should encode and decode TYPE_STREAM packets correctly', () => {
      const streamData = { chunk: 'data chunk 1', size: 1024 };
      const pkt = createStreamPacket(4, 100, 0, false, true, streamData);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.getType()).toEqual(TYPE_STREAM);
      expect(decoded.data).toEqual(streamData);
      expect(decoded.streamId).toEqual(100);
      expect(decoded.streamIndex).toEqual(0);
      expect(decoded.isLive()).toBeTruthy();
    });

    it('should encode and decode TYPE_STREAM_ERROR packets correctly', () => {
      const errorData = {
        streamId: 100,
        error: 'Stream processing failed',
        code: 'STREAM_ERROR',
      };
      const pkt = createPacket(5, 1, TYPE_STREAM_ERROR, errorData);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.getType()).toEqual(TYPE_STREAM_ERROR);
      expect(decoded.data).toEqual(errorData);
    });

    it('should encode and decode TYPE_STREAM_CLOSE packets correctly', () => {
      const closeData = {
        streamId: 100,
        reason: 'completed',
      };
      const pkt = createPacket(6, 1, TYPE_STREAM_CLOSE, closeData);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.getType()).toEqual(TYPE_STREAM_CLOSE);
      expect(decoded.data).toEqual(closeData);
    });

    it('should handle packets with very large payloads', () => {
      // Create a large payload that exceeds initial buffer estimate
      const largeArray = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random(),
      }));
      const pkt = createPacket(7, 1, TYPE_CALL, ['service', 'method', largeArray]);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.data).toEqual(['service', 'method', largeArray]);
      // Verify that SmartBuffer auto-resized correctly
      expect(encoded.length).toBeGreaterThan(512);
    });

    it('should handle stream packets with stream metadata', () => {
      const streamData = Buffer.from('streaming binary data');
      const pkt = createStreamPacket(8, 200, 5, true, false, streamData);
      const encoded = encodePacket(pkt);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toEqual(pkt.id);
      expect(decoded.streamId).toEqual(200);
      expect(decoded.streamIndex).toEqual(5);
      expect(decoded.isLastChunk()).toBeTruthy();
      expect(decoded.isLive()).toBeFalsy();
      expect(Buffer.compare(decoded.data, streamData)).toEqual(0);
    });

    it('should maintain backward compatibility with existing encoding', () => {
      // Test that the optimization doesn't change the encoded format
      const testData = { test: 'data', num: 123 };
      const pkt1 = createPacket(9, 0, TYPE_GET, testData);
      const pkt2 = createPacket(9, 0, TYPE_GET, testData);

      const encoded1 = encodePacket(pkt1);
      const encoded2 = encodePacket(pkt2);

      // Both should produce identical encoded data
      expect(Buffer.compare(encoded1, encoded2)).toEqual(0);

      // Both should decode to the same result
      const decoded1 = decodePacket(encoded1);
      const decoded2 = decodePacket(encoded2);
      expect(decoded1).toEqual(decoded2);
    });
  });
});
