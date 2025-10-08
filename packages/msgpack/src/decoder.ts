import { Buffer } from 'buffer';
import { DecodeFunction } from './types.js';
import { SmartBuffer } from './smart-buffer.js';

/**
 * Ultra-high-performance MessagePack Decoder
 *
 * Key optimizations inspired by msgpackr:
 * 1. Nested if statements for hot paths (20-25% faster than switch)
 * 2. No object allocation for DecodeResult (eliminates 30-50 cycles overhead)
 * 3. DataView caching for multi-byte reads
 * 4. Direct buffer indexing instead of readXXX methods
 * 5. Inline fast paths for fixint, fixstr, fixarray, fixmap
 * 6. Local variables instead of repeated property access
 */

export default class Decoder {
  private lastBytesConsumed: number = 0;
  private view: DataView | null = null;  // Cached DataView

  constructor(private decodingTypes: Map<number, DecodeFunction>) { }

  decode(buf: Buffer): any {
    if (buf.length === 0) {
      this.lastBytesConsumed = 0;
      throw new Error('Incomplete buffer');
    }

    // Cache DataView for multi-byte operations
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

    // Try decode - stores bytesConsumed in this.lastBytesConsumed
    const value = this.tryDecode(buf, 0);

    if (value === undefined && this.lastBytesConsumed === 0) {
      // Incomplete buffer - calculate minimum bytes needed
      this.lastBytesConsumed = this.getMinHeaderSize(buf[0]!);
      if (this.lastBytesConsumed > buf.length) {
        this.lastBytesConsumed = buf.length;
      }
      throw new Error('Incomplete buffer');
    }

    return value;
  }

  getLastBytesConsumed(buf?: Buffer): number {
    return this.lastBytesConsumed;
  }

  /** Get minimum header size for a given marker byte */
  private getMinHeaderSize(marker: number): number {
    // Fixint, fixstr, fixarray, fixmap, nil, bool - 1 byte
    if (marker < 0x80 || marker >= 0xe0 || // fixint
      (marker >= 0xa0 && marker <= 0xbf) || // fixstr
      (marker >= 0x90 && marker <= 0x9f) || // fixarray
      (marker >= 0x80 && marker <= 0x8f) || // fixmap
      marker === 0xc0 || marker === 0xc2 || marker === 0xc3) { // nil, false, true
      return 1;
    }

    // Types with 2-byte headers (marker + 1 byte)
    if (marker === 0xc4 || marker === 0xc7 || marker === 0xcc || marker === 0xd0 ||
      marker === 0xd4) {
      return 2;
    }

    // Types with 3-byte headers (marker + 2 bytes)
    if (marker === 0xc5 || marker === 0xc8 || marker === 0xcd || marker === 0xd1 ||
      marker === 0xd5 || marker === 0xd9) {
      return 3;
    }

    // Types with 4-byte headers (marker + 3 bytes)
    if (marker === 0xd2) {
      return 4;
    }

    // Types with 5-byte headers (marker + 4 bytes)
    if (marker === 0xca || marker === 0xc6 || marker === 0xc9 || marker === 0xce ||
      marker === 0xd6 || marker === 0xda || marker === 0xdc) {
      return 5;
    }

    // Types with 6-byte headers (marker + 5 bytes)
    if (marker === 0xd3) {
      return 6;
    }

    // Types with 9-byte headers (marker + 8 bytes)
    if (marker === 0xcb || marker === 0xd7 || marker === 0xdb || marker === 0xdd) {
      return 9;
    }

    // Types with 10-byte headers (marker + 9 bytes)
    if (marker === 0xd8) {
      return 10;
    }

    // Types with 18-byte headers (marker + 17 bytes)
    if (marker === 0xd9) {
      return 18;
    }

    // Default to 1
    return 1;
  }

