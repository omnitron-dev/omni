/**
 * Tests for nested decode fix in Decoder
 *
 * These tests verify that the Decoder correctly handles nested decode calls
 * when processing arrays and objects containing custom types.
 *
 * The fix addresses the issue where the shared DataView state was corrupted
 * during nested decode calls from custom type decoders.
 */

import { describe, it, expect } from 'vitest';
import { Serializer } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

describe('Nested decode with custom types', () => {
  /**
   * Custom type simulating Reference from netron
   */
  class Reference {
    constructor(public defId: string) {}
  }

  /**
   * Custom type simulating Definition from netron
   */
  class Definition {
    constructor(
      public id: string,
      public peerId: string,
      public meta: Record<string, any>
    ) {}
  }

  /**
   * Custom type simulating StreamReference from netron
   */
  class StreamReference {
    constructor(
      public streamId: number,
      public type: 'readable' | 'writable',
      public isLive: boolean,
      public peerId: string
    ) {}
  }

  /**
   * Custom type simulating TitanError with many fields
   */
  class TitanError {
    constructor(
      public code: number,
      public message: string,
      public details: Record<string, any>,
      public context: Record<string, any>,
      public timestamp: number,
      public requestId: string | null,
      public stack: string | null
    ) {}
  }

  function createSerializer(): Serializer {
    const ser = new Serializer();

    // Register Reference (type 108)
    ser.register(
      108,
      Reference,
      (obj: Reference, buf: SmartBuffer) => {
        ser.encode(obj.defId, buf);
      },
      (buf: SmartBuffer) => new Reference(ser.decode(buf))
    );

    // Register Definition (type 109)
    ser.register(
      109,
      Definition,
      (obj: Definition, buf: SmartBuffer) => {
        ser.encode(obj.id, buf);
        ser.encode(obj.peerId, buf);
        ser.encode(obj.meta, buf);
      },
      (buf: SmartBuffer) => {
        const id = ser.decode(buf);
        const peerId = ser.decode(buf);
        const meta = ser.decode(buf);
        return new Definition(id, peerId, meta);
      }
    );

    // Register StreamReference (type 107) - mixed serializer.encode and direct writes
    ser.register(
      107,
      StreamReference,
      (obj: StreamReference, buf: SmartBuffer) => {
        ser.encode(obj.streamId.toString(), buf);
        buf.writeUInt8(obj.type === 'writable' ? 1 : 0);
        buf.writeUInt8(obj.isLive ? 1 : 0);
        ser.encode(obj.peerId, buf);
      },
      (buf: SmartBuffer) => {
        const streamId = Number(ser.decode(buf));
        const streamType = buf.readUInt8() === 1 ? 'writable' : 'readable';
        const isLive = buf.readUInt8() === 1;
        const peerId = ser.decode(buf);
        return new StreamReference(streamId, streamType as 'readable' | 'writable', isLive, peerId);
      }
    );

    // Register TitanError (type 110) - many fields requiring multiple decode calls
    ser.register(
      110,
      TitanError,
      (obj: TitanError, buf: SmartBuffer) => {
        ser.encode(obj.code, buf);
        ser.encode(obj.message, buf);
        ser.encode(obj.details, buf);
        ser.encode(obj.context, buf);
        ser.encode(obj.timestamp, buf);
        ser.encode(obj.requestId, buf);
        ser.encode(obj.stack, buf);
      },
      (buf: SmartBuffer) => {
        const code = ser.decode(buf);
        const message = ser.decode(buf);
        const details = ser.decode(buf);
        const context = ser.decode(buf);
        const timestamp = ser.decode(buf);
        const requestId = ser.decode(buf);
        const stack = ser.decode(buf);
        return new TitanError(code, message, details, context, timestamp, requestId, stack);
      }
    );

    return ser;
  }

  describe('Arrays with mixed custom types', () => {
    it('should handle arrays with multiple different custom types', () => {
      const ser = createSerializer();

      const mixed = [
        new Reference('service@1.0.0'),
        new TitanError(500, 'Internal Error', { foo: 'bar' }, {}, Date.now(), null, null),
        new Definition('def@1.0.0', 'peer-1', { method: 'test' }),
        new StreamReference(12345, 'readable', false, 'peer-2'),
      ];

      const encoded = ser.encode(mixed);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toHaveLength(4);
      expect(decoded[0]).toBeInstanceOf(Reference);
      expect(decoded[0].defId).toBe('service@1.0.0');
      expect(decoded[1]).toBeInstanceOf(TitanError);
      expect(decoded[1].code).toBe(500);
      expect(decoded[1].message).toBe('Internal Error');
      expect(decoded[2]).toBeInstanceOf(Definition);
      expect(decoded[2].id).toBe('def@1.0.0');
      expect(decoded[3]).toBeInstanceOf(StreamReference);
      expect(decoded[3].streamId).toBe(12345);
      expect(decoded[3].type).toBe('readable');
    });

    it('should handle arrays with repeated custom types', () => {
      const ser = createSerializer();

      const refs = [
        new Reference('svc1@1.0.0'),
        new Reference('svc2@1.0.0'),
        new Reference('svc3@1.0.0'),
        new Reference('svc4@1.0.0'),
        new Reference('svc5@1.0.0'),
      ];

      const encoded = ser.encode(refs);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(decoded[i]).toBeInstanceOf(Reference);
        expect(decoded[i].defId).toBe(`svc${i + 1}@1.0.0`);
      }
    });

    it('should handle arrays with custom types and primitives mixed', () => {
      const ser = createSerializer();

      const mixed = [
        'string value',
        42,
        new Reference('svc@1.0.0'),
        true,
        new Definition('def@1.0.0', 'peer-1', {}),
        null,
        [1, 2, 3],
        new StreamReference(1, 'writable', true, 'peer-2'),
      ];

      const encoded = ser.encode(mixed);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toHaveLength(8);
      expect(decoded[0]).toBe('string value');
      expect(decoded[1]).toBe(42);
      expect(decoded[2]).toBeInstanceOf(Reference);
      expect(decoded[3]).toBe(true);
      expect(decoded[4]).toBeInstanceOf(Definition);
      expect(decoded[5]).toBe(null);
      expect(decoded[6]).toEqual([1, 2, 3]);
      expect(decoded[7]).toBeInstanceOf(StreamReference);
    });
  });

  describe('Objects with custom type properties', () => {
    it('should handle objects with custom type values', () => {
      const ser = createSerializer();

      const obj = {
        ref: new Reference('service@1.0.0'),
        error: new TitanError(404, 'Not found', {}, {}, Date.now(), 'req-123', null),
        def: new Definition('def@1.0.0', 'peer-1', { foo: 'bar' }),
        stream: new StreamReference(999, 'readable', false, 'peer-2'),
        primitives: {
          string: 'test',
          number: 42,
          boolean: true,
        },
      };

      const encoded = ser.encode(obj);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded.ref).toBeInstanceOf(Reference);
      expect(decoded.ref.defId).toBe('service@1.0.0');
      expect(decoded.error).toBeInstanceOf(TitanError);
      expect(decoded.error.code).toBe(404);
      expect(decoded.def).toBeInstanceOf(Definition);
      expect(decoded.def.id).toBe('def@1.0.0');
      expect(decoded.stream).toBeInstanceOf(StreamReference);
      expect(decoded.stream.streamId).toBe(999);
      expect(decoded.primitives).toEqual({ string: 'test', number: 42, boolean: true });
    });

    it('should handle deeply nested objects with custom types', () => {
      const ser = createSerializer();

      const deep = {
        level1: {
          level2: {
            level3: {
              ref: new Reference('deep@1.0.0'),
              items: [new Definition('def1', 'peer1', {}), new Definition('def2', 'peer2', {})],
            },
          },
        },
      };

      const encoded = ser.encode(deep);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded.level1.level2.level3.ref).toBeInstanceOf(Reference);
      expect(decoded.level1.level2.level3.ref.defId).toBe('deep@1.0.0');
      expect(decoded.level1.level2.level3.items).toHaveLength(2);
      expect(decoded.level1.level2.level3.items[0]).toBeInstanceOf(Definition);
      expect(decoded.level1.level2.level3.items[1]).toBeInstanceOf(Definition);
    });
  });

  describe('DataView state preservation', () => {
    it('should preserve DataView state across multiple nested decode calls', () => {
      const ser = createSerializer();

      // TitanError with complex details containing arrays and nested objects
      const error = new TitanError(
        500,
        'Complex error',
        {
          validationErrors: [
            { field: 'name', message: 'Required' },
            { field: 'email', message: 'Invalid format' },
          ],
          metadata: {
            requestTime: 12345,
            retryCount: 3,
          },
        },
        { userId: 'user-123' },
        Date.now(),
        'req-456',
        'Error: ...\n  at line 1'
      );

      // Wrap in array to trigger the nested decode bug
      const data = [error, new Reference('svc@1.0.0')];

      const encoded = ser.encode(data);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toHaveLength(2);
      expect(decoded[0]).toBeInstanceOf(TitanError);
      expect(decoded[0].details.validationErrors).toHaveLength(2);
      expect(decoded[0].details.metadata.requestTime).toBe(12345);
      expect(decoded[1]).toBeInstanceOf(Reference);
      expect(decoded[1].defId).toBe('svc@1.0.0');
    });

    it('should handle many sequential custom types without DataView corruption', () => {
      const ser = createSerializer();

      const items: Array<Reference | Definition | StreamReference | TitanError> = [];
      for (let i = 0; i < 50; i++) {
        if (i % 4 === 0) {
          items.push(new Reference(`svc-${i}@1.0.0`));
        } else if (i % 4 === 1) {
          items.push(new Definition(`def-${i}`, `peer-${i}`, { index: i }));
        } else if (i % 4 === 2) {
          items.push(new StreamReference(i, i % 2 === 0 ? 'readable' : 'writable', i % 3 === 0, `peer-${i}`));
        } else {
          items.push(new TitanError(400 + i, `Error ${i}`, {}, {}, Date.now(), null, null));
        }
      }

      const encoded = ser.encode(items);
      const decoded = ser.decode(SmartBuffer.wrap(encoded));

      expect(decoded).toHaveLength(50);

      // Verify each item was correctly decoded
      for (let i = 0; i < 50; i++) {
        const item = decoded[i];
        if (i % 4 === 0) {
          expect(item).toBeInstanceOf(Reference);
          expect(item.defId).toBe(`svc-${i}@1.0.0`);
        } else if (i % 4 === 1) {
          expect(item).toBeInstanceOf(Definition);
          expect(item.id).toBe(`def-${i}`);
        } else if (i % 4 === 2) {
          expect(item).toBeInstanceOf(StreamReference);
          expect(item.streamId).toBe(i);
        } else {
          expect(item).toBeInstanceOf(TitanError);
          expect(item.code).toBe(400 + i);
        }
      }
    });
  });

  describe('SmartBuffer.wrap roundtrip', () => {
    it('should correctly decode when using SmartBuffer.wrap', () => {
      const ser = createSerializer();

      const original = {
        refs: [new Reference('a'), new Reference('b'), new Reference('c')],
        defs: [new Definition('d1', 'p1', {}), new Definition('d2', 'p2', {})],
      };

      const encoded = ser.encode(original);

      // Test with SmartBuffer.wrap (how netron-browser uses it)
      const decodedFromWrap = ser.decode(SmartBuffer.wrap(encoded));

      expect(decodedFromWrap.refs).toHaveLength(3);
      expect(decodedFromWrap.refs[0]).toBeInstanceOf(Reference);
      expect(decodedFromWrap.refs[0].defId).toBe('a');
      expect(decodedFromWrap.defs).toHaveLength(2);
      expect(decodedFromWrap.defs[0]).toBeInstanceOf(Definition);
    });

    it('should correctly decode Buffer directly', () => {
      const ser = createSerializer();

      const original = [new Reference('test'), new Definition('def', 'peer', { value: 123 })];

      const encoded = ser.encode(original);

      // Test with direct Buffer (for comparison)
      const decodedFromBuffer = ser.decode(encoded);

      expect(decodedFromBuffer).toHaveLength(2);
      expect(decodedFromBuffer[0]).toBeInstanceOf(Reference);
      expect(decodedFromBuffer[1]).toBeInstanceOf(Definition);
    });
  });
});
