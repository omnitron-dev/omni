import { Buffer } from 'buffer';
import { DecodeFunction } from './types.js';
import { SmartBuffer } from './smart-buffer.js';

const INCOMPLETE = Symbol('incomplete MessagePack value');

export default class Decoder {
  private lastBytesConsumed: number = 0;

  constructor(private decodingTypes: Map<number, DecodeFunction>) {}

  decode(input: Buffer | Uint8Array): any {
    const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    if (buf.length === 0) {
      this.lastBytesConsumed = 0;
      throw new Error('Incomplete buffer');
    }

    let value;
    try {
      value = this.tryDecode(buf, 0);
    } catch (error) {
      this.lastBytesConsumed = 0;
      throw error;
    }

    if (value === INCOMPLETE) {
      this.lastBytesConsumed = Math.min(this.lastBytesConsumed, buf.length);
      throw new Error('Incomplete buffer');
    }
    return value;
  }

  getLastBytesConsumed(_buf?: Buffer): number {
    return this.lastBytesConsumed;
  }

  // On incomplete input the consuming SmartBuffer API advances over the available header.
  private incomplete(headerLength: number): typeof INCOMPLETE {
    this.lastBytesConsumed = headerLength;
    return INCOMPLETE;
  }

  /**
   * Try to decode from buffer starting at offset
   * Returns the value on success, including undefined, or INCOMPLETE on partial input
   * Stores bytesConsumed in this.lastBytesConsumed
   *
   * Uses nested if statements like msgpackr (20-25% faster than switch)
   */
  private tryDecode(buf: Buffer, offset: number): any {
    const bufLength = buf.length;
    if (offset >= bufLength) {
      return this.incomplete(0);
    }

    const marker = buf[offset]!;

    // Nested if for hot paths - faster than switch due to branch prediction
    // Fast path for common cases: fixint, fixstr, fixarray, fixmap
    if (marker < 0xa0) {
      if (marker < 0x80) {
        // Positive fixint (0x00 - 0x7f) - MOST COMMON case
        this.lastBytesConsumed = 1;
        return marker;
      } else if (marker < 0x90) {
        // fixmap (0x80 - 0x8f)
        const len = marker & 0x0f;
        return this.decodeMap(buf, offset + 1, len, 1);
      } else {
        // fixarray (0x90 - 0x9f)
        const len = marker & 0x0f;
        return this.decodeArray(buf, offset + 1, len, 1);
      }
    } else if (marker < 0xc0) {
      // fixstr (0xa0 - 0xbf) - SECOND MOST COMMON
      const len = marker & 0x1f;
      if (offset + 1 + len > bufLength) {
        return this.incomplete(1);
      }
      this.lastBytesConsumed = 1 + len;
      return buf.toString('utf8', offset + 1, offset + 1 + len);
    }

    // Handle all other types with nested if for better branch prediction
    if (marker >= 0xe0) {
      // Negative fixint (0xe0 - 0xff)
      this.lastBytesConsumed = 1;
      return marker - 0x100;
    }

    // nil, boolean, numbers
    if (marker === 0xc0) {
      this.lastBytesConsumed = 1;
      return null;
    }

    if (marker === 0xc2) {
      this.lastBytesConsumed = 1;
      return false;
    }

    if (marker === 0xc3) {
      this.lastBytesConsumed = 1;
      return true;
    }

    // uint8-uint64
    if (marker >= 0xcc && marker <= 0xcf) {
      if (marker === 0xcc) {
        // uint8
        if (offset + 2 > bufLength) {
          return this.incomplete(2);
        }
        this.lastBytesConsumed = 2;
        return buf[offset + 1]!;
      } else if (marker === 0xcd) {
        // uint16
        if (offset + 3 > bufLength) {
          return this.incomplete(3);
        }
        this.lastBytesConsumed = 3;
        return buf.readUInt16BE(offset + 1);
      } else if (marker === 0xce) {
        // uint32
        if (offset + 5 > bufLength) {
          return this.incomplete(5);
        }
        this.lastBytesConsumed = 5;
        return buf.readUInt32BE(offset + 1);
      } else {
        // uint64 (0xcf)
        if (offset + 9 > bufLength) {
          return this.incomplete(9);
        }
        this.lastBytesConsumed = 9;
        return buf.readUInt32BE(offset + 1) * 0x100000000 + buf.readUInt32BE(offset + 5);
      }
    }

    // int8-int64
    if (marker >= 0xd0 && marker <= 0xd3) {
      if (marker === 0xd0) {
        // int8
        if (offset + 2 > bufLength) {
          return this.incomplete(2);
        }
        this.lastBytesConsumed = 2;
        return buf.readInt8(offset + 1);
      } else if (marker === 0xd1) {
        // int16
        if (offset + 3 > bufLength) {
          return this.incomplete(3);
        }
        this.lastBytesConsumed = 3;
        return buf.readInt16BE(offset + 1);
      } else if (marker === 0xd2) {
        // int32
        if (offset + 5 > bufLength) {
          return this.incomplete(5);
        }
        this.lastBytesConsumed = 5;
        return buf.readInt32BE(offset + 1);
      } else {
        // int64 (0xd3)
        if (offset + 9 > bufLength) {
          return this.incomplete(9);
        }
        this.lastBytesConsumed = 9;
        return buf.readInt32BE(offset + 1) * 0x100000000 + buf.readUInt32BE(offset + 5);
      }
    }

    // float32/float64
    if (marker === 0xca) {
      if (offset + 5 > bufLength) {
        return this.incomplete(5);
      }
      this.lastBytesConsumed = 5;
      return buf.readFloatBE(offset + 1);
    }

    if (marker === 0xcb) {
      if (offset + 9 > bufLength) {
        return this.incomplete(9);
      }
      this.lastBytesConsumed = 9;
      return buf.readDoubleBE(offset + 1);
    }

    // strings
    if (marker === 0xd9) {
      // str8
      if (offset + 2 > bufLength) {
        return this.incomplete(2);
      }
      const len = buf[offset + 1]!;
      if (offset + 2 + len > bufLength) {
        return this.incomplete(2);
      }
      this.lastBytesConsumed = 2 + len;
      return buf.toString('utf8', offset + 2, offset + 2 + len);
    }

    if (marker === 0xda) {
      // str16
      if (offset + 3 > bufLength) {
        return this.incomplete(3);
      }
      const len = buf.readUInt16BE(offset + 1);
      if (offset + 3 + len > bufLength) {
        return this.incomplete(3);
      }
      this.lastBytesConsumed = 3 + len;
      return buf.toString('utf8', offset + 3, offset + 3 + len);
    }

    if (marker === 0xdb) {
      // str32
      if (offset + 5 > bufLength) {
        return this.incomplete(5);
      }
      const len = buf.readUInt32BE(offset + 1);
      if (offset + 5 + len > bufLength) {
        return this.incomplete(5);
      }
      this.lastBytesConsumed = 5 + len;
      return buf.toString('utf8', offset + 5, offset + 5 + len);
    }

    // Switch for remaining less common types (bin, array, map, ext)
    let len: number;

    switch (marker) {
      case 0xc4: // bin8
        if (offset + 2 > bufLength) {
          return this.incomplete(2);
        }
        len = buf[offset + 1]!;
        if (offset + 2 + len > bufLength) {
          return this.incomplete(2);
        }
        this.lastBytesConsumed = 2 + len;
        return buf.slice(offset + 2, offset + 2 + len);

      case 0xc5: // bin16
        if (offset + 3 > bufLength) {
          return this.incomplete(3);
        }
        len = buf.readUInt16BE(offset + 1);
        if (offset + 3 + len > bufLength) {
          return this.incomplete(3);
        }
        this.lastBytesConsumed = 3 + len;
        return buf.slice(offset + 3, offset + 3 + len);

      case 0xc6: // bin32
        if (offset + 5 > bufLength) {
          return this.incomplete(5);
        }
        len = buf.readUInt32BE(offset + 1);
        if (offset + 5 + len > bufLength) {
          return this.incomplete(5);
        }
        this.lastBytesConsumed = 5 + len;
        return buf.slice(offset + 5, offset + 5 + len);

      case 0xdc: // array16
        if (offset + 3 > bufLength) {
          return this.incomplete(3);
        }
        len = buf.readUInt16BE(offset + 1);
        return this.decodeArray(buf, offset + 3, len, 3);

      case 0xdd: // array32
        if (offset + 5 > bufLength) {
          return this.incomplete(5);
        }
        len = buf.readUInt32BE(offset + 1);
        return this.decodeArray(buf, offset + 5, len, 5);

      case 0xde: // map16
        if (offset + 3 > bufLength) {
          return this.incomplete(3);
        }
        len = buf.readUInt16BE(offset + 1);
        return this.decodeMap(buf, offset + 3, len, 3);

      case 0xdf: // map32
        if (offset + 5 > bufLength) {
          return this.incomplete(5);
        }
        len = buf.readUInt32BE(offset + 1);
        return this.decodeMap(buf, offset + 5, len, 5);

      case 0xd4: // fixext1
        return this.decodeFixExt(buf, offset, 1, 3);

      case 0xd5: // fixext2
        return this.decodeFixExt(buf, offset, 2, 4);

      case 0xd6: // fixext4
        return this.decodeFixExt(buf, offset, 4, 6);

      case 0xd7: // fixext8
        return this.decodeFixExt(buf, offset, 8, 10);

      case 0xd8: // fixext16
        return this.decodeFixExt(buf, offset, 16, 18);

      case 0xc7: // ext8
        if (offset + 3 > bufLength) {
          return this.incomplete(3);
        }
        len = buf[offset + 1]!;
        return this.decodeExt(buf, offset, len, 3);

      case 0xc8: // ext16
        if (offset + 4 > bufLength) {
          return this.incomplete(4);
        }
        len = buf.readUInt16BE(offset + 1);
        return this.decodeExt(buf, offset, len, 4);

      case 0xc9: // ext32
        if (offset + 6 > bufLength) {
          return this.incomplete(6);
        }
        len = buf.readUInt32BE(offset + 1);
        return this.decodeExt(buf, offset, len, 6);

      default:
        throw new Error(`Unknown MessagePack type: 0x${marker.toString(16)}`);
    }
  }

