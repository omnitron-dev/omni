/**
 * Packet Improvements Unit Tests
 *
 * Comprehensive tests for packet system improvements including:
 * - Bit operation performance and correctness
 * - Buffer size estimation
 * - Stream error/close packets
 * - Decode validation
 * - Round-trip encoding/decoding
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Packet,
  TYPE_PING,
  TYPE_GET,
  TYPE_SET,
  TYPE_CALL,
  TYPE_TASK,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
  createPacket,
  createStreamPacket,
  createStreamErrorPacket,
  createStreamClosePacket,
  encodePacket,
  decodePacket,
} from '../../src/packet/index.js';
import { SerializationError } from '../../src/errors/index.js';

describe('Packet Improvements', () => {
  beforeEach(() => {
    Packet.resetId();
  });

  describe('Bit Operation Performance', () => {
    describe('Flag Operations', () => {
      it('should set and get impulse flag correctly', () => {
        const packet = new Packet(1);

        // Default should be 0
        expect(packet.getImpulse()).toBe(0);

        // Set to 1
        packet.setImpulse(1);
        expect(packet.getImpulse()).toBe(1);

        // Set back to 0
        packet.setImpulse(0);
        expect(packet.getImpulse()).toBe(0);
      });

      it('should set and get error flag correctly', () => {
        const packet = new Packet(1);

        // Default should be 0
        expect(packet.getError()).toBe(0);

        // Set to 1
        packet.setError(1);
        expect(packet.getError()).toBe(1);

        // Set back to 0
        packet.setError(0);
        expect(packet.getError()).toBe(0);
      });

      it('should set and get EOS flag correctly via setStreamInfo', () => {
        const packet = new Packet(1);
        packet.setType(TYPE_STREAM);

        // Set isLast=true
        packet.setStreamInfo(100, 0, true, false);
        expect(packet.isLastChunk()).toBe(true);

        // Set isLast=false
        packet.setStreamInfo(100, 0, false, false);
        expect(packet.isLastChunk()).toBe(false);
      });

      it('should set and get live flag correctly via setStreamInfo', () => {
        const packet = new Packet(1);
        packet.setType(TYPE_STREAM);

        // Set isLive=true
        packet.setStreamInfo(100, 0, false, true);
        expect(packet.isLive()).toBe(true);

        // Set isLive=false
        packet.setStreamInfo(100, 0, false, false);
        expect(packet.isLive()).toBe(false);
      });

      it('should set and get type correctly for all valid types', () => {
        const allTypes = [
          TYPE_PING,
          TYPE_GET,
          TYPE_SET,
          TYPE_CALL,
          TYPE_TASK,
          TYPE_STREAM,
          TYPE_STREAM_ERROR,
          TYPE_STREAM_CLOSE,
        ];

        for (const type of allTypes) {
          const packet = new Packet(1);
          packet.setType(type);
          expect(packet.getType()).toBe(type);
        }
      });
    });

    describe('Flag Consistency', () => {
      it('should maintain impulse flag when setting type', () => {
        const packet = new Packet(1);
        packet.setImpulse(1);
        packet.setType(TYPE_CALL);

        expect(packet.getImpulse()).toBe(1);
        expect(packet.getType()).toBe(TYPE_CALL);
      });

      it('should maintain type when setting impulse', () => {
        const packet = new Packet(1);
        packet.setType(TYPE_CALL);
        packet.setImpulse(1);

        expect(packet.getType()).toBe(TYPE_CALL);
        expect(packet.getImpulse()).toBe(1);
      });

      it('should maintain error flag when setting other flags', () => {
        const packet = new Packet(1);
        packet.setError(1);
        packet.setType(TYPE_CALL);
        packet.setImpulse(1);

        expect(packet.getError()).toBe(1);
        expect(packet.getType()).toBe(TYPE_CALL);
        expect(packet.getImpulse()).toBe(1);
      });

      it('should maintain all flags when setting stream info', () => {
        const packet = new Packet(1);
        packet.setType(TYPE_STREAM);
        packet.setImpulse(1);
        packet.setError(1);
        packet.setStreamInfo(100, 5, true, true);

        expect(packet.getType()).toBe(TYPE_STREAM);
        expect(packet.getImpulse()).toBe(1);
        expect(packet.getError()).toBe(1);
        expect(packet.isLastChunk()).toBe(true);
        expect(packet.isLive()).toBe(true);
      });
    });

    describe('Clearing Flags', () => {
      it('should clear impulse flag correctly', () => {
        const packet = new Packet(1);
        packet.setImpulse(1);
        expect(packet.getImpulse()).toBe(1);

        packet.setImpulse(0);
        expect(packet.getImpulse()).toBe(0);
      });

      it('should clear error flag correctly', () => {
        const packet = new Packet(1);
        packet.setError(1);
        expect(packet.getError()).toBe(1);

        packet.setError(0);
        expect(packet.getError()).toBe(0);
      });

      it('should clear type correctly by setting to TYPE_PING (0x00)', () => {
        const packet = new Packet(1);
        packet.setType(TYPE_CALL);
        expect(packet.getType()).toBe(TYPE_CALL);

        packet.setType(TYPE_PING);
        expect(packet.getType()).toBe(TYPE_PING);
      });

      it('should clear EOS and live flags when changing stream info', () => {
        const packet = new Packet(1);
        packet.setType(TYPE_STREAM);
        packet.setStreamInfo(100, 0, true, true);

        expect(packet.isLastChunk()).toBe(true);
        expect(packet.isLive()).toBe(true);

        packet.setStreamInfo(100, 0, false, false);
        expect(packet.isLastChunk()).toBe(false);
        expect(packet.isLive()).toBe(false);
      });
    });

    describe('Multi-bit Type Field', () => {
      it('should correctly handle type values 0-7', () => {
        for (let typeValue = 0; typeValue <= 7; typeValue++) {
          const packet = new Packet(1);
          packet.setType(typeValue as any);
          expect(packet.getType()).toBe(typeValue);
        }
      });

      it('should not interfere with adjacent flags when setting type', () => {
        const packet = new Packet(1);
        packet.setImpulse(1);
        packet.setError(1);
        packet.setType(TYPE_STREAM);
        packet.setStreamInfo(1, 0, true, true);

        // Type is in bits 0-3
        expect(packet.getType()).toBe(TYPE_STREAM);
        // EOS is in bit 4
        expect(packet.isLastChunk()).toBe(true);
        // Live is in bit 5
        expect(packet.isLive()).toBe(true);
        // Impulse is in bit 6
        expect(packet.getImpulse()).toBe(1);
        // Error is in bit 7
        expect(packet.getError()).toBe(1);
      });

      it('should correctly encode all bits in flags byte', () => {
        const packet = new Packet(1);

        // Set type = 0x05 (TYPE_STREAM, bits 0-3)
        packet.setType(TYPE_STREAM);
        // Set EOS = 1 (bit 4)
        // Set Live = 1 (bit 5)
        packet.setStreamInfo(1, 0, true, true);
        // Set impulse = 1 (bit 6)
        packet.setImpulse(1);
        // Set error = 1 (bit 7)
        packet.setError(1);

        // Expected flags: 0b11110101 = 0xF5 = 245
        // Bit 0-3: 0101 (type 5)
        // Bit 4: 1 (EOS)
        // Bit 5: 1 (live)
        // Bit 6: 1 (impulse)
        // Bit 7: 1 (error)
        expect(packet.flags).toBe(0b11110101);
      });
    });
  });

  describe('Buffer Size Estimation', () => {
    it('should estimate ~32 bytes for TYPE_PING packets', () => {
      const packet = createPacket(1, 1, TYPE_PING, null);
      const encoded = encodePacket(packet);

      // Ping packets are small - base overhead + minimal data
      // Base: 5 bytes (4 ID + 1 flags), data should be minimal for null
      expect(encoded.length).toBeLessThan(32);
    });

    it('should handle TYPE_CALL packets with larger estimated size', () => {
      const packet = createPacket(1, 1, TYPE_CALL, {
        method: 'testMethod',
        args: [1, 2, 3],
      });
      const encoded = encodePacket(packet);

      // Call packets should encode successfully with reasonable size
      expect(encoded.length).toBeLessThan(512);
      expect(encoded.length).toBeGreaterThan(5); // At least base overhead
    });

    it('should handle TYPE_STREAM packets with reasonable size', () => {
      const packet = createStreamPacket(1, 100, 0, false, true, { chunk: 'data' });
      const encoded = encodePacket(packet);

      // Stream packets have additional 8 bytes overhead (streamId + streamIndex)
      expect(encoded.length).toBeGreaterThan(13); // 5 base + 8 stream metadata
    });

    it('should add 8 bytes overhead for stream packets', () => {
      // Create a non-stream packet
      const nonStreamPacket = createPacket(1, 1, TYPE_CALL, { test: 'data' });
      const nonStreamEncoded = encodePacket(nonStreamPacket);

      // Create a stream packet with similar data
      const streamPacket = createStreamPacket(1, 100, 0, false, false, { test: 'data' });
      const streamEncoded = encodePacket(streamPacket);

      // Stream packet should be exactly 8 bytes larger (4 bytes streamId + 4 bytes streamIndex)
      expect(streamEncoded.length - nonStreamEncoded.length).toBe(8);
    });

    it('should handle different packet types with appropriate sizes', () => {
      const testCases = [
        { type: TYPE_PING, data: null },
        { type: TYPE_GET, data: { prop: 'test' } },
        { type: TYPE_SET, data: { prop: 'test', value: 123 } },
        { type: TYPE_CALL, data: { method: 'test', args: [] } },
        { type: TYPE_TASK, data: { task: 'process' } },
      ];

      for (const { type, data } of testCases) {
        const packet = createPacket(1, 1, type, data);
        const encoded = encodePacket(packet);

        // All packets should encode successfully
        expect(encoded.length).toBeGreaterThan(5); // At least base overhead
        // And not be excessively large for these small payloads
        expect(encoded.length).toBeLessThan(200);
      }
    });
  });

  describe('Stream Error Packet', () => {
    it('should create packet with correct TYPE_STREAM_ERROR type', () => {
      const packet = createStreamErrorPacket(1, 100, 'Test error message');

      expect(packet.getType()).toBe(TYPE_STREAM_ERROR);
    });

    it('should have impulse=1', () => {
      const packet = createStreamErrorPacket(1, 100, 'Test error message');

      expect(packet.getImpulse()).toBe(1);
    });

    it('should contain streamId and message', () => {
      const packet = createStreamErrorPacket(1, 100, 'Test error message');

      expect(packet.data.streamId).toBe(100);
      expect(packet.data.message).toBe('Test error message');
    });

    it('should contain optional stack trace', () => {
      const stackTrace = 'Error: Test\n  at test.ts:1:1';
      const packet = createStreamErrorPacket(1, 100, 'Test error message', stackTrace);

      expect(packet.data.stack).toBe(stackTrace);
    });

    it('should have undefined stack when not provided', () => {
      const packet = createStreamErrorPacket(1, 100, 'Test error message');

      expect(packet.data.stack).toBeUndefined();
    });

    it('should encode and decode correctly', () => {
      const original = createStreamErrorPacket(1, 100, 'Test error', 'stack trace');
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.getType()).toBe(TYPE_STREAM_ERROR);
      expect(decoded.getImpulse()).toBe(1);
      expect(decoded.data.streamId).toBe(100);
      expect(decoded.data.message).toBe('Test error');
      expect(decoded.data.stack).toBe('stack trace');
    });
  });

  describe('Stream Close Packet', () => {
    it('should create packet with correct TYPE_STREAM_CLOSE type', () => {
      const packet = createStreamClosePacket(1, 100);

      expect(packet.getType()).toBe(TYPE_STREAM_CLOSE);
    });

    it('should have impulse=1', () => {
      const packet = createStreamClosePacket(1, 100);

      expect(packet.getImpulse()).toBe(1);
    });

    it('should contain streamId', () => {
      const packet = createStreamClosePacket(1, 100);

      expect(packet.data.streamId).toBe(100);
    });

    it('should contain optional reason', () => {
      const packet = createStreamClosePacket(1, 100, 'Stream completed');

      expect(packet.data.reason).toBe('Stream completed');
    });

    it('should have undefined reason when not provided', () => {
      const packet = createStreamClosePacket(1, 100);

      expect(packet.data.reason).toBeUndefined();
    });

    it('should encode and decode correctly', () => {
      const original = createStreamClosePacket(1, 100, 'Graceful shutdown');
      const encoded = encodePacket(original);
      const decoded = decodePacket(encoded);

      expect(decoded.getType()).toBe(TYPE_STREAM_CLOSE);
      expect(decoded.getImpulse()).toBe(1);
      expect(decoded.data.streamId).toBe(100);
      expect(decoded.data.reason).toBe('Graceful shutdown');
    });
  });

  describe('Decode Validation', () => {
    it('should throw on packets smaller than 5 bytes', () => {
      // 4 bytes is less than minimum (4 bytes ID + 1 byte flags)
      const tooSmall = new Uint8Array([0x00, 0x00, 0x00, 0x01]);

      expect(() => decodePacket(tooSmall)).toThrow();
    });

    it('should throw on empty buffer', () => {
      const empty = new Uint8Array([]);

      expect(() => decodePacket(empty)).toThrow();
    });

    it('should throw on incomplete stream metadata', () => {
      // Create a valid stream packet then truncate it
      const validPacket = createStreamPacket(1, 100, 0, false, false, 'data');
      const encoded = encodePacket(validPacket);

      // Truncate to remove stream metadata (last 8 bytes)
      const truncated = encoded.slice(0, encoded.length - 4);

      // This should fail when trying to read stream metadata
      expect(() => decodePacket(truncated)).toThrow();
    });

    it('should decode valid packets correctly', () => {
      const testPackets = [
        createPacket(1, 1, TYPE_PING, null),
        createPacket(2, 1, TYPE_CALL, { method: 'test', args: [] }),
        createPacket(3, 0, TYPE_GET, { prop: 'value' }),
        createStreamPacket(4, 100, 0, false, true, 'chunk'),
        createStreamErrorPacket(5, 200, 'error'),
        createStreamClosePacket(6, 300, 'closed'),
      ];

      for (const original of testPackets) {
        const encoded = encodePacket(original);
        const decoded = decodePacket(encoded);

        expect(decoded.id).toBe(original.id);
        expect(decoded.getType()).toBe(original.getType());
        expect(decoded.getImpulse()).toBe(original.getImpulse());
      }
    });

    it('should throw SerializationError on invalid data', () => {
      // Create a buffer with valid header but truncated msgpack data
      // 0x82 indicates a 2-element map but we don't provide the elements
      const corrupted = new Uint8Array([
        0x00,
        0x00,
        0x00,
        0x01, // ID = 1
        0x00, // flags
        0x82, // Map with 2 elements (but none provided - incomplete)
      ]);

      expect(() => decodePacket(corrupted)).toThrow(SerializationError);
    });
  });

  describe('Round-trip Tests', () => {
    describe('All Packet Types', () => {
      it('should round-trip TYPE_PING packets', () => {
        const original = createPacket(1, 1, TYPE_PING, null);
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.id).toBe(original.id);
        expect(decoded.getType()).toBe(TYPE_PING);
        expect(decoded.getImpulse()).toBe(1);
        expect(decoded.data).toBeNull();
      });

      it('should round-trip TYPE_GET packets', () => {
        const original = createPacket(1, 1, TYPE_GET, { property: 'testProp' });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_GET);
        expect(decoded.data).toEqual({ property: 'testProp' });
      });

      it('should round-trip TYPE_SET packets', () => {
        const original = createPacket(1, 1, TYPE_SET, { property: 'testProp', value: 42 });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_SET);
        expect(decoded.data).toEqual({ property: 'testProp', value: 42 });
      });

      it('should round-trip TYPE_CALL packets', () => {
        const original = createPacket(1, 1, TYPE_CALL, { method: 'testMethod', args: [1, 'two', true] });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_CALL);
        expect(decoded.data).toEqual({ method: 'testMethod', args: [1, 'two', true] });
      });

      it('should round-trip TYPE_TASK packets', () => {
        const original = createPacket(1, 1, TYPE_TASK, { taskId: 'task-123', payload: { key: 'value' } });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_TASK);
        expect(decoded.data).toEqual({ taskId: 'task-123', payload: { key: 'value' } });
      });

      it('should round-trip TYPE_STREAM packets', () => {
        const original = createStreamPacket(1, 100, 5, true, true, { chunk: 'data' });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_STREAM);
        expect(decoded.data).toEqual({ chunk: 'data' });
      });

      it('should round-trip TYPE_STREAM_ERROR packets', () => {
        const original = createStreamErrorPacket(1, 100, 'Error occurred', 'at line 1');
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_STREAM_ERROR);
        expect(decoded.data).toEqual({ streamId: 100, message: 'Error occurred', stack: 'at line 1' });
      });

      it('should round-trip TYPE_STREAM_CLOSE packets', () => {
        const original = createStreamClosePacket(1, 100, 'Done');
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.getType()).toBe(TYPE_STREAM_CLOSE);
        expect(decoded.data).toEqual({ streamId: 100, reason: 'Done' });
      });
    });

    describe('Stream Packets Preserve Metadata', () => {
      it('should preserve streamId in round-trip', () => {
        const testStreamIds = [0, 1, 100, 1000, 65535, 2147483647];

        for (const streamId of testStreamIds) {
          const original = createStreamPacket(1, streamId, 0, false, false, 'data');
          const decoded = decodePacket(encodePacket(original));

          expect(decoded.streamId).toBe(streamId);
        }
      });

      it('should preserve streamIndex in round-trip', () => {
        const testIndexes = [0, 1, 100, 1000, 65535, 2147483647];

        for (const streamIndex of testIndexes) {
          const original = createStreamPacket(1, 100, streamIndex, false, false, 'data');
          const decoded = decodePacket(encodePacket(original));

          expect(decoded.streamIndex).toBe(streamIndex);
        }
      });

      it('should preserve isLast flag in round-trip', () => {
        const originalNotLast = createStreamPacket(1, 100, 0, false, false, 'data');
        const decodedNotLast = decodePacket(encodePacket(originalNotLast));
        expect(decodedNotLast.isLastChunk()).toBe(false);

        const originalLast = createStreamPacket(1, 100, 0, true, false, 'data');
        const decodedLast = decodePacket(encodePacket(originalLast));
        expect(decodedLast.isLastChunk()).toBe(true);
      });

      it('should preserve isLive flag in round-trip', () => {
        const originalNotLive = createStreamPacket(1, 100, 0, false, false, 'data');
        const decodedNotLive = decodePacket(encodePacket(originalNotLive));
        expect(decodedNotLive.isLive()).toBe(false);

        const originalLive = createStreamPacket(1, 100, 0, false, true, 'data');
        const decodedLive = decodePacket(encodePacket(originalLive));
        expect(decodedLive.isLive()).toBe(true);
      });

      it('should preserve all stream flags together in round-trip', () => {
        const original = createStreamPacket(1, 12345, 67890, true, true, { complex: 'data' });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.streamId).toBe(12345);
        expect(decoded.streamIndex).toBe(67890);
        expect(decoded.isLastChunk()).toBe(true);
        expect(decoded.isLive()).toBe(true);
        expect(decoded.data).toEqual({ complex: 'data' });
      });
    });

    describe('Error Packets Preserve Error Data', () => {
      it('should preserve error flag in round-trip', () => {
        const original = createPacket(1, 0, TYPE_CALL, { error: 'test' });
        original.setError(1);

        const decoded = decodePacket(encodePacket(original));
        expect(decoded.getError()).toBe(1);
      });

      it('should preserve stream error data in round-trip', () => {
        const longMessage = 'A'.repeat(1000);
        const longStack = 'Stack: ' + 'at line\n'.repeat(50);

        const original = createStreamErrorPacket(1, 999, longMessage, longStack);
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.data.streamId).toBe(999);
        expect(decoded.data.message).toBe(longMessage);
        expect(decoded.data.stack).toBe(longStack);
      });

      it('should handle error packets with complex error objects', () => {
        const errorData = {
          code: 'E_STREAM_FAILED',
          message: 'Stream processing failed',
          details: {
            streamId: 100,
            failedAt: 'chunk 5',
            reason: 'Connection lost',
          },
          timestamp: Date.now(),
        };

        const original = createPacket(1, 0, TYPE_CALL, errorData);
        original.setError(1);

        const decoded = decodePacket(encodePacket(original));
        expect(decoded.getError()).toBe(1);
        expect(decoded.data).toEqual(errorData);
      });
    });

    describe('Complex Data Structures', () => {
      it('should round-trip nested objects', () => {
        const complexData = {
          level1: {
            level2: {
              level3: {
                value: 'deep',
                array: [1, 2, 3],
              },
            },
          },
        };

        const original = createPacket(1, 1, TYPE_CALL, complexData);
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.data).toEqual(complexData);
      });

      it('should round-trip arrays of various types', () => {
        const arrayData = {
          numbers: [1, 2, 3, 4, 5],
          strings: ['a', 'b', 'c'],
          mixed: [1, 'two', true, null],
          nested: [
            [1, 2],
            [3, 4],
          ],
        };

        const original = createPacket(1, 1, TYPE_CALL, arrayData);
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.data).toEqual(arrayData);
      });

      it('should round-trip dates', () => {
        const date = new Date('2025-01-01T00:00:00Z');
        const original = createPacket(1, 1, TYPE_CALL, { timestamp: date });
        const decoded = decodePacket(encodePacket(original));

        expect(decoded.data.timestamp).toEqual(date);
      });

      it('should round-trip binary data (Buffer)', () => {
        // Note: The serializer uses Buffer, not raw Uint8Array
        const { Buffer } = require('buffer');
        const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff]);
        const original = createPacket(1, 1, TYPE_CALL, { binary: binaryData });
        const decoded = decodePacket(encodePacket(original));

        // Buffer round-trips as Uint8Array in msgpack
        expect(new Uint8Array(decoded.data.binary)).toEqual(new Uint8Array(binaryData));
      });
    });
  });
});
