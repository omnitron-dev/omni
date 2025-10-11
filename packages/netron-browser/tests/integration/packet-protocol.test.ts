/**
 * Packet Protocol Compatibility Tests
 * Tests packet encoding/decoding compatibility between browser client and Titan server
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { WebSocketClient } from '../../src/client/ws-client.js';
import { Packet } from '../../src/packet/packet.js';
import { serializer } from '../../src/packet/serializer.js';
import { SmartBuffer } from '@omnitron-dev/smartbuffer';
import { TitanError, ErrorCode } from '../../src/errors/index.js';
import { Reference } from '../../src/core/reference.js';
import { Definition } from '../../src/core/definition.js';
import { StreamReference } from '../../src/core/stream-reference.js';

describe('Packet Protocol Compatibility', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Packet Structure Validation', () => {
    it('should create packets with unique IDs', () => {
      const ids = new Set<number>();
      for (let i = 0; i < 1000; i++) {
        const id = Packet.nextId();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
    });

    it('should reset packet ID generator', () => {
      Packet.resetId();
      const firstId = Packet.nextId();

      Packet.resetId();
      const secondId = Packet.nextId();

      expect(secondId).toBe(firstId);
    });

    it('should handle all packet types', () => {
      const types = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

      for (const type of types) {
        const packet = new Packet(Packet.nextId());
        packet.setType(type);
        expect(packet.getType()).toBe(type);
      }
    });

    it('should preserve packet type when setting other flags', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(5);

      packet.setImpulse(1);
      expect(packet.getType()).toBe(5);

      packet.setError(1);
      expect(packet.getType()).toBe(5);

      packet.setStreamInfo(100, 0, false, true);
      expect(packet.getType()).toBe(5);
    });
  });

  describe('Packet Flag Operations', () => {
    it('should handle impulse flag independently', () => {
      const packet = new Packet(Packet.nextId());

      packet.setImpulse(1);
      expect(packet.getImpulse()).toBe(1);

      packet.setImpulse(0);
      expect(packet.getImpulse()).toBe(0);
    });

    it('should handle error flag independently', () => {
      const packet = new Packet(Packet.nextId());

      packet.setError(1);
      expect(packet.getError()).toBe(1);

      packet.setError(0);
      expect(packet.getError()).toBe(0);
    });

    it('should handle stream flags correctly', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(4); // STREAM type

      // Not last, not live
      packet.setStreamInfo(1, 0, false, false);
      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(false);

      // Last chunk, not live
      packet.setStreamInfo(1, 1, true, false);
      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(false);

      // Not last, live
      packet.setStreamInfo(1, 0, false, true);
      expect(packet.isLastChunk()).toBe(false);
      expect(packet.isLive()).toBe(true);

      // Last chunk, live
      packet.setStreamInfo(1, 5, true, true);
      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(true);
    });

    it('should identify stream chunks correctly', () => {
      const packet = new Packet(Packet.nextId());

      packet.setType(4); // STREAM type
      expect(packet.isStreamChunk()).toBe(true);

      packet.setType(1); // REQUEST type
      expect(packet.isStreamChunk()).toBe(false);
    });
  });

  describe('Packet Data Serialization', () => {
    it('should handle primitive data types in packets', () => {
      const testData = [
        null,
        true,
        false,
        42,
        -123.456,
        'test string',
        '',
      ];

      for (const data of testData) {
        const packet = new Packet(Packet.nextId());
        packet.data = data;

        // Encode and decode through serializer
        const encoded = serializer.encode(packet.data);
        const decoded = serializer.decode(SmartBuffer.wrap(encoded));

        expect(decoded).toEqual(data);
      }
    });

    it('should handle complex objects in packet data', () => {
      const packet = new Packet(Packet.nextId());
      packet.data = {
        service: 'test@1.0.0',
        method: 'testMethod',
        args: [1, 'two', { three: 3 }],
        metadata: {
          timestamp: Date.now(),
          requestId: 'req-123',
        },
      };

      const encoded = serializer.encode(packet.data);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toEqual(packet.data);
    });

    it('should handle arrays in packet data', () => {
      const packet = new Packet(Packet.nextId());
      packet.data = [1, 2, 3, 'four', { five: 5 }, [6, 7, 8]];

      const encoded = serializer.encode(packet.data);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toEqual(packet.data);
    });
  });

  describe('Stream Packet Metadata', () => {
    it('should preserve stream ID and index', () => {
      const packet = new Packet(Packet.nextId());
      packet.setType(4); // STREAM

      const streamId = 12345;
      const streamIndex = 67;

      packet.setStreamInfo(streamId, streamIndex, false, false);

      expect(packet.streamId).toBe(streamId);
      expect(packet.streamIndex).toBe(streamIndex);
    });

    it('should handle large stream IDs', () => {
      const packet = new Packet(Packet.nextId());
      const maxUint32 = 0xFFFFFFFF;

      packet.setStreamInfo(maxUint32, 0, false, false);
      expect(packet.streamId).toBe(maxUint32);
    });

    it('should handle large stream indices', () => {
      const packet = new Packet(Packet.nextId());
      const maxUint32 = 0xFFFFFFFF;

      packet.setStreamInfo(1, maxUint32, false, false);
      expect(packet.streamIndex).toBe(maxUint32);
    });
  });

  describe('End-to-End Packet Communication', () => {
    it('should successfully roundtrip simple requests', async () => {
      const result = await client.invoke('calculator@1.0.0', 'add', [10, 20]);
      expect(result).toBe(30);
    });

    it('should successfully roundtrip complex payloads', async () => {
      const complexPayload = {
        string: 'test',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'preserved',
          },
        },
      };

      const result = await client.invoke('echo@1.0.0', 'echoObject', [complexPayload]);
      expect(result).toEqual(complexPayload);
    });

    it('should handle rapid request/response cycles', async () => {
      for (let i = 0; i < 100; i++) {
        const result = await client.invoke('calculator@1.0.0', 'add', [i, 1]);
        expect(result).toBe(i + 1);
      }
    });
  });
});

describe('Custom Type Serialization', () => {
  describe('TitanError Serialization', () => {
    it('should serialize and deserialize TitanError', () => {
      const error = new TitanError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: {
          field: 'email',
          reason: 'invalid',
        },
        requestId: 'req-123',
      });

      const encoded = serializer.encode(error);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(TitanError);
      expect(decoded.code).toBe(error.code);
      expect(decoded.message).toBe(error.message);
      expect(decoded.details).toEqual(error.details);
      expect(decoded.requestId).toBe(error.requestId);
    });

    it('should preserve error stack traces', () => {
      const error = new TitanError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
      });

      // Capture stack
      const originalStack = error.stack;

      const encoded = serializer.encode(error);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded.stack).toBe(originalStack);
    });

    it('should handle all error codes', () => {
      const codes = [
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.NOT_FOUND,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
        ErrorCode.INTERNAL_ERROR,
        ErrorCode.SERVICE_UNAVAILABLE,
        ErrorCode.TIMEOUT,
      ];

      for (const code of codes) {
        const error = new TitanError({
          code,
          message: `Error ${code}`,
        });

        const encoded = serializer.encode(error);
        const decoded = serializer.decode(SmartBuffer.wrap(encoded));

        expect(decoded.code).toBe(code);
      }
    });
  });

  describe('Reference Serialization', () => {
    it('should serialize and deserialize Reference', () => {
      const ref = new Reference('service@1.0.0');

      const encoded = serializer.encode(ref);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(Reference);
      expect(decoded.defId).toBe(ref.defId);
    });

    it('should handle multiple references', () => {
      const refs = [
        new Reference('service1@1.0.0'),
        new Reference('service2@2.0.0'),
        new Reference('service3@3.0.0'),
      ];

      const encoded = serializer.encode(refs);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(Array.isArray(decoded)).toBe(true);
      expect(decoded.length).toBe(3);
      decoded.forEach((ref: Reference, i: number) => {
        expect(ref).toBeInstanceOf(Reference);
        expect(ref.defId).toBe(refs[i].defId);
      });
    });
  });

  describe('Definition Serialization', () => {
    it('should serialize and deserialize Definition', () => {
      const def = new Definition('service@1.0.0', 'peer-123', {
        version: '1.0.0',
        methods: ['add', 'subtract'],
      });
      def.parentId = 'parent-456';

      const encoded = serializer.encode(def);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(Definition);
      expect(decoded.id).toBe(def.id);
      expect(decoded.peerId).toBe(def.peerId);
      expect(decoded.parentId).toBe(def.parentId);
      expect(decoded.meta).toEqual(def.meta);
    });

    it('should handle definitions without parent', () => {
      const def = new Definition('service@1.0.0', 'peer-123', {});

      const encoded = serializer.encode(def);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded.parentId).toBe('');
    });
  });

  describe('StreamReference Serialization', () => {
    it('should serialize and deserialize readable StreamReference', () => {
      const streamRef = new StreamReference(12345, 'readable', false, 'peer-123');

      const encoded = serializer.encode(streamRef);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBeInstanceOf(StreamReference);
      expect(decoded.streamId).toBe(streamRef.streamId);
      expect(decoded.type).toBe('readable');
      expect(decoded.isLive).toBe(false);
      expect(decoded.peerId).toBe(streamRef.peerId);
    });

    it('should serialize and deserialize writable StreamReference', () => {
      const streamRef = new StreamReference(67890, 'writable', true, 'peer-456');

      const encoded = serializer.encode(streamRef);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded.type).toBe('writable');
      expect(decoded.isLive).toBe(true);
    });

    it('should handle both stream types', () => {
      const refs = [
        new StreamReference(1, 'readable', false, 'peer-1'),
        new StreamReference(2, 'writable', true, 'peer-2'),
      ];

      for (const ref of refs) {
        const encoded = serializer.encode(ref);
        const decoded = serializer.decode(SmartBuffer.wrap(encoded));

        expect(decoded.streamId).toBe(ref.streamId);
        expect(decoded.type).toBe(ref.type);
        expect(decoded.isLive).toBe(ref.isLive);
        expect(decoded.peerId).toBe(ref.peerId);
      }
    });
  });

  describe('Mixed Type Serialization', () => {
    it('should handle arrays with mixed custom types', () => {
      const mixed = [
        new Reference('service@1.0.0'),
        new TitanError({ code: ErrorCode.INTERNAL_ERROR, message: 'Error' }),
        new Definition('def@1.0.0', 'peer-1', {}),
        new StreamReference(1, 'readable', false, 'peer-2'),
      ];

      const encoded = serializer.encode(mixed);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded[0]).toBeInstanceOf(Reference);
      expect(decoded[1]).toBeInstanceOf(TitanError);
      expect(decoded[2]).toBeInstanceOf(Definition);
      expect(decoded[3]).toBeInstanceOf(StreamReference);
    });

    it('should handle objects with custom type properties', () => {
      const obj = {
        ref: new Reference('service@1.0.0'),
        error: new TitanError({ code: ErrorCode.NOT_FOUND, message: 'Not found' }),
        def: new Definition('def@1.0.0', 'peer-1', {}),
        stream: new StreamReference(1, 'readable', false, 'peer-2'),
        primitives: {
          string: 'test',
          number: 42,
          boolean: true,
        },
      };

      const encoded = serializer.encode(obj);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded.ref).toBeInstanceOf(Reference);
      expect(decoded.error).toBeInstanceOf(TitanError);
      expect(decoded.def).toBeInstanceOf(Definition);
      expect(decoded.stream).toBeInstanceOf(StreamReference);
      expect(decoded.primitives).toEqual(obj.primitives);
    });
  });
});

describe('Protocol Edge Cases', () => {
  describe('Packet Flag Boundaries', () => {
    it('should handle all combinations of flags', () => {
      const packet = new Packet(Packet.nextId());

      // Test all 16 type values
      for (let type = 0; type < 16; type++) {
        // Test both impulse values
        for (let impulse = 0; impulse < 2; impulse++) {
          // Test both error values
          for (let error = 0; error < 2; error++) {
            packet.setType(type);
            packet.setImpulse(impulse as 0 | 1);
            packet.setError(error as 0 | 1);

            expect(packet.getType()).toBe(type);
            expect(packet.getImpulse()).toBe(impulse);
            expect(packet.getError()).toBe(error);
          }
        }
      }
    });

    it('should handle maximum stream values', () => {
      const packet = new Packet(Packet.nextId());
      const maxUint32 = 0xFFFFFFFF;

      packet.setStreamInfo(maxUint32, maxUint32, true, true);

      expect(packet.streamId).toBe(maxUint32);
      expect(packet.streamIndex).toBe(maxUint32);
      expect(packet.isLastChunk()).toBe(true);
      expect(packet.isLive()).toBe(true);
    });
  });

  describe('Serialization Limits', () => {
    it('should handle empty payloads', () => {
      const values = [null, undefined, '', [], {}];

      for (const value of values) {
        const encoded = serializer.encode(value);
        const decoded = serializer.decode(SmartBuffer.wrap(encoded));
        expect(decoded).toEqual(value);
      }
    });

    it('should handle large arrays', () => {
      const largeArray = Array.from({ length: 10000 }, (_, i) => i);

      const encoded = serializer.encode(largeArray);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toEqual(largeArray);
    });

    it('should handle deeply nested objects', () => {
      let deepObj: any = { value: 'bottom' };
      for (let i = 0; i < 50; i++) {
        deepObj = { nested: deepObj };
      }

      const encoded = serializer.encode(deepObj);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      // Verify deep structure preserved
      let current = decoded;
      for (let i = 0; i < 50; i++) {
        expect(current).toHaveProperty('nested');
        current = current.nested;
      }
      expect(current.value).toBe('bottom');
    });

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(100000);

      const encoded = serializer.encode(longString);
      const decoded = serializer.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toBe(longString);
    });
  });
});
