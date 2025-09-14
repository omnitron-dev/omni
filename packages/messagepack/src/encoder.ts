import { Buffer } from 'buffer';
import { SmartBuffer } from '@omnitron-dev/smartbuffer';
import { isBuffer, isPlainObject } from '@omnitron-dev/common';

import { EncoderInfo, EncodeFunction } from './types';

/**
 * Get a human-readable type name for a value.
 * Replaces type-detect library with a lightweight implementation.
 */
const getType = (value: any): string => {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  const type = typeof value;
  if (type !== 'object') return type;

  // Use Object.prototype.toString for more specific object types
  const stringTag = Object.prototype.toString.call(value);
  const match = stringTag.match(/\[object (\w+)\]/);
  return match ? match[1].toLowerCase() : 'object';
};

const encodeString = (x: any, buf: SmartBuffer) => {
  const len = Buffer.byteLength(x);
  if (len < 32) {
    buf.writeInt8(0xa0 | len);
    if (len === 0) {
      return;
    }
  } else if (len <= 0xff) {
    buf.writeUInt16BE(0xd900 | len);
  } else if (len <= 0xffff) {
    buf.writeInt8(0xda);
    buf.writeUInt16BE(len);
  } else {
    buf.writeInt8(0xdb);
    buf.writeUInt32BE(len);
  }
  buf.write(x, undefined, len);
};

const encodeCustom = (x: any, type: number, encFunc: EncodeFunction, buf: SmartBuffer) => {
  const encoded = encFunc(x, buf);

  const length = encoded.length;
  if (length === 1) {
    buf.writeUInt8(0xd4);
  } else if (length === 2) {
    buf.writeUInt8(0xd5);
  } else if (length === 4) {
    buf.writeUInt8(0xd6);
  } else if (length === 8) {
    buf.writeUInt8(0xd7);
  } else if (length === 16) {
    buf.writeUInt8(0xd8);
  } else if (length < 256) {
    buf.writeUInt16BE(0xc700 | length);
  } else if (length < 0x10000) {
    buf.writeUInt32BE(0xc8000000 | (length << 8));
    buf.woffset -= 1;
  } else {
    buf.writeUInt8(0xc9);
    buf.writeUInt32BE(length);
  }
  buf.writeInt8(type);
  buf.write(encoded);
};

export default class Encoder {
  constructor(private encodingTypes: Map<number, EncoderInfo>) {}

  encode(x: any, buf?: SmartBuffer) {
    buf = buf || new SmartBuffer(1024, true);
    this._encode(x, buf);
    return buf;
  }

  private _encode(x: any, buf: SmartBuffer): void {
    const type = typeof x;
    switch (type) {
      case 'undefined': {
        buf.writeUInt32BE(0xd4000000); // fixext special type/value
        buf.woffset--;
        break;
      }
      case 'boolean': {
        if (x === true) {
          buf.writeInt8(0xc3);
        } else {
          buf.writeInt8(0xc2);
        }
        break;
      }
      case 'string': {
        encodeString(x, buf);
        break;
      }
      case 'bigint': {
        encodeCustom(x, 120, this.encodingTypes.get(120)!.encode, buf);
        break;
      }
      case 'number': {
        if (x !== (x | 0)) {
          // as double
          buf.writeInt8(0xcb);
          buf.writeDoubleBE(x);
        } else if (x >= 0) {
          if (x < 128) {
            buf.writeInt8(x);
          } else if (x < 256) {
            buf.writeInt16BE(0xcc00 | x);
          } else if (x < 65536) {
            buf.writeInt8(0xcd);
            buf.writeUInt16BE(x);
          } else if (x <= 0xffffffff) {
            buf.writeInt8(0xce);
            buf.writeUInt32BE(x);
          } else if (x <= 9007199254740991) {
            buf.writeInt8(0xcf);
            buf.writeUInt64BE(x);
          } else {
            // as double
            buf.writeInt8(0xcb);
            buf.writeDoubleBE(x);
          }
        } else {
          if (x >= -32) {
            buf.writeInt8(0x100 + x);
          } else if (x >= -128) {
            buf.writeInt8(0xd0);
            buf.writeInt8(x);
          } else if (x >= -32768) {
            buf.writeInt8(0xd1);
            buf.writeInt16BE(x);
          } else if (x > -214748365) {
            buf.writeInt8(0xd2);
            buf.writeInt32BE(x);
          } else if (x >= -9007199254740991) {
            buf.writeInt8(0xd3);
            buf.writeInt64BE(x);
          } else {
            // as double
            buf.writeInt8(0xcb);
            buf.writeDoubleBE(x);
          }
        }
        break;
      }
      default: {
        if (x === null) {
          buf.writeInt8(0xc0);
        } else if (isBuffer(x)) {
          if (x.length <= 0xff) {
            buf.writeInt16BE(0xc400 | x.length);
          } else if (x.length <= 0xffff) {
            buf.writeInt8(0xc5);
            buf.writeUInt16BE(x.length);
          } else {
            buf.writeUInt8(0xc6);
            buf.writeUInt32BE(x.length);
          }
          buf.write(x);
        } else if (Array.isArray(x)) {
          if (x.length < 16) {
            buf.writeInt8(0x90 | x.length);
          } else if (x.length < 65536) {
            buf.writeInt8(0xdc);
            buf.writeUInt16BE(x.length);
          } else {
            buf.writeInt8(0xdd);
            buf.writeUInt32BE(x.length);
          }
          for (const obj of x) {
            this._encode(obj, buf);
          }
        } else if (isPlainObject(x)) {
          const keys = Object.keys(x);

          if (keys.length < 16) {
            buf.writeInt8(0x80 | keys.length);
          } else {
            buf.writeInt8(0xde);
            buf.writeUInt16BE(keys.length);
          }

          for (const key of keys) {
            encodeString(key, buf);
            this._encode(x[key], buf);
          }
        } else {
          // try extensions
          const encTypes = this.encodingTypes;
          for (const [type_, info] of encTypes.entries()) {
            if (info.check(x)) {
              encodeCustom(x, type_, info.encode, buf);
              return;
            }
          }
          throw new Error(`Not supported: ${getType(x)}`);
        }
      }
    }
  }
}
