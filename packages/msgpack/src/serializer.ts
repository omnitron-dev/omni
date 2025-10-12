import { Buffer } from 'buffer';
import Encoder from './encoder.js';
import Decoder from './decoder.js';
import { SmartBuffer } from './smart-buffer.js';
import { DecodeFunction, EncodeFunction } from './types.js';

// Optimized encoder types
type OptimizedEncodeFunction = (obj: any) => Buffer;
interface OptimizedEncoderInfo {
  check: (obj: any) => boolean;
  encode: OptimizedEncodeFunction;
}

/**
 * Optimized Serializer with same API as original
 * Uses direct Buffer manipulation for maximum performance
 */
export default class Serializer {
  private encodingTypes: Map<number, OptimizedEncoderInfo> = new Map();
  private decodingTypes: Map<number, DecodeFunction> = new Map();

  public encoder: Encoder;
  public decoder: Decoder;

  constructor(private initialCapacity = 64) {
    this.encoder = new Encoder(this.encodingTypes);
    this.decoder = new Decoder(this.decodingTypes);
  }

  registerEncoder(type: number, check: any, encode: OptimizedEncodeFunction): Serializer {
    this.encodingTypes.set(type, { check, encode });
    return this;
  }

  registerDecoder(type: number, decode: DecodeFunction): Serializer {
    this.decodingTypes.set(type, decode);
    return this;
  }

  register(type: number, constructor: any, encode: EncodeFunction, decode: DecodeFunction): Serializer {
    if (type < 0 || type > 127) {
      throw new RangeError(`Bad type: 0 <= ${type} <= 127`);
    }

    // Wrap encode function to work with SmartBufferCompat
    this.registerEncoder(
      type,
      (obj: any) => obj instanceof constructor,
      (obj: any) => {
        // Create SmartBufferCompat for user's encode function
        const buf = new SmartBuffer(this.initialCapacity);
        // Call user's encode function
        encode(obj, buf as any);
        // Return the encoded buffer
        return buf.toBuffer();
      }
    );

    this.registerDecoder(type, decode);

    return this;
  }

  encode(x: any): any;
  encode(x: any, buf: SmartBuffer | any): void;
  encode(x: any, buf?: SmartBuffer | any): any {
    const encoded = this.encoder.encode(x);
    if (buf) {
      buf.write(encoded);
    } else {
      // Add SmartBuffer compatibility methods
      const result = encoded as any;

      // Add toBuffer() - safe, Buffer doesn't have this
      result.toBuffer = function () {
        return this;
      };

      // NOTE: Do NOT add .buffer property - it breaks Buffer.slice() internals!
      // Tests that need .buffer should use .toBuffer() instead

      // Add custom write(buf, offset) - overrides Buffer.write(string)
      // Store original write for string operations
      const originalWrite = result.write;
      result.write = function (bufOrString: any, offsetOrEncoding?: any, lengthOrEncoding?: any, encoding?: any) {
        // If first arg is a Buffer, do Buffer copy (SmartBuffer behavior)
        if (Buffer.isBuffer(bufOrString)) {
          this.copy(bufOrString, offsetOrEncoding || 0);
          return this.length;
        }
        // Otherwise use Buffer's original write for strings
        return originalWrite.call(this, bufOrString, offsetOrEncoding, lengthOrEncoding, encoding);
      };

      return result;
    }
  }

  decode(buf: Buffer | SmartBuffer | any): any {
    // Handle SmartBufferCompat - must read from current read offset
    // Use duck typing instead of instanceof for cross-package compatibility
    if (buf && typeof buf.getRemainingBuffer === 'function' && typeof buf.skipRead === 'function') {
      // Get remaining buffer from current read offset
      const remaining = buf.getRemainingBuffer();
      try {
        const result = this.decoder.decode(remaining);
        return result;
      } finally {
        // ALWAYS advance read offset by consumed bytes, even on error
        // This is important for stream processing with incomplete buffers
        const consumed = this.decoder.getLastBytesConsumed(remaining);
        buf.skipRead(consumed);
      }
    }
    // Handle SmartBuffer (has toBuffer method AND read method) - for backward compatibility
    // Note: Our enhanced Buffers have toBuffer but NOT read, so they'll skip this
    if (
      buf &&
      typeof buf.toBuffer === 'function' &&
      typeof buf.read === 'function' &&
      typeof buf.readUInt8 === 'function'
    ) {
      // This is the old SmartBuffer - need to track position updates
      const startRoffset = buf.roffset || 0;
      try {
        const result = this.decoder.decode(buf.toBuffer().slice(startRoffset));
        return result;
      } finally {
        // Update SmartBuffer position even on error
        const consumed = this.decoder.getLastBytesConsumed();
        buf.roffset = startRoffset + consumed;
      }
    }
    // Handle plain Buffer (including our enhanced Buffers with toBuffer method)
    if (Buffer.isBuffer(buf)) {
      return this.decoder.decode(buf);
    }
    // Fallback - try to convert to Buffer if it has toBuffer
    if (buf && typeof buf.toBuffer === 'function') {
      return this.decoder.decode(buf.toBuffer());
    }
    // Last resort - assume it's a Buffer-like object
    return this.decoder.decode(buf);
  }
}