  /**
   * Try to decode from buffer starting at offset
   * Returns value on success, undefined on incomplete buffer
   * Stores bytesConsumed in this.lastBytesConsumed
   *
   * Uses nested if statements like msgpackr (20-25% faster than switch)
   */
  private tryDecode(buf: Buffer, offset: number): any {
    const bufLength = buf.length;
    if (offset >= bufLength) {
      this.lastBytesConsumed = 0;
      return undefined;
    }

    const marker = buf[offset]!;
    const view = this.view!;

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
        this.lastBytesConsumed = 0;
        return undefined;
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
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 2;
        return buf[offset + 1]!;
      } else if (marker === 0xcd) {
        // uint16
        if (offset + 3 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 3;
        return view.getUint16(offset + 1, false);
      } else if (marker === 0xce) {
        // uint32
        if (offset + 5 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 5;
        return view.getUint32(offset + 1, false);
      } else {
        // uint64 (0xcf)
        if (offset + 9 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 9;
        return view.getUint32(offset + 1, false) * 0x100000000 + view.getUint32(offset + 5, false);
      }
    }

    // int8-int64
    if (marker >= 0xd0 && marker <= 0xd3) {
      if (marker === 0xd0) {
        // int8
        if (offset + 2 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 2;
        return view.getInt8(offset + 1);
      } else if (marker === 0xd1) {
        // int16
        if (offset + 3 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 3;
        return view.getInt16(offset + 1, false);
      } else if (marker === 0xd2) {
        // int32
        if (offset + 5 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 5;
        return view.getInt32(offset + 1, false);
      } else {
        // int64 (0xd3)
        if (offset + 9 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 9;
        return view.getInt32(offset + 1, false) * 0x100000000 + view.getUint32(offset + 5, false);
      }
    }

    // float32/float64
    if (marker === 0xca) {
      if (offset + 5 > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      this.lastBytesConsumed = 5;
      return view.getFloat32(offset + 1, false);
    }

    if (marker === 0xcb) {
      if (offset + 9 > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      this.lastBytesConsumed = 9;
      return view.getFloat64(offset + 1, false);
    }

    // strings
    if (marker === 0xd9) {
      // str8
      if (offset + 2 > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      const len = buf[offset + 1]!;
      if (offset + 2 + len > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      this.lastBytesConsumed = 2 + len;
      return buf.toString('utf8', offset + 2, offset + 2 + len);
    }

    if (marker === 0xda) {
      // str16
      if (offset + 3 > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      const len = view.getUint16(offset + 1, false);
      if (offset + 3 + len > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      this.lastBytesConsumed = 3 + len;
      return buf.toString('utf8', offset + 3, offset + 3 + len);
    }

    if (marker === 0xdb) {
      // str32
      if (offset + 5 > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      const len = view.getUint32(offset + 1, false);
      if (offset + 5 + len > bufLength) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      this.lastBytesConsumed = 5 + len;
      return buf.toString('utf8', offset + 5, offset + 5 + len);
    }

    // Switch for remaining less common types (bin, array, map, ext)
    let len: number;

    switch (marker) {
      case 0xc4: // bin8
        if (offset + 2 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = buf[offset + 1]!;
        if (offset + 2 + len > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 2 + len;
        return buf.slice(offset + 2, offset + 2 + len);

      case 0xc5: // bin16
        if (offset + 3 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint16(offset + 1, false);
        if (offset + 3 + len > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 3 + len;
        return buf.slice(offset + 3, offset + 3 + len);

      case 0xc6: // bin32
        if (offset + 5 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint32(offset + 1, false);
        if (offset + 5 + len > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        this.lastBytesConsumed = 5 + len;
        return buf.slice(offset + 5, offset + 5 + len);

      case 0xdc: // array16
        if (offset + 3 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint16(offset + 1, false);
        return this.decodeArray(buf, offset + 3, len, 3);

      case 0xdd: // array32
        if (offset + 5 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint32(offset + 1, false);
        return this.decodeArray(buf, offset + 5, len, 5);

      case 0xde: // map16
        if (offset + 3 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint16(offset + 1, false);
        return this.decodeMap(buf, offset + 3, len, 3);

      case 0xdf: // map32
        throw new Error('map too big to decode in JS');

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
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = buf[offset + 1]!;
        return this.decodeExt(buf, offset, len, 3);

      case 0xc8: // ext16
        if (offset + 4 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint16(offset + 1, false);
        return this.decodeExt(buf, offset, len, 4);

      case 0xc9: // ext32
        if (offset + 6 > bufLength) {
          this.lastBytesConsumed = 0;
          return undefined;
        }
        len = view.getUint32(offset + 1, false);
        return this.decodeExt(buf, offset, len, 6);

      default:
        throw new Error(`Unknown MessagePack type: 0x${marker.toString(16)}`);
    }
  }

  /** Decode array - no object allocation */
  private decodeArray(buf: Buffer, offset: number, length: number, headerLength: number): any {
    const result: any[] = [];
    let totalConsumed = 0;

    for (let i = 0; i < length; i++) {
      const item = this.tryDecode(buf, offset + totalConsumed);
      if (item === undefined && this.lastBytesConsumed === 0) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      result.push(item);
      totalConsumed += this.lastBytesConsumed;
    }

    this.lastBytesConsumed = headerLength + totalConsumed;
    return result;
  }

  /** Decode map - no object allocation */
  private decodeMap(buf: Buffer, offset: number, length: number, headerLength: number): any {
    const result: Record<string, any> = {};
    let totalConsumed = 0;

    for (let i = 0; i < length; i++) {
      // Decode key
      const key = this.tryDecode(buf, offset + totalConsumed);
      if (key === undefined && this.lastBytesConsumed === 0) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      totalConsumed += this.lastBytesConsumed;

      // Decode value
      const value = this.tryDecode(buf, offset + totalConsumed);
      if (value === undefined && this.lastBytesConsumed === 0) {
        this.lastBytesConsumed = 0;
        return undefined;
      }
      totalConsumed += this.lastBytesConsumed;

      result[key] = value;
    }

    this.lastBytesConsumed = headerLength + totalConsumed;
    return result;
  }

  /** Decode fixed-size extension */
  private decodeFixExt(buf: Buffer, offset: number, size: number, totalSize: number): any {
    if (offset + totalSize > buf.length) {
      this.lastBytesConsumed = 0;
      return undefined;
    }

    const type = buf[offset + 1]!;
    return this.decodeExtData(buf, offset + 2, type, size, totalSize);
  }

  /** Decode variable-size extension */
  private decodeExt(buf: Buffer, offset: number, size: number, headerSize: number): any {
    if (offset + headerSize + size > buf.length) {
      this.lastBytesConsumed = 0;
      return undefined;
    }

    const type = buf[offset + headerSize - 1]!;
    return this.decodeExtData(buf, offset + headerSize, type, size, headerSize + size);
  }

  /** Decode extension data */
  private decodeExtData(buf: Buffer, dataOffset: number, type: number, size: number, totalSize: number): any {
    const decode = this.decodingTypes.get(type);

    if (decode) {
      const dataBuf = buf.slice(dataOffset, dataOffset + size);
      // Wrap in SmartBufferCompat for custom decoders that need read methods
      const smartBuf = SmartBuffer.fromBuffer(dataBuf);
      const value = decode(smartBuf as any);
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
