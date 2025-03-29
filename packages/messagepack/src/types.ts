import { Buffer } from 'buffer';
import { SmartBuffer } from '@devgrid/smartbuffer';

export type EncodeFunction = (obj: any, buf: SmartBuffer) => any;
export type DecodeFunction = (buf: SmartBuffer) => any;
export type CheckFunction = (obj: any) => boolean;

export interface EncoderInfo {
  check: CheckFunction;
  encode: EncodeFunction;
}

export type BufferType = Buffer | SmartBuffer;
