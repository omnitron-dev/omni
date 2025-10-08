import { Buffer } from 'buffer';
import type { SmartBuffer } from './smart-buffer.js';

export type EncodeFunction = (obj: any, buf: SmartBuffer | any) => any;
export type DecodeFunction = (buf: SmartBuffer | any) => any;
export type CheckFunction = (obj: any) => boolean;

export interface EncoderInfo {
  check: CheckFunction;
  encode: EncodeFunction;
}

export type BufferType = Buffer | SmartBuffer;

// Extended Buffer type with SmartBuffer compatibility methods
// Using type instead of interface to avoid conflicts with Buffer's write method
export type BufferWithSmartBufferCompat = Buffer & {
  buffer: Buffer;
  toBuffer(): Buffer;
}
