import { Buffer } from 'buffer';
import type { SmartBuffer } from './smart-buffer.js';

export type EncodeFunction = (obj: any, buf: SmartBuffer | any) => any;
export type DecodeFunction = (buf: SmartBuffer | any) => any;
export type CheckFunction = (obj: any) => boolean;

export interface EncoderInfo {
  check: CheckFunction;
  encode: EncodeFunction;
}

/**
 * What `decode` accepts — and it has to include what `encode` RETURNS.
 *
 * `encode` hands back whatever `serializer.encode` produces, which is a plain
 * `Uint8Array`. `BufferType` named `Buffer | SmartBuffer`, and since
 * `@types/node` 25 a `Uint8Array<ArrayBufferLike>` is not assignable to
 * `Buffer<ArrayBufferLike>` — it lacks `write`, `toJSON`, `equals`, `compare`
 * and 66 more. So `decode(encode(x))`, the library's own round trip and the
 * first line of any consumer's code, did not typecheck. It has always RUN:
 * `decode` passes a non-SmartBuffer straight to `serializer.decode`, which
 * reads a `Uint8Array` perfectly well. Only the declaration was narrower than
 * the behaviour.
 *
 * `Buffer` stays in the union though it is a `Uint8Array` subclass, because
 * the name is what a reader of this line is looking for.
 */
export type BufferType = Buffer | Uint8Array | SmartBuffer;

// Extended Buffer type with SmartBuffer compatibility methods
// Using type instead of interface to avoid conflicts with Buffer's write method
export type BufferWithSmartBufferCompat = Buffer & {
  buffer: Buffer;
  toBuffer(): Buffer;
};
