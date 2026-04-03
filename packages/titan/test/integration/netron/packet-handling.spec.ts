/**
 * Netron - Packet Handling Edge Cases Tests
 *
 * Tests for packet construction, serialization, flag manipulation,
 * and stream handling edge cases.
 *
 * @since 0.4.5
 */

import { describe, it, expect } from 'vitest';
import { Packet } from '../../../src/netron/packet/packet.js';
import {
  PacketType,
  TYPE_PING,
  TYPE_TASK,
  TYPE_STREAM,
  TYPE_SET,
  TYPE_GET,
  TYPE_CALL,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
} from '../../../src/netron/packet/types.js';

// Constants for impulse values (PacketImpulse is a type alias for 0 | 1)
const IMPULSE_RESPONSE = 0 as const;
const IMPULSE_REQUEST = 1 as const;

describe('Netron - Packet Handling', () => {
  describe('Packet Construction', () => {
    it('should create packet with unique ID', () => {
      const packet1 = new Packet(Packet.nextId());
      const packet2 = new Packet(Packet.nextId());

      expect(packet1.id).not.toBe(packet2.id);
    });

    it('should initialize with zero flags', () => {
      const packet = new Packet(1);
      expect(packet.flags).toBe(0);
    });

    it('should handle ID reset correctly', () => {
      const id1 = Packet.nextId();
      Packet.resetId();
      const id2 = Packet.nextId();

      expect(id2).toBeLessThan(id1);
    });
  });

  describe('Packet Type Manipulation', () => {
    it('should set and get packet type correctly', () => {
      const packet = new Packet(1);

      const types = [
        TYPE_PING,
        TYPE_TASK,
        TYPE_STREAM,
        TYPE_SET,
        TYPE_GET,
        TYPE_CALL,
        TYPE_STREAM_ERROR,
        TYPE_STREAM_CLOSE,
      ];

      for (const type of types) {
        packet.setType(type);
        expect(packet.getType()).toBe(type);
      }
    });

    it('should preserve other flags when setting type', () => {
      const packet = new Packet(1);

      // Set error flag first
      packet.setError(1);

      // Set type
      packet.setType(TYPE_TASK);

      // Error flag should still be set
      expect(packet.getError()).toBe(1);
      expect(packet.getType()).toBe(TYPE_TASK);
    });

    it('should handle all 16 possible type values', () => {
      const packet = new Packet(1);

      for (let type = 0; type < 16; type++) {
        packet.setType(type as PacketType);
        expect(packet.getType()).toBe(type);
      }
    });
  });

  describe('Impulse Flag', () => {
    it('should set and get impulse correctly', () => {
      const packet = new Packet(1);

      packet.setImpulse(IMPULSE_REQUEST);
      expect(packet.getImpulse()).toBe(IMPULSE_REQUEST);

      packet.setImpulse(IMPULSE_RESPONSE);
      expect(packet.getImpulse()).toBe(IMPULSE_RESPONSE);
    });

    it('should preserve other flags when setting impulse', () => {
      const packet = new Packet(1);

      packet.setType(TYPE_CALL);
      packet.setError(1);

      packet.setImpulse(IMPULSE_REQUEST);

      expect(packet.getType()).toBe(TYPE_CALL);
      expect(packet.getError()).toBe(1);
      expect(packet.getImpulse()).toBe(IMPULSE_REQUEST);
    });
  });

  describe('Error Flag', () => {
    it('should set and get error flag correctly', () => {
      const packet = new Packet(1);

      expect(packet.getError()).toBe(0);

      packet.setError(1);
      expect(packet.getError()).toBe(1);

      packet.setError(0);
      expect(packet.getError()).toBe(0);
    });

    it('should preserve other flags when setting error', () => {
      const packet = new Packet(1);

      packet.setType(TYPE_TASK);
      packet.setImpulse(IMPULSE_REQUEST);

      packet.setError(1);

      expect(packet.getType()).toBe(TYPE_TASK);
      expect(packet.getImpulse()).toBe(IMPULSE_REQUEST);
    });
  });

  describe('Stream Information', () => {
    it('should set stream info correctly', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);

      packet.setStreamInfo(12345, 0, false, false);

      expect(packet.streamId).toBe(12345);
      expect(packet.streamIndex).toBe(0);
      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(false);
    });

    it('should set end-of-stream flag correctly', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);

      packet.setStreamInfo(100, 10, true, false);

      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(false);
    });

    it('should set live stream flag correctly', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);

      packet.setStreamInfo(100, 0, false, true);

      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(true);
    });

    it('should set both EOS and live flags', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);

      packet.setStreamInfo(100, 5, true, true);

      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(true);
    });

    it('should correctly identify stream chunks', () => {
      const packet = new Packet(1);

      expect(packet.isStreamChunk()).toBe(false);

      packet.setType(TYPE_STREAM);
      expect(packet.isStreamChunk()).toBe(true);

      packet.setType(TYPE_CALL);
      expect(packet.isStreamChunk()).toBe(false);
    });
  });

  describe('Flag Bit Manipulation', () => {
    it('should handle all flags set simultaneously', () => {
      const packet = new Packet(1);

      // Set all flags
      packet.setType(TYPE_STREAM);
      packet.setError(1);
      packet.setImpulse(IMPULSE_REQUEST);
      packet.setStreamInfo(100, 0, true, true);

      // Verify all are set
      expect(packet.getType()).toBe(TYPE_STREAM);
      expect(packet.getError()).toBe(1);
      expect(packet.getImpulse()).toBe(IMPULSE_REQUEST);
      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(true);

      // All 8 bits should be used
      // Type: bits 0-3 (4 bits) - TYPE_STREAM = 0x05 = 0b0101
      // EOS: bit 4
      // Live: bit 5
      // Impulse: bit 6
      // Error: bit 7
      expect(packet.flags).toBe(0b11110101); // 245 in decimal
    });

    it('should clear flags correctly', () => {
      const packet = new Packet(1);

      // Set some flags
      packet.setType(TYPE_TASK);
      packet.setError(1);
      packet.setImpulse(IMPULSE_REQUEST);

      // Clear error
      packet.setError(0);
      expect(packet.getError()).toBe(0);
      expect(packet.getType()).toBe(TYPE_TASK);
      expect(packet.getImpulse()).toBe(IMPULSE_REQUEST);

      // Clear impulse
      packet.setImpulse(IMPULSE_RESPONSE);
      expect(packet.getImpulse()).toBe(IMPULSE_RESPONSE);
    });

    it('should handle maximum type value', () => {
      const packet = new Packet(1);

      packet.setType(15 as PacketType); // Max 4-bit value
      expect(packet.getType()).toBe(15);

      // Other flags should still work
      packet.setError(1);
      expect(packet.getType()).toBe(15);
      expect(packet.getError()).toBe(1);
    });
  });

  describe('Data Payload', () => {
    it('should store and retrieve simple data', () => {
      const packet = new Packet(1);

      packet.data = 'hello';
      expect(packet.data).toBe('hello');

      packet.data = 42;
      expect(packet.data).toBe(42);

      packet.data = null;
      expect(packet.data).toBeNull();
    });

    it('should store and retrieve complex data', () => {
      const packet = new Packet(1);

      const complexData = {
        name: 'test',
        values: [1, 2, 3],
        nested: {
          deep: true,
        },
      };

      packet.data = complexData;
      expect(packet.data).toEqual(complexData);
    });

    it('should store and retrieve binary data', () => {
      const packet = new Packet(1);

      const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      packet.data = buffer;

      expect(Buffer.isBuffer(packet.data)).toBe(true);
      expect(packet.data).toEqual(buffer);
    });

    it('should store and retrieve undefined', () => {
      const packet = new Packet(1);

      packet.data = undefined;
      expect(packet.data).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid flag changes', () => {
      const packet = new Packet(1);

      // Rapidly toggle flags
      for (let i = 0; i < 100; i++) {
        packet.setType((i % 16) as PacketType);
        packet.setError((i % 2) as 0 | 1);
        packet.setImpulse((i % 2) as 0 | 1);
      }

      // Final state should be consistent
      expect(packet.getType()).toBe(99 % 16);
      expect(packet.getError()).toBe(99 % 2);
      expect(packet.getImpulse()).toBe(99 % 2);
    });

    it('should handle zero stream ID', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);
      packet.setStreamInfo(0, 0, false, false);

      expect(packet.streamId).toBe(0);
      expect(packet.streamIndex).toBe(0);
    });

    it('should handle large stream index', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);

      const largeIndex = 2147483647; // Max 32-bit signed int
      packet.setStreamInfo(1, largeIndex, false, false);

      expect(packet.streamIndex).toBe(largeIndex);
    });

    it('should handle max stream ID', () => {
      const packet = new Packet(1);
      packet.setType(TYPE_STREAM);

      const maxId = 4294967295; // Max 32-bit unsigned int
      packet.setStreamInfo(maxId, 0, false, false);

      expect(packet.streamId).toBe(maxId);
    });

    it('should handle zero packet ID', () => {
      const packet = new Packet(0);
      expect(packet.id).toBe(0);
    });

    it('should handle negative packet ID (implementation dependent)', () => {
      const packet = new Packet(-1);
      // The ID is stored as-is, behavior depends on implementation
      expect(packet.id).toBe(-1);
    });
  });

  describe('Performance', () => {
    it('should efficiently create many packets', () => {
      const startTime = Date.now();
      const count = 10000;
      const packets: Packet[] = [];

      for (let i = 0; i < count; i++) {
        const packet = new Packet(Packet.nextId());
        packet.setType(TYPE_CALL);
        packet.data = { index: i };
        packets.push(packet);
      }

      const elapsed = Date.now() - startTime;

      expect(packets.length).toBe(count);
      expect(elapsed).toBeLessThan(500); // Should complete in under 500ms
    });

    it('should efficiently manipulate packet flags', () => {
      const packet = new Packet(1);
      const startTime = Date.now();
      const iterations = 100000;

      for (let i = 0; i < iterations; i++) {
        packet.setType((i % 16) as PacketType);
        packet.setError((i % 2) as 0 | 1);
        packet.setImpulse((i % 2) as 0 | 1);
        packet.getType();
        packet.getError();
        packet.getImpulse();
      }

      const elapsed = Date.now() - startTime;

      // 100k iterations should complete in under 100ms
      expect(elapsed).toBeLessThan(100);
    });
  });
});
