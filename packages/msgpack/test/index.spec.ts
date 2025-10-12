import { describe, it, expect } from '@jest/globals';
import Long from 'long';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SmartBuffer } from '../src/smart-buffer.js';

import { Serializer, serializer } from '../src/index.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Serializer', () => {
  it('encode/decode booleans', () => {
    let input = true;
    let encoded = serializer.encode(input);
    let output = serializer.decode(encoded);
    expect(input).toEqual(output);

    input = false;
    encoded = serializer.encode(input);
    output = serializer.decode(encoded);
    expect(input).toEqual(output);
  });

  describe('1-byte-length-buffers', () => {
    const build = (size: number): Buffer => {
      const buf = Buffer.allocUnsafe(size);
      buf.fill('a');

      return buf;
    };

    describe('encode/decode 2^8-1 bytes buffers', () => {
      const all: Buffer[] = [];

      all.push(build(Math.pow(2, 8) - 1));
      all.push(build(Math.pow(2, 6) + 1));
      all.push(build(1));
      all.push(Buffer.allocUnsafe(0));

      all.forEach((orig) => {
        it(`mirror test a buffer of length ${orig.length}`, () => {
          const input = orig;
          const encoded = serializer.encode(input);
          const output = serializer.decode(encoded);
          expect(Buffer.compare(output, input)).toEqual(0);
          // assert.equal(serializer.decode(serializer.encode(orig)).toString(), orig.toString(), 'must stay the same')
        });
      });
    });

    it('decoding a chopped 2^8-1 bytes buffer', () => {
      const orig = build(Math.pow(2, 6));
      const buf = Buffer.allocUnsafe(2 + orig.length);
      buf[0] = 0xc4;
      buf[1] = Math.pow(2, 8) - 1; // set bigger size
      orig.copy(buf, 2);
      const sbuf = SmartBuffer.fromBuffer(buf);
      const origLength = sbuf.length;
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
      expect(sbuf.length).toEqual(origLength - 2);
    });

    it('decoding an incomplete header of 2^8-1 bytes buffer', () => {
      const buf = Buffer.allocUnsafe(1);
      buf[0] = 0xc4;
      const sbuf = SmartBuffer.fromBuffer(buf);
      const origLength = sbuf.length;
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
      expect(sbuf.length).toEqual(origLength - 1);
    });
  });

  describe('1-byte-length-exts', () => {
    const customSerializer = new Serializer();

    class MyType {
      value: string;
      size: number;

      constructor(size: number, value: string) {
        this.value = value;
        this.size = size;
      }
    }

    const mytypeEncode = (obj: MyType, resbuf: { write: (buf: Buffer) => void }) => {
      const buf = Buffer.allocUnsafe(obj.size);
      buf.fill(obj.value);
      resbuf.write(buf);
    };

    const mytypeDecode = (buf: SmartBuffer): MyType => {
      const result = new MyType(buf.length, buf.toString('utf8', 0, 1));

      for (let i = 0; i < buf.length; i++) {
        if (buf.readUInt8(0) !== buf.readUInt8(i)) {
          throw new Error('should all be the same');
        }
      }

      return result;
    };

    customSerializer.register(0x42, MyType, mytypeEncode, mytypeDecode);

    it('encode/decode variable ext data up to 0xff', () => {
      const all: any[] = [];

      // no 1 as it's a fixext
      // no 2 as it's a fixext
      all.push(new MyType(3, 'a'));
      // no 4 as it's a fixext
      all.push(new MyType(5, 'a'));
      all.push(new MyType(6, 'a'));
      all.push(new MyType(7, 'a'));
      // no 8 as it's a fixext
      all.push(new MyType(9, 'a'));
      all.push(new MyType(10, 'a'));
      all.push(new MyType(11, 'a'));
      all.push(new MyType(12, 'a'));
      all.push(new MyType(13, 'a'));
      all.push(new MyType(14, 'a'));
      all.push(new MyType(15, 'a'));
      // no 16 as it's a fixext
      all.push(new MyType(17, 'a'));

      all.push(new MyType(255, 'a'));

      all.forEach((orig) => {
        const encoded = customSerializer.encode(orig);
        const output = customSerializer.decode(encoded);
        expect(output).toEqual(orig);
      });
    });

    it('decoding an incomplete variable ext data up to 0xff', () => {
      const length = 250;
      const obj = customSerializer.encode(new MyType(length, 'a'));
      const buf = Buffer.allocUnsafe(length);
      buf[0] = 0xc7;
      buf.writeUInt8(length + 2, 1); // set bigger size
      obj.toBuffer().copy(buf, 2, 2, length);
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => customSerializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of variable ext data up to 0xff', () => {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xc7;
      const sbuf = new SmartBuffer().write(buf);
      expect(() => customSerializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('1-byte-length-strings', () => {
    it('encode/decode 32 <-> (2^8-1) bytes strings', () => {
      const all: any[] = [];
      let i: string | any[];

      // build base
      for (i = 'a'; i.length < 32; i += 'a') {
        //
      }

      for (; i.length < Math.pow(2, 8); i += 'aaaaa') {
        all.push(i);
      }

      all.forEach((str) => {
        expect(serializer.decode(serializer.encode(str))).toEqual(str);
      });
    });

    it('decoding a chopped string', () => {
      let str: string | any[] | ArrayBuffer | DataView<ArrayBufferLike>;
      for (str = 'a'; str.length < 40; str += 'a') {
        //
      }
      const buf = Buffer.allocUnsafe(2 + Buffer.byteLength(str));
      buf[0] = 0xd9;
      buf[1] = Buffer.byteLength(str) + 10; // set bigger size
      buf.write(str, 2);
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of a string', () => {
      const buf = Buffer.allocUnsafe(1);
      buf[0] = 0xd9;
      const sbuf = new SmartBuffer().write(buf);
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('2-bytes-length-arrays', () => {
    const build = function (size: number) {
      const array: any[] = [];
      let i: number;

      for (i = 0; i < size; i++) {
        array.push(42);
      }

      return array;
    };

    it('encode/decode arrays up to 0xffff elements', () => {
      const all: any[] = [];
      let i: number;

      for (i = 16; i < 0xffff; i += 4242) {
        all.push(build(i));
      }

      all.push(build(0xff));
      all.push(build(0xffff));

      all.forEach((array) => {
        expect(serializer.decode(serializer.encode(array))).toEqual(array);
      });
    });

    it('decoding an incomplete array', () => {
      const array = build(0xffff / 2);
      const buf = Buffer.alloc(3 + array.length);
      buf[0] = 0xdc;
      buf.writeUInt16BE(array.length + 10, 1); // set bigger size
      let pos = 3;
      for (let i = 0; i < array.length; i++) {
        const obj = serializer.encode(array[i]);
        obj.write(buf, pos);
        pos += obj.length;
      }
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header', () => {
      const buf = Buffer.alloc(2);
      buf[0] = 0xdc;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('2-bytes-length-exts', () => {
    it('encode/decode variable ext data up between 0x0100 and 0xffff', () => {
      const all: MyType[] = [];

      class MyType {
        value: string;
        size: number;

        constructor(size: number, value: string) {
          this.value = value;
          this.size = size;
        }
      }

      const mytypeEncode = (obj: MyType, resbuf: { write: (buf: Buffer) => void }) => {
        const buf = Buffer.allocUnsafe(obj.size);
        buf.fill(obj.value);
        resbuf.write(buf);
      };

      const mytypeDecode = (buf: SmartBuffer): MyType => {
        const result = new MyType(buf.length, buf.toString('utf8', 0, 1));

        for (let i = 0; i < buf.length; i++) {
          if (buf.readUInt8(0) !== buf.readUInt8(i)) {
            throw new Error('should all be the same');
          }
        }

        return result;
      };

      serializer.register(0x42, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(0x0100, 'a'));
      all.push(new MyType(0x0101, 'a'));
      all.push(new MyType(0xffff, 'a'));

      all.forEach((orig) => {
        expect(serializer.decode(serializer.encode(orig))).toEqual(orig);
      });
    });
  });

  describe('2-bytes-length-strings', () => {
    it('encode/decode 2^8 <-> (2^16-1) bytes strings', () => {
      const all: any[] = [];
      let str: Buffer<ArrayBuffer> | string[];

      str = Buffer.allocUnsafe(Math.pow(2, 8));
      str.fill('a');
      all.push(str.toString());

      str = Buffer.allocUnsafe(Math.pow(2, 8) + 1);
      str.fill('a');
      all.push(str.toString());

      str = Buffer.allocUnsafe(Math.pow(2, 14));
      str.fill('a');
      all.push(str.toString());

      str = Buffer.allocUnsafe(Math.pow(2, 16) - 1);
      str.fill('a');
      all.push(str.toString());

      all.forEach((str) => {
        expect(serializer.decode(serializer.encode(str))).toEqual(str);
      });
    });

    it('decoding a chopped string', () => {
      let str: string | any[] | ArrayBuffer | DataView<ArrayBufferLike>;
      for (str = 'a'; str.length < 0xff + 100; str += 'a') {
        /* empty */
      }
      const buf = Buffer.allocUnsafe(3 + Buffer.byteLength(str));
      buf[0] = 0xda;
      buf.writeUInt16BE(Buffer.byteLength(str) + 10, 1); // set bigger size
      buf.write(str, 3);
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of a string', () => {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xda;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('2-bytes-length-buffers', () => {
    const build = function (size: number) {
      const buf = Buffer.allocUnsafe(size);
      buf.fill('a');

      return buf;
    };

    it('encode/decode 2^16-1 bytes buffers', () => {
      const all: any[] = [];

      all.push(build(Math.pow(2, 8)));
      all.push(build(Math.pow(2, 8) + 1));
      all.push(build(Math.pow(2, 12) + 1));
      all.push(build(Math.pow(2, 16) - 1));

      all.forEach((orig) => {
        expect(serializer.decode(serializer.encode(orig)).toString()).toEqual(orig.toString());
      });
    });

    it('decoding a chopped 2^16-1 bytes buffer', () => {
      const orig = build(Math.pow(2, 12));
      const buf = Buffer.allocUnsafe(3 + orig.length);
      buf[0] = 0xc5;
      buf[1] = Math.pow(2, 16) - 1; // set bigger size
      orig.copy(buf, 3);
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of 2^16-1 bytes buffer', () => {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xc5;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('2-bytes-length-maps', () => {
    const base = 100000;

    const build = (size: number, value: number): Record<number, number> => {
      const map: Record<number, number> = {};

      for (let i = 0; i < size; i++) {
        map[i + base] = value;
      }

      return map;
    };

    it('encode/decode maps up to 2^16-1 elements', () => {
      const doTest = function (length: number) {
        const map = build(length, 42);
        const buf = serializer.encode(map);

        expect(serializer.decode(buf)).toEqual(map);
      };

      doTest(Math.pow(2, 8));
      doTest(Math.pow(2, 8) + 1);
      doTest(Math.pow(2, 12) + 1);
      // too slow
      doTest(Math.pow(2, 16) - 1);
    });

    it('decoding a chopped map', () => {
      const map = serializer.encode(build(Math.pow(2, 12) + 1, 42));
      const buf = new SmartBuffer();
      buf.writeUInt8(0xde);
      buf.writeUInt16BE(Math.pow(2, 16) - 1); // set bigger size
      buf.write(map.slice(3));
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of a map', () => {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xde;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('4-bytes-length-arrays', () => {
    const build = function (size: number) {
      const array: any[] = [];

      for (let i = 0; i < size; i++) {
        array.push(42);
      }

      return array;
    };

    it('encode/decode arrays up to 0xffffffff elements', () => {
      const doTest = function (array: any[]) {
        expect(serializer.decode(serializer.encode(array))).toEqual(array);
      };

      doTest(build(0xffff + 1));
      doTest(build(0xffff + 42));
      // unable to test bigger arrays do to out of memory errors
    });

    it('decoding an incomplete array', () => {
      const array = build(0xffff + 42);
      const buf = new SmartBuffer(5 + array.length);
      buf.writeUInt8(0xdd);
      buf.writeUInt32BE(array.length + 10); // set bigger size
      for (let i = 0; i < array.length; i++) {
        const obj = serializer.encode(array[i]);
        buf.write(obj);
      }
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header', () => {
      const buf = Buffer.allocUnsafe(4);
      buf[0] = 0xdd;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('4-bytes-length-buffers', () => {
    const build = function (size: number) {
      const buf = Buffer.allocUnsafe(size);
      buf.fill('a');

      return buf;
    };

    it('encode/decode 2^32-1 bytes buffers', () => {
      const all: any = [];

      all.push(build(Math.pow(2, 16)));
      all.push(build(Math.pow(2, 16) + 1));
      all.push(build(Math.pow(2, 18) + 1));

      all.forEach((orig: { toString: () => any }) => {
        const encoded = serializer.encode(orig);
        expect(serializer.decode(encoded).toString()).toEqual(orig.toString());
      });
    });

    it('decoding a chopped 2^32-1 bytes buffer', () => {
      const orig = build(Math.pow(2, 18));
      const buf = Buffer.allocUnsafe(5 + orig.length);
      buf[0] = 0xc6;
      buf[1] = Math.pow(2, 32) - 1; // set bigger size
      orig.copy(buf, 5);
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of 2^32-1 bytes buffer', () => {
      const buf = Buffer.allocUnsafe(4);
      buf[0] = 0xc6;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('4-bytes-length-exts', () => {
    const customSerializer = new Serializer();

    it('encode/decode variable ext data up between 0x10000 and 0xffffffff', () => {
      const all: MyType[] = [];

      class MyType {
        value: string;
        size: number;

        constructor(size: number, value: string) {
          this.value = value;
          this.size = size;
        }
      }

      const mytypeEncode = (obj: MyType, resbuf: { write: (buf: Buffer) => void }) => {
        const buf = Buffer.allocUnsafe(obj.size);
        buf.fill(obj.value);
        resbuf.write(buf);
      };

      const mytypeDecode = (buf: SmartBuffer): MyType => {
        const result = new MyType(buf.length, buf.toString('utf8', 0, 1));

        for (let i = 0; i < buf.length; i++) {
          if (buf.readUInt8(0) !== buf.readUInt8(i)) {
            throw new Error('should all be the same');
          }
        }

        return result;
      };

      customSerializer.register(0x52, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(0x10000, 'a'));
      all.push(new MyType(0x10001, 'a'));
      all.push(new MyType(0xffffff, 'a'));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });
  });

  describe('4-bytes-length-strings', () => {
    it('encode/decode 2^16 <-> (2^32 - 1) bytes strings', () => {
      const all: any[] = [];
      let str: Buffer<ArrayBuffer> | string[];

      str = Buffer.allocUnsafe(Math.pow(2, 16));
      str.fill('a');
      all.push(str.toString());

      str = Buffer.allocUnsafe(Math.pow(2, 16) + 1);
      str.fill('a');
      all.push(str.toString());

      str = Buffer.allocUnsafe(Math.pow(2, 20));
      str.fill('a');
      all.push(str.toString());

      all.forEach((str) => {
        expect(serializer.decode(serializer.encode(str))).toEqual(str);
      });
    });

    it('decoding a chopped string', () => {
      let str: string | any[] | ArrayBuffer | DataView<ArrayBufferLike>;
      for (str = 'a'; str.length < 0xffff + 100; str += 'a') {
        //
      }
      const buf = Buffer.allocUnsafe(5 + Buffer.byteLength(str));
      buf[0] = 0xdb;
      buf.writeUInt32BE(Buffer.byteLength(str) + 10, 1); // set bigger size
      buf.write(str, 5);
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });

    it('decoding an incomplete header of a string', () => {
      const buf = Buffer.allocUnsafe(4);
      buf[0] = 0xdb;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  it('encoding/decoding 5-bits negative ints', () => {
    const allNum: any[] = [];

    for (let i = 1; i <= 32; i++) {
      allNum.push(-i);
    }

    allNum.forEach((num) => {
      expect(serializer.decode(serializer.encode(num))).toEqual(num);
    });
  });

  it('encoding/decoding 7-bits positive ints', () => {
    const allNum: any[] = [];

    for (let i = 0; i < 126; i++) {
      allNum.push(i);
    }

    allNum.forEach((num) => {
      expect(serializer.decode(serializer.encode(num))).toEqual(num);
    });
  });

  describe('8-bits-positive-integers', () => {
    it('encoding/decoding 8-bits integers', () => {
      const allNum: any[] = [];

      for (let i = 128; i < 256; i++) {
        allNum.push(i);
      }

      allNum.forEach((num) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 8-bits unsigned integer', () => {
      const buf = Buffer.allocUnsafe(1);
      buf[0] = 0xcc;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('8-bits-signed-integers', () => {
    it('encoding/decoding 8-bits big-endian signed integers', () => {
      const allNum: any = [];

      for (let i = 33; i <= 128; i++) {
        allNum.push(-i);
      }

      allNum.forEach((num: any) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 8-bits big-endian signed integer', () => {
      const buf = Buffer.allocUnsafe(1);
      buf[0] = 0xd0;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('15-elements-arrays', () => {
    const build = function (size: number, obj: string | number) {
      const array: any[] = [];
      let i: number;

      for (i = 0; i < size; i++) {
        array.push(obj);
      }

      return array;
    };

    it('encode/decode arrays up to 15 elements', () => {
      const all: any[] = [];
      let i: number;

      for (i = 0; i < 16; i++) {
        all.push(build(i, 42));
      }

      for (i = 0; i < 16; i++) {
        all.push(build(i, 'aaa'));
      }

      all.forEach((array) => {
        expect(serializer.decode(serializer.encode(array))).toEqual(array);
      });
    });

    it('decoding an incomplete array', () => {
      const array = ['a', 'b', 'c'];
      const buf = new SmartBuffer();
      buf.writeUInt8(0x90 | (array.length + 2)); // set bigger size
      for (let i = 0; i < array.length; i++) {
        const obj = serializer.encode(array[i]);
        buf.write(obj);
      }
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('15-elements-maps', () => {
    const build = (size: number, value: string | number): Record<string, string | number> => {
      const map: Record<string, string | number> = {};

      for (let i = 0; i < size; i++) {
        map[`${i + 100}`] = value;
      }

      return map;
    };

    it('encode/decode maps up to 15 elements', () => {
      const all: any[] = [];
      let i: number;

      for (i = 0; i < 16; i++) {
        all.push(build(i, 42));
      }

      for (i = 0; i < 16; i++) {
        all.push(build(i, 'aaa'));
      }

      all.forEach((map) => {
        const length = Object.keys(map).length;
        expect(serializer.decode(serializer.encode(map))).toEqual(map);
      });
    });

    it("should encode 'undefined' in a map", () => {
      const expected = { a: undefined, hello: 'world' };
      const toEncode = { a: undefined, hello: 'world' };
      const buf = serializer.encode(toEncode);

      expect(expected).toEqual(serializer.decode(buf));
    });

    it('encode/decode map with buf, ints and strings', () => {
      const map = {
        topic: 'hello',
        qos: 1,
        payload: Buffer.from('world'),
        messageId: '42',
        ttl: 1416309270167,
      };

      const decodedMap = serializer.decode(serializer.encode(map));

      expect(map.topic).toEqual(decodedMap.topic);
      expect(map.qos).toEqual(decodedMap.qos);
      expect(map.messageId).toEqual(decodedMap.messageId);
      expect(map.ttl).toEqual(decodedMap.ttl);
      expect(Buffer.compare(map.payload, decodedMap.payload)).toEqual(0);
    });

    it('decoding a chopped map', () => {
      const map = serializer.encode({ a: 'b', c: 'd', e: 'f' }).toBuffer();
      const buf = new SmartBuffer(map.length);
      buf.writeUInt8(0x80 | 5); // set bigger size
      buf.write(map.slice(1));
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('16-bits-signed-integers', () => {
    it('encoding/decoding 16-bits big-endian signed integers', () => {
      const allNum: any[] = [];
      let i: number;

      for (i = 129; i < 32768; i += 1423) {
        allNum.push(-i);
      }

      allNum.push(-32768);

      allNum.forEach((num) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 16-bits big-endian integer', () => {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xd1;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('16-bits-unsigned-integers', () => {
    it('encoding/decoding 16-bits big-endian unsigned integers', () => {
      const allNum: any[] = [];
      let i: number;

      for (i = 256; i < 65536; i += 1423) {
        allNum.push(i);
      }

      allNum.push(65535);

      allNum.forEach((num) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 16-bits big-endian unsigned integer', () => {
      const buf = Buffer.allocUnsafe(2);
      buf[0] = 0xcd;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('32-bits-signed-integers', () => {
    it('encoding/decoding 32-bits big-endian signed integers', () => {
      const allNum: any[] = [];

      for (let i = 32769; i < 214748364; i += 10235023) {
        allNum.push(-i);
      }

      allNum.push(-214748364);

      allNum.forEach((num) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 32-bits big-endian integer', () => {
      const buf = Buffer.allocUnsafe(4);
      buf[0] = 0xd2;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('32-bits-unsigned-integers', () => {
    it('encoding/decoding 32-bits big-endian unsigned integers', () => {
      const allNum: any[] = [];

      for (let i = 65536; i < 0xffffffff; i += 102350237) {
        allNum.push(i);
      }

      allNum.push(0xfffffffe);
      allNum.push(0xffffffff);

      allNum.forEach((num) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 32-bits big-endian unsigned integer', () => {
      const buf = Buffer.allocUnsafe(4);
      buf[0] = 0xce;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  it('encode/decode up to 31 bytes strings', () => {
    const all: any[] = [];

    for (let i = ''; i.length < 32; i += 'a') {
      all.push(i);
    }

    all.forEach((str) => {
      expect(serializer.decode(serializer.encode(str))).toEqual(str);
    });
  });

  describe('64-bits-signed-integers', () => {
    it('encoding/decoding 64-bits big-endian signed integers', () => {
      const table = [
        { num: -9007199254740991, hi: 0xffe00000, lo: 0x00000001 },
        { num: -4294967297, hi: 0xfffffffe, lo: 0xffffffff },
        { num: -4294967296, hi: 0xffffffff, lo: 0x00000000 },
        { num: -4294967295, hi: 0xffffffff, lo: 0x00000001 },
        { num: -214748365, hi: 0xffffffff, lo: 0xf3333333 },
      ];

      table.forEach((testCase) => {
        expect(serializer.decode(serializer.encode(testCase.num))).toEqual(testCase.num);
      });
    });

    it('decoding an incomplete 64-bits big-endian signed integer', () => {
      const buf = Buffer.allocUnsafe(8);
      buf[0] = 0xd3;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('64-bits-unsigned-integers', () => {
    it('encoding/decoding 64-bits big-endian unsigned integers', () => {
      const allNum: any[] = [];

      allNum.push(0x0000000100000000);
      allNum.push(0xffffffffeeeee);

      allNum.forEach((num) => {
        expect(serializer.decode(serializer.encode(num))).toEqual(num);
      });
    });

    it('decoding an incomplete 64-bits big-endian unsigned integer', () => {
      const buf = Buffer.allocUnsafe(8);
      buf[0] = 0xcf;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('doubles', () => {
    it('encoding/decoding 64-bits float numbers', () => {
      const allNum: any[] = [];

      allNum.push(748365544534.2);
      allNum.push(-222111111000004.2);
      allNum.push(9007199254740992);
      allNum.push(-9007199254740992);

      allNum.forEach((num) => {
        const dec = serializer.decode(serializer.encode(num));
        expect(Math.abs(dec - num) < 0.1).toBeTruthy();
      });
    });

    it('decoding an incomplete 64-bits float numbers', () => {
      const buf = Buffer.allocUnsafe(8);
      buf[0] = 0xcb;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('fixexts', () => {
    it('encode/decode 1 byte fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt8: (value: number) => void }) => {
        buf.writeUInt8(obj.data);
      };

      const mytypeDecode = (data: SmartBuffer): MyType => new MyType(data.readUInt8()!);

      customSerializer.register(0x42, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(0));
      all.push(new MyType(1));
      all.push(new MyType(42));

      all.forEach((orig) => {
        const encoded = customSerializer.encode(orig);
        const decoded = customSerializer.decode(encoded);
        expect(decoded).toEqual(orig);
      });
    });

    it('encode/decode 2 bytes fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt16BE: (value: number) => void }) => {
        buf.writeUInt16BE(obj.data);
      };

      const mytypeDecode = (data: SmartBuffer): MyType => new MyType(data.readUInt16BE()!!);

      customSerializer.register(0x42, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(0));
      all.push(new MyType(1));
      all.push(new MyType(42));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });

    it('encode/decode 4 bytes fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt32BE: (value: number) => void }) => {
        buf.writeUInt32BE(obj.data);
      };

      const mytypeDecode = (data: SmartBuffer): MyType => new MyType(data.readUInt32BE()!!);

      customSerializer.register(0x44, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(0));
      all.push(new MyType(1));
      all.push(new MyType(42));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });

    it('encode/decode 8 bytes fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt32BE: (value: number) => void }) => {
        buf.writeUInt32BE(obj.data / 2);
        buf.writeUInt32BE(obj.data / 2);
      };

      const mytypeDecode = (data: SmartBuffer): MyType => new MyType(data.readUInt32BE()! + data.readUInt32BE()!);

      customSerializer.register(0x44, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(2));
      all.push(new MyType(4));
      all.push(new MyType(42));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });

    it('encode/decode 16 bytes fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt32BE: (value: number) => void }) => {
        buf.writeUInt32BE(obj.data / 4);
        buf.writeUInt32BE(obj.data / 4);
        buf.writeUInt32BE(obj.data / 4);
        buf.writeUInt32BE(obj.data / 4);
      };

      const mytypeDecode = (data: SmartBuffer): MyType =>
        new MyType(data.readUInt32BE()! + data.readUInt32BE()! + data.readUInt32BE()! + data.readUInt32BE()!);

      customSerializer.register(0x46, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(4));
      all.push(new MyType(8));
      all.push(new MyType(44));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });

    it('encode/decode fixext inside a map', () => {
      const customSerializer = new Serializer();
      const all: Record<string, MyType | number>[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt32BE: (value: number) => void }) => {
        buf.writeUInt32BE(obj.data);
      };

      const mytypeDecode = (data: SmartBuffer): MyType => new MyType(data.readUInt32BE()!!);

      customSerializer.register(0x42, MyType, mytypeEncode, mytypeDecode);

      all.push({ ret: new MyType(42) });
      all.push({ a: new MyType(42), b: new MyType(43) });

      all.push(
        [1, 2, 3, 4, 5, 6].reduce(
          (acc, key) => {
            acc[key] = new MyType(key);
            return acc;
          },
          {} as Record<number, MyType>
        )
      );

      all.forEach((orig) => {
        const encoded = customSerializer.encode(orig);
        expect(customSerializer.decode(encoded)).toEqual(orig);
      });
    });

    it('encode/decode 8 bytes fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt32BE: (value: number) => void }) => {
        buf.writeUInt32BE(obj.data / 2);
        buf.writeUInt32BE(obj.data / 2);
      };

      const mytypeDecode = (data: SmartBuffer): MyType => new MyType(data.readUInt32BE()! + data.readUInt32BE()!);

      customSerializer.register(0x44, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(2));
      all.push(new MyType(4));
      all.push(new MyType(42));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });

    it('encode/decode 16 bytes fixext data', () => {
      const customSerializer = new Serializer();
      const all: MyType[] = [];

      class MyType {
        data: number;

        constructor(data: number) {
          this.data = data;
        }
      }

      const mytypeEncode = (obj: MyType, buf: { writeUInt32BE: (value: number) => void }) => {
        buf.writeUInt32BE(obj.data / 4);
        buf.writeUInt32BE(obj.data / 4);
        buf.writeUInt32BE(obj.data / 4);
        buf.writeUInt32BE(obj.data / 4);
      };

      const mytypeDecode = (data: SmartBuffer): MyType =>
        new MyType(data.readUInt32BE()! + data.readUInt32BE()! + data.readUInt32BE()! + data.readUInt32BE()!);

      customSerializer.register(0x46, MyType, mytypeEncode, mytypeDecode);

      all.push(new MyType(4));
      all.push(new MyType(8));
      all.push(new MyType(44));

      all.forEach((orig) => {
        expect(customSerializer.decode(customSerializer.encode(orig))).toEqual(orig);
      });
    });
  });

  describe('floats', () => {
    it('encoding/decoding 32-bits float numbers', () => {
      const allNum: any[] = [];

      allNum.push(-222.42);
      allNum.push(748364.2);
      allNum.push(2.2);

      allNum.forEach((num) => {
        const dec = serializer.decode(serializer.encode(num));
        expect(Math.abs(dec - num) < 0.1).toBeTruthy();
      });
    });

    it('decoding an incomplete 32-bits float numbers', () => {
      const buf = Buffer.allocUnsafe(4);
      buf[0] = 0xca;
      const sbuf = SmartBuffer.fromBuffer(buf);
      expect(() => serializer.decode(sbuf)).toThrow(/Incomplete buffer/);
    });
  });

  it('should not encode a function inside a map', () => {
    const noop = () => {};

    const toEncode = {
      hello: 'world',
      func: noop,
    };

    expect(() => serializer.decode(serializer.encode(toEncode))).toThrow(/Not supported/);
  });

  it('encode/decode undefined', () => {
    expect(serializer.decode(serializer.encode(undefined))).toEqual(undefined);
  });

  it('encode/decode null', () => {
    expect(serializer.decode(serializer.encode(null))).toEqual(null);
  });

  it('custom type registeration assertions', () => {
    class Type0 {
      value: string;

      constructor(value: string) {
        this.value = value;
      }
    }

    const type0Encode = (obj: Type0, buf: SmartBuffer) => {
      const strBuf = Buffer.from(obj.value, 'utf8');
      buf.write(strBuf);
    };

    const type0Decode = (buf: SmartBuffer) => {
      const str = buf.toBuffer().toString('utf8');
      return new Type0(str);
    };

    class TypeNeg {
      value: string;

      constructor(value: string) {
        this.value = value;
      }
    }

    const typeNegEncode = (obj: TypeNeg, buf: SmartBuffer) => {
      const strBuf = Buffer.from(obj.value, 'utf8');
      buf.write(strBuf);
    };

    const typeNegDecode = (buf: SmartBuffer) => {
      const str = buf.toBuffer().toString('utf8');
      return new TypeNeg(str);
    };

    expect(() => serializer.register(0, Type0, type0Encode, type0Decode)).not.toThrow();
    expect(() => serializer.register(-1, TypeNeg, typeNegEncode, typeNegDecode)).toThrow();

    const encoded = serializer.encode(new Type0('hi'));
    let decoded: unknown;
    expect(encoded.readUInt8(1)).toEqual(0x0);
    expect(() => (decoded = serializer.decode(encoded))).not.toThrow();
    expect(decoded).toBeInstanceOf(Type0);
  });

  describe('object-with-arrays', () => {
    const build = (size: number): number[] => {
      const array: number[] = [];

      for (let i = 0; i < size; i++) {
        array.push(42);
      }

      return array;
    };

    it('decoding a map with multiple big arrays', () => {
      const map = {
        first: build(0xffff + 42),
        second: build(0xffff + 42),
      };

      expect(serializer.decode(serializer.encode(map))).toEqual(map);
    });

    it('decoding a map with multiple big arrays. First one is incomplete', () => {
      const array = build(0xffff + 42);
      const map = {
        first: array,
        second: build(0xffff + 42),
      };

      const buf = serializer.encode(map);

      // 1 (fixmap's header 0x82) + first key's length + 1 (first array's 0xdd)
      const sizePosOfFirstArray = 1 + serializer.encode('first').length + 1;
      buf.writeUInt32BE(array.length + 10, sizePosOfFirstArray); // set first array's size bigger than its actual size
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });

    it('decoding a map with multiple big arrays. Second one is incomplete', () => {
      const array = build(0xffff + 42);
      const map = {
        first: array,
        second: build(0xffff + 42),
      };

      const buf = serializer.encode(map);
      // 1 (fixmap's header 0x82) + first key-value pair's length + second key's length + 1 (second array's 0xdd)
      const sizePosOfSecondArray =
        1 +
        serializer.encode('first').length +
        serializer.encode(array).length +
        serializer.encode('second').length +
        1;
      buf.writeUInt32BE(array.length + 10, sizePosOfSecondArray); // set second array's size bigger than its actual size
      expect(() => serializer.decode(buf)).toThrow(/Incomplete buffer/);
    });
  });

  describe('object-with-buffers', () => {
    it('encode/decode map with multiple short buffers', () => {
      const map = {
        first: Buffer.from('first'),
        second: Buffer.from('second'),
        third: Buffer.from('third'),
      };

      const decodedMap = serializer.decode(serializer.encode(map));
      expect(Buffer.compare(decodedMap.first, map.first)).toEqual(0);
      expect(Buffer.compare(decodedMap.second, map.second)).toEqual(0);
      expect(Buffer.compare(decodedMap.third, map.third)).toEqual(0);
    });

    it('encode/decode map with all files in this directory', () => {
      const files = readdirSync(__dirname);
      const map: Record<string, Buffer> = files.reduce(
        (acc, file) => {
          const nowFile = join(__dirname, file);
          if (!statSync(nowFile).isDirectory()) {
            acc[file] = readFileSync(nowFile);
          }
          return acc;
        },
        {} as Record<string, Buffer>
      );

      for (const [name, buff] of Object.entries(map)) {
        map[name] = Buffer.from(buff);
      }

      const decodedMap = serializer.decode(serializer.encode(map));

      for (const [name, buff] of Object.entries(map)) {
        expect(Buffer.compare(buff, decodedMap[name])).toEqual(0);
      }
    });
  });

  describe('object-with-strings', () => {
    it('encode/decode map with multiple short buffers', () => {
      const map = {
        first: 'first',
        second: 'second',
        third: 'third',
      };

      expect(serializer.decode(serializer.encode(map))).toEqual(map);
    });

    it('encode/decode map with all files in this directory', () => {
      const files = readdirSync(__dirname);
      const map = files.reduce(
        (acc, file) => {
          const nowFile = join(__dirname, file);
          if (!statSync(nowFile).isDirectory()) {
            acc[file] = readFileSync(join(__dirname, file)).toString('utf8');
          }
          return acc;
        },
        {} as Record<string, string>
      );

      expect(serializer.decode(serializer.encode(map))).toEqual(map);
    });
  });

  describe('some std and custom types encode/decode', () => {
    it('encode/decode Long mirror test', () => {
      let orig = Long.fromString('1152921504606912512', true); // 2**60 + 2**16
      let encoded = serializer.encode(orig);
      let output = serializer.decode(encoded);
      expect(output.equals(orig)).toBeTruthy();

      orig = Long.fromString('-1152921504606912512'); // -2**60 - 2**16
      encoded = serializer.encode(orig);
      output = serializer.decode(encoded);
      expect(output.equals(orig)).toBeTruthy();
    });

    it('encode/decode Date', () => {
      const val = new Date();
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode Map', () => {
      const val = new Map();
      val.set('key1', 'val2');
      val.set(888, 'ateos');
      val.set('state', true);
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect([...decodedVal.entries()]).toEqual([...val.entries()]);
    });

    it('encode/decode Set', () => {
      const val = new Set();
      val.add('very');
      val.add('good');
      val.add('stuff');
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect([...decodedVal.entries()]).toEqual([...val.entries()]);
    });

    it('encode/decode unsigned 64-bit BigInt', () => {
      const val = BigInt('18446744073709551614'); // 2**64 - 2
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode positive 64-bit BigInt', () => {
      const val = BigInt('9223372036854775807'); // 2**63 - 1
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode negative 64-bit BigInt', () => {
      const val = BigInt('-9223372036854775808'); // -2**63
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode overflow BigInt', () => {
      const val = BigInt('1234567890123456789012345678901234567890');
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode negative overflow BigInt', () => {
      const val = BigInt('-1234567890123456789012345678901234567890');
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode simple RegExp', () => {
      const val = /test/;
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode RegExp with flags', () => {
      const val = /test/gi;
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode RegExp with special characters', () => {
      const val = /[a-zA-Z0-9]+/;
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode RegExp with escape sequences', () => {
      const val = /\d{2,4}-\d{2,4}/;
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });

    it('encode/decode complex RegExp', () => {
      const val = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
      const encoded = serializer.encode(val);
      const decodedVal = serializer.decode(encoded);
      expect(decodedVal).toEqual(val);
    });
  });

  describe('custom error fields', () => {
    class PrismaClientKnownRequestError extends Error {
      code: string;
      meta?: Record<string, unknown>;
      clientVersion: string;
      batchRequestIdx?: number;
      constructor(
        message: string,
        {
          name,
          code,
          clientVersion,
          meta,
          batchRequestIdx,
        }: {
          name?: string;
          code: string;
          clientVersion: string;
          meta?: Record<string, unknown>;
          batchRequestIdx?: number;
        }
      ) {
        super(message);
        if (name) {
          this.name = name;
        }
        this.code = code;
        this.clientVersion = clientVersion;
        this.meta = meta;
        this.batchRequestIdx = batchRequestIdx;
      }
      get [Symbol.toStringTag](): string {
        return 'PrismaClientKnownRequestError';
      }
    }

    it('encode/decode custom error with code field', () => {
      const error = new PrismaClientKnownRequestError('Custom error message', {
        name: 'PrismaClientKnownRequestError',
        code: 'P1001',
        clientVersion: '2.0.0',
        meta: { key: 'value' },
        batchRequestIdx: 1,
      });
      const encoded = serializer.encode(error);
      const decodedError = serializer.decode(encoded);
      expect(decodedError).toBeInstanceOf(Error);
      expect(decodedError.name).toEqual('PrismaClientKnownRequestError');
      expect(decodedError.message).toEqual(error.message);
      expect(decodedError.code).toEqual(error.code);
      expect(decodedError.clientVersion).toEqual(error.clientVersion);
      expect(decodedError.meta).toEqual(error.meta);
      expect(decodedError.batchRequestIdx).toEqual(error.batchRequestIdx);
    });

    it('encode/decode custom error with meta field', () => {
      const error = new PrismaClientKnownRequestError('Another custom error message', {
        code: 'P1002',
        clientVersion: '2.1.0',
        meta: { info: 'additional info' },
        batchRequestIdx: 2,
      });
      const encoded = serializer.encode(error);
      const decodedError = serializer.decode(encoded);
      expect(decodedError).toBeInstanceOf(Error);
      expect(decodedError.message).toEqual(error.message);
      expect(decodedError.code).toEqual(error.code);
      expect(decodedError.clientVersion).toEqual(error.clientVersion);
      expect(decodedError.meta).toEqual(error.meta);
      expect(decodedError.batchRequestIdx).toEqual(error.batchRequestIdx);
    });

    it('encode/decode custom error without meta field', () => {
      const error = new PrismaClientKnownRequestError('Error without meta', {
        code: 'P1003',
        clientVersion: '2.2.0',
        batchRequestIdx: 3,
      });
      const encoded = serializer.encode(error);
      const decodedError = serializer.decode(encoded);
      expect(decodedError).toBeInstanceOf(Error);
      expect(decodedError.message).toEqual(error.message);
      expect(decodedError.code).toEqual(error.code);
      expect(decodedError.clientVersion).toEqual(error.clientVersion);
      expect(decodedError.meta).toBeUndefined();
      expect(decodedError.batchRequestIdx).toEqual(error.batchRequestIdx);
    });

    it('encode/decode custom error with multiple custom fields', () => {
      const error = new PrismaClientKnownRequestError('Error with multiple fields', {
        code: 'P1004',
        clientVersion: '2.3.0',
        meta: { detail: 'detailed info' },
        batchRequestIdx: 4,
      });
      (error as any).customField1 = 'custom value 1';
      (error as any).customField2 = 'custom value 2';
      const encoded = serializer.encode(error);
      const decodedError = serializer.decode(encoded);
      expect(decodedError).toBeInstanceOf(Error);
      expect(decodedError.message).toEqual(error.message);
      expect(decodedError.code).toEqual(error.code);
      expect(decodedError.clientVersion).toEqual(error.clientVersion);
      expect(decodedError.meta).toEqual(error.meta);
      expect(decodedError.batchRequestIdx).toEqual(error.batchRequestIdx);
      expect((decodedError as any).customField1).toEqual('custom value 1');
      expect((decodedError as any).customField2).toEqual('custom value 2');
    });
  });
});
