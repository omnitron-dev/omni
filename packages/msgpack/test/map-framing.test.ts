import { deepStrictEqual } from 'node:assert';
import { decode as referenceDecode, encode as referenceEncode } from '@msgpack/msgpack';
import { describe, expect, it } from 'vitest';
import { decode, encode, Serializer, serializer, tryDecode } from '../src/index.js';
import { SmartBuffer } from '../src/smart-buffer.js';

function entries(count: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (let i = 0; i < count; i++) result[`k${i}`] = i;
  return result;
}

describe('MessagePack map framing', () => {
  it.each([
    [15, '8f'],
    [16, 'de0010'],
    [65_535, 'deffff'],
    [65_536, 'df00010000'],
    [70_000, 'df00011170'],
  ] as const)('interoperates at %i pairs', (count, header) => {
    const record = entries(count);
    const bytes = encode(record);
    expect(bytes.subarray(0, header.length / 2).toString('hex')).toBe(header);
    deepStrictEqual(referenceDecode(bytes), record);
    deepStrictEqual(decode(referenceEncode(record)), record);
  });

  it('reads a sibling after a nested map at the map32 boundary', () => {
    const value = [entries(65_536), 99];
    const bytes = encode(value);
    deepStrictEqual(decode(bytes), value);
    deepStrictEqual(tryDecode(Buffer.concat([bytes, encode(42)])), { value, bytesConsumed: bytes.length });
  });

  it.each([
    ['df00000000', {}],
    ['df00000001a16101', { a: 1 }],
    ['df00000001a16192d40000c3', { a: [undefined, true] }],
  ] as const)('reads one independently framed map %s', (hex, value) => {
    const bytes = Buffer.from(hex, 'hex');
    for (let size = 0; size < bytes.length; size++) {
      expect(tryDecode(bytes.subarray(0, size))).toBeNull();
    }
    expect(decode(bytes)).toStrictEqual(value);
    expect(tryDecode(Buffer.concat([bytes, Buffer.from([99])]))).toStrictEqual({ value, bytesConsumed: bytes.length });
  });

  it('reads UTF-8 keys and binary values from a Uint8Array subview', () => {
    const wire = referenceEncode({ имя: Uint8Array.of(1, 2, 3) });
    const backing = new Uint8Array(wire.length + 7);
    backing.set(wire, 3);
    const view = backing.subarray(3, 3 + wire.length);
    expect(decode(view)).toStrictEqual({ имя: Buffer.from([1, 2, 3]) });
    expect(serializer.decode(view)).toStrictEqual(decode(view));
  });

  it('keeps object keys as own data properties with all map widths', () => {
    const value = { ['__proto__']: 10, constructor: 20, prototype: 30 };
    const pairs = referenceEncode(value).subarray(1);
    for (const header of ['83', 'de0003', 'df00000003']) {
      const result = decode(Buffer.concat([Buffer.from(header, 'hex'), pairs]));
      deepStrictEqual(result, value);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    }
    // Integer keys in standard maps are represented as JavaScript property names.
    expect(decode(Buffer.from('df000000012ac3', 'hex'))).toStrictEqual({ 42: true });
  });

  it('round-trips ordinary data fields named like Buffer properties', () => {
    const value = { _isBuffer: true, length: 4, name: 'record' };
    expect(decode(encode(value))).toStrictEqual(value);
  });

  it('keeps completed messages and resumes after a nested encode error', () => {
    class Entry {}
    const codec = new Serializer();
    codec.register(
      1,
      Entry,
      (_entry, buffer) => {
        try {
          codec.encode(Symbol('unsupported'), buffer);
        } catch {
          codec.encode('replacement', buffer);
        }
      },
      (buffer) => codec.decode(buffer)
    );
    const saved = codec.encode({ saved: 1 });
    const bytes = codec.encode([new Entry(), 99]);
    expect(codec.decode(bytes)).toStrictEqual(['replacement', 99]);
    expect(codec.decode(saved)).toStrictEqual({ saved: 1 });
    saved.fill(0);
    expect(codec.decode(bytes)).toStrictEqual(['replacement', 99]);
  });

  it('peeks at the unread bytes while a map arrives in chunks', () => {
    const buffer = new SmartBuffer();
    buffer.write(Buffer.from('25df0000', 'hex'));
    expect(serializer.decode(buffer)).toBe(37);
    expect(tryDecode(buffer)).toBeNull();
    expect(buffer.roffset).toBe(1);
    buffer.write(Buffer.from('0001a1610163', 'hex'));
    expect(decode(buffer)).toStrictEqual({ a: 1 });
    expect(tryDecode(buffer)).toStrictEqual({ value: { a: 1 }, bytesConsumed: 8 });
    expect(buffer.roffset).toBe(1);
    expect(serializer.decode(buffer)).toStrictEqual({ a: 1 });
    expect(serializer.decode(buffer)).toBe(99);
    expect(buffer.length).toBe(0);
  });

  it('keeps the cursor at an invalid marker after a complete frame', () => {
    const buffer = SmartBuffer.fromBuffer(Buffer.from('df00000000c1', 'hex'));
    expect(serializer.decode(buffer)).toStrictEqual({});
    expect(() => serializer.decode(buffer)).toThrow('Unknown MessagePack type');
    expect(buffer.roffset).toBe(5);
  });

  it.each([
    ['de0001a1', 3],
    ['df00000001a1', 5],
    ['df0000', 3],
    ['dc0002c0', 3],
    ['dd00000002c0', 5],
    ['d90361', 2],
    ['da000361', 3],
    ['db0000000361', 5],
    ['c70301aa', 3],
  ] as const)('consumes the available header of incomplete %s', (hex, consumed) => {
    const buffer = SmartBuffer.fromBuffer(Buffer.from(hex, 'hex'));
    expect(() => serializer.decode(buffer)).toThrow('Incomplete buffer');
    expect(buffer.roffset).toBe(consumed);
  });

  it('reports an incomplete 32-bit count when the pairs cannot fit in the input', () => {
    expect(tryDecode(Buffer.from('dfffffffff', 'hex'))).toBeNull();
    expect(() => decode(Buffer.from('dfffffffff', 'hex'))).toThrow('Incomplete buffer');
  });
});