  private decodeArray(buf: Buffer, offset: number, length: number, headerLength: number): any {
    if (length > buf.length - offset) return this.incomplete(headerLength);
    const result: any[] = [];
    let totalConsumed = 0;

    for (let i = 0; i < length; i++) {
      const item = this.tryDecode(buf, offset + totalConsumed);
      if (item === INCOMPLETE) {
        return this.incomplete(headerLength);
      }
      result.push(item);
      totalConsumed += this.lastBytesConsumed;
    }

    this.lastBytesConsumed = headerLength + totalConsumed;
    return result;
  }

  private decodeMap(buf: Buffer, offset: number, length: number, headerLength: number): any {
    // Even an empty key and a nil value need one marker each.
    if (length * 2 > buf.length - offset) return this.incomplete(headerLength);
    const result: Record<string, any> = {};
    let totalConsumed = 0;

    for (let i = 0; i < length; i++) {
      // Decode key
      const key = this.tryDecode(buf, offset + totalConsumed);
      if (key === INCOMPLETE) {
        return this.incomplete(headerLength);
      }
      totalConsumed += this.lastBytesConsumed;

      // Decode value
      const value = this.tryDecode(buf, offset + totalConsumed);
      if (value === INCOMPLETE) {
        return this.incomplete(headerLength);
      }
      totalConsumed += this.lastBytesConsumed;

      // Coercible keys and special names must become own data properties.
      if (
        (typeof key !== 'string' && typeof key !== 'number') ||
        key === '__proto__' ||
        key === 'constructor' ||
        key === 'prototype'
      ) {
        Object.defineProperty(result, key, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      } else {
        result[key] = value;
      }
    }

    this.lastBytesConsumed = headerLength + totalConsumed;
    return result;
  }

  /** Decode fixed-size extension */
  private decodeFixExt(buf: Buffer, offset: number, size: number, totalSize: number): any {
    if (offset + totalSize > buf.length) {
      return this.incomplete(2);
    }

    const type = buf[offset + 1]!;
    return this.decodeExtData(buf, offset + 2, type, size, totalSize);
  }

  /** Decode variable-size extension */
  private decodeExt(buf: Buffer, offset: number, size: number, headerSize: number): any {
    if (offset + headerSize + size > buf.length) {
      return this.incomplete(headerSize);
    }

    const type = buf[offset + headerSize - 1]!;
    return this.decodeExtData(buf, offset + headerSize, type, size, headerSize + size);
  }

  /** Decode extension data */
  private decodeExtData(buf: Buffer, dataOffset: number, type: number, size: number, totalSize: number): any {
    const decode = this.decodingTypes.get(type);

    if (decode) {
      const dataBuf = buf.slice(dataOffset, dataOffset + size);
      // Wrap in SmartBuffer for custom decoders that need read methods
      const smartBuf = SmartBuffer.fromBuffer(dataBuf);

      const value = decode(smartBuf as any);

      // Set the correct bytesConsumed for this extension type.
      // Custom decoder may have called decode() multiple times, modifying lastBytesConsumed,
      // so we must set it to the totalSize of this extension.
      this.lastBytesConsumed = totalSize;

      return value;
    }

    // Special case: undefined (type 0, value 0)
    if (type === 0 && size === 1 && buf[dataOffset] === 0) {
      this.lastBytesConsumed = totalSize;
      return undefined;
    }

    throw new Error(`Unable to find ext type ${type}`);
  }
}
