import { describe, it, expect, beforeEach } from 'vitest';
import {
  Packet,
  TYPE_CALL,
  TYPE_PING,
  TYPE_STREAM,
  createPacket,
  createStreamPacket,
  encodePacket,
  decodePacket,
  serializer
} from '../../src/packet/index.js';

describe('Packet System', () => {
  beforeEach(() => {
    // Reset packet ID generator before each test
    Packet.resetId();
  });

  describe('Packet Creation', () => {
    it('should create a packet with basic properties', () => {
      const packet = new Packet(123);
      expect(packet.id).toBe(123);
      expect(packet.flags).toBe(0);
    });

    it('should set and get packet type', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_CALL);
      expect(packet.getType()).toBe(TYPE_CALL);
    });

    it('should set and get impulse flag', () => {
      const packet = new Packet(1);
      packet.setImpulse(1);
      expect(packet.getImpulse()).toBe(1);
      packet.setImpulse(0);
      expect(packet.getImpulse()).toBe(0);
    });

    it('should set and get error flag', () => {
      const packet = new Packet(1);
      packet.setError(1);
      expect(packet.getError()).toBe(1);
      packet.setError(0);
      expect(packet.getError()).toBe(0);
    });

    it('should generate unique packet IDs', () => {
      const id1 = Packet.nextId();
      const id2 = Packet.nextId();
      const id3 = Packet.nextId();
      expect(id1).toBe(1);
      expect(id2).toBe(2);
      expect(id3).toBe(3);
    });
  });

  describe('Stream Packets', () => {
    it('should set stream information', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);
      packet.setStreamInfo(100, 0, false, true);

      expect(packet.streamId).toBe(100);
      expect(packet.streamIndex).toBe(0);
      expect(packet.isStreamChunk()).toBe(true);
      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(true);
    });

    it('should create stream packet with factory', () => {
      const packet = createStreamPacket(1, 200, 5, true, false, { chunk: 'data' });

      expect(packet.getType()).toBe(TYPE_STREAM);
      expect(packet.streamId).toBe(200);
      expect(packet.streamIndex).toBe(5);
      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(false);
      expect(packet.data).toEqual({ chunk: 'data' });
    });
  });

  describe('Packet Factory Functions', () => {
    it('should create packet with createPacket', () => {
      const packet = createPacket(42, 1, TYPE_CALL, { method: 'test', args: [1, 2, 3] });

      expect(packet.id).toBe(42);
      expect(packet.getImpulse()).toBe(1);
      expect(packet.getType()).toBe(TYPE_CALL);
      expect(packet.data).toEqual({ method: 'test', args: [1, 2, 3] });
    });
  });

  describe('Packet Encoding/Decoding', () => {
    it('should encode and decode a simple packet', () => {
      const original = createPacket(1, 1, TYPE_CALL, { method: 'hello', args: [] });
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toBe(original.id);
      expect(decoded.getImpulse()).toBe(original.getImpulse());
      expect(decoded.getType()).toBe(original.getType());
      expect(decoded.data).toEqual(original.data);
    });

    it('should encode and decode packet with complex data', () => {
      const complexData = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        nested: {
          key: 'value',
          deep: {
            deeper: 'value'
          }
        }
      };

      const original = createPacket(2, 1, TYPE_CALL, complexData);
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toEqual(complexData);
    });

    it('should encode and decode stream packet', () => {
      const original = createStreamPacket(3, 100, 0, false, true, 'chunk data');
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toBe(original.id);
      expect(decoded.getType()).toBe(TYPE_STREAM);
      expect(decoded.streamId).toBe(original.streamId);
      expect(decoded.streamIndex).toBe(original.streamIndex);
      expect(decoded.isLastChunk()).toBe(original.isLastChunk());
      expect(decoded.isLive()).toBe(original.isLive());
      expect(decoded.data).toBe(original.data);
    });

    it('should handle ping packet', () => {
      const original = createPacket(4, 1, TYPE_PING, null);
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.id).toBe(original.id);
      expect(decoded.getType()).toBe(TYPE_PING);
      expect(decoded.data).toBe(null);
    });

    it('should handle error packets', () => {
      const errorData = {
        code: 'ERROR_CODE',
        message: 'Something went wrong',
        details: { reason: 'test' }
      };

      const original = createPacket(5, 0, TYPE_CALL, errorData);
      original.setError(1);

      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.getError()).toBe(1);
      expect(decoded.data).toEqual(errorData);
    });
  });

  describe('Serialization Edge Cases', () => {
    it('should handle empty data', () => {
      const original = createPacket(6, 1, TYPE_CALL, {});
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toEqual({});
    });

    it('should handle arrays', () => {
      const original = createPacket(7, 1, TYPE_CALL, [1, 2, 3, 4, 5]);
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.data).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle dates', () => {
      const date = new Date('2025-01-01T00:00:00Z');
      const original = createPacket(8, 1, TYPE_CALL, { timestamp: date });
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.data.timestamp).toEqual(date);
    });

    it('should handle large numbers', () => {
      const original = createPacket(9, 1, TYPE_CALL, {
        maxSafeInteger: Number.MAX_SAFE_INTEGER,
        minSafeInteger: Number.MIN_SAFE_INTEGER
      });
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.data.maxSafeInteger).toBe(Number.MAX_SAFE_INTEGER);
      expect(decoded.data.minSafeInteger).toBe(Number.MIN_SAFE_INTEGER);
    });
  });

  describe('Binary Format', () => {
    it('should produce consistent binary output', () => {
      const packet = createPacket(10, 1, TYPE_CALL, { test: 'data' });
      const encoded1 = encodePacket(packet);
      const encoded2 = encodePacket(packet);

      expect(encoded1).toEqual(encoded2);
    });

    it('should produce compact binary output', () => {
      const packet = createPacket(11, 1, TYPE_PING, null);
      const encoded = encodePacket(packet);

      // Packet should be relatively small (ID + flags + null data)
      // Exact size depends on MessagePack encoding, but should be < 20 bytes
      expect(encoded.length).toBeLessThan(20);
    });
  });
});
