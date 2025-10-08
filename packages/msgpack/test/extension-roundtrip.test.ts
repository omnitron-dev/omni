import { describe, it, expect } from '@jest/globals';
import { Serializer } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

describe('Extension type roundtrip', () => {
  it('should encode and decode custom type correctly', () => {
    class TestClass {
      constructor(public a: string, public b: number, public c: object) {}
    }

    const ser = new Serializer();
    ser.register(
      100,
      TestClass,
      (obj: TestClass, buf: SmartBuffer) => {
        console.log('[Encoder] Encoding TestClass:', obj);
        ser.encode(obj.a, buf);
        ser.encode(obj.b, buf);
        ser.encode(obj.c, buf);
        console.log('[Encoder] Encoded TestClass, buffer position:', buf.woffset);
      },
      (buf: SmartBuffer) => {
        console.log('[Decoder] Decoding TestClass, roffset:', buf.roffset, 'woffset:', buf.woffset);
        const a = ser.decode(buf);
        console.log('[Decoder] Decoded a:', a, 'roffset:', buf.roffset);
        const b = ser.decode(buf);
        console.log('[Decoder] Decoded b:', b, 'roffset:', buf.roffset);
        const c = ser.decode(buf);
        console.log('[Decoder] Decoded c:', c, 'roffset:', buf.roffset);
        return new TestClass(a, b, c);
      }
    );

    const original = new TestClass('hello', 42, { nested: { value: 123 } });
    const encoded = ser.encode(original);
    console.log('Encoded buffer length:', encoded.length);

    const decoded = ser.decode(encoded);
    console.log('Decoded:', decoded);

    expect(decoded).toBeInstanceOf(TestClass);
    expect(decoded.a).toBe('hello');
    expect(decoded.b).toBe(42);
    expect(decoded.c).toEqual({ nested: { value: 123 } });
  });

  it('should handle nested custom types', () => {
    class Inner {
      constructor(public value: number) {}
    }

    class Outer {
      constructor(public name: string, public inner: Inner) {}
    }

    const ser = new Serializer();

    ser.register(
      101,
      Inner,
      (obj: Inner, buf: SmartBuffer) => {
        ser.encode(obj.value, buf);
      },
      (buf: SmartBuffer) => {
        return new Inner(ser.decode(buf));
      }
    );

    ser.register(
      102,
      Outer,
      (obj: Outer, buf: SmartBuffer) => {
        ser.encode(obj.name, buf);
        ser.encode(obj.inner, buf);
      },
      (buf: SmartBuffer) => {
        const name = ser.decode(buf);
        const inner = ser.decode(buf);
        return new Outer(name, inner);
      }
    );

    const original = new Outer('test', new Inner(999));
    const encoded = ser.encode(original);
    const decoded = ser.decode(encoded);

    expect(decoded).toBeInstanceOf(Outer);
    expect(decoded.name).toBe('test');
    expect(decoded.inner).toBeInstanceOf(Inner);
    expect(decoded.inner.value).toBe(999);
  });
});
