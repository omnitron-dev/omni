import { Buffer } from 'buffer';
import Long from 'long';

/**
 * SmartBuffer for encoder state
 */
export class SmartBuffer {
  private buffer: Buffer;
  private position: number;
  private capacity: number;

  constructor(initialCapacity: number = 128) {
    this.capacity = initialCapacity;
    this.buffer = Buffer.allocUnsafe(initialCapacity);
    this.position = 0;
  }

  /** Create SmartBufferCompat from existing Buffer for reading */
  static fromBuffer(buf: Buffer): SmartBuffer {
    const instance = new SmartBuffer(buf.length);
    instance.buffer = buf;
    instance.capacity = buf.length;
    instance.position = buf.length; // Set to length since buffer is pre-filled
    instance._roffset = 0; // Start reading from beginning
    return instance;
  }

  /** Alias for fromBuffer - for backward compatibility */
  static wrap(buf: Buffer | ArrayBuffer): SmartBuffer {
    const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    return SmartBuffer.fromBuffer(buffer);
  }

  private ensure(size: number): void {
    const needed = this.position + size;
    if (needed > this.capacity) {
      const newCapacity = Math.max(this.capacity * 2, needed);
      const newBuffer = Buffer.allocUnsafe(newCapacity);
      this.buffer.copy(newBuffer, 0, 0, this.position);
      this.buffer = newBuffer;
      this.capacity = newCapacity;
    }
  }

  // Write methods
  writeUInt8(value: number): void {
    this.ensure(1);
    this.buffer[this.position++] = value;
  }

  writeInt8(value: number): void {
    this.ensure(1);
    this.buffer.writeInt8(value, this.position);
    this.position++;
  }

  writeUInt16BE(value: number): void {
    this.ensure(2);
    this.buffer.writeUInt16BE(value, this.position);
    this.position += 2;
  }

  writeInt16BE(value: number): void {
    this.ensure(2);
    this.buffer.writeInt16BE(value, this.position);
    this.position += 2;
  }

  writeUInt32BE(value: number): void {
    this.ensure(4);
    this.buffer.writeUInt32BE(value, this.position);
    this.position += 4;
  }

  writeInt32BE(value: number): void {
    this.ensure(4);
    this.buffer.writeInt32BE(value, this.position);
    this.position += 4;
  }

  writeUInt64BE(value: number | Long): void {
    this.ensure(8);
    if (typeof value === 'number') {
      const high = Math.floor(value / 0x100000000);
      const low = value >>> 0;
      this.buffer.writeUInt32BE(high, this.position);
      this.buffer.writeUInt32BE(low, this.position + 4);
    } else {
      this.buffer.writeUInt32BE(value.high >>> 0, this.position);
      this.buffer.writeUInt32BE(value.low >>> 0, this.position + 4);
    }
    this.position += 8;
  }

  writeInt64BE(value: number | Long): void {
    this.ensure(8);
    if (typeof value === 'number') {
      const high = Math.floor(value / 0x100000000);
      const low = value >>> 0;
      this.buffer.writeInt32BE(high, this.position);
      this.buffer.writeUInt32BE(low, this.position + 4);
    } else {
      this.buffer.writeInt32BE(value.high, this.position);
      this.buffer.writeUInt32BE(value.low >>> 0, this.position + 4);
    }
    this.position += 8;
  }

  writeDoubleBE(value: number): void {
    this.ensure(8);
    this.buffer.writeDoubleBE(value, this.position);
    this.position += 8;
  }

  writeFloatBE(value: number): void {
    this.ensure(4);
    this.buffer.writeFloatBE(value, this.position);
    this.position += 4;
  }

  write(data: Buffer | string, encoding?: BufferEncoding, length?: number): SmartBuffer {
    if (typeof data === 'string') {
      const len = length || Buffer.byteLength(data, encoding);
      this.ensure(len);
      this.buffer.write(data, this.position, len, encoding);
      this.position += len;
    } else {
      const len = length || data.length;
      this.ensure(len);
      data.copy(this.buffer, this.position, 0, len);
      this.position += len;
    }
    return this;
  }

  // Read methods (for decoder compatibility)
  private _roffset: number = 0;

  get roffset(): number {
    return this._roffset;
  }

  set roffset(value: number) {
    this._roffset = value;
  }

  get woffset(): number {
    return this.position;
  }

  set woffset(value: number) {
    this.position = value;
  }

  get length(): number {
    return this.position - this._roffset;
  }

  readUInt8(offset?: number): number | undefined {
    const pos = offset !== undefined ? offset : this._roffset;
    if (pos >= this.position) return undefined;
    if (offset === undefined) this._roffset++;
    return this.buffer[pos];
  }

  readInt8(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    if (offset === undefined) this._roffset++;
    return this.buffer.readInt8(pos);
  }

  readUInt16BE(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    const value = this.buffer.readUInt16BE(pos);
    if (offset === undefined) this._roffset += 2;
    return value;
  }

  readInt16BE(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    const value = this.buffer.readInt16BE(pos);
    if (offset === undefined) this._roffset += 2;
    return value;
  }

  readUInt32BE(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    const value = this.buffer.readUInt32BE(pos);
    if (offset === undefined) this._roffset += 4;
    return value;
  }

  readInt32BE(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    const value = this.buffer.readInt32BE(pos);
    if (offset === undefined) this._roffset += 4;
    return value;
  }

  readUInt64BE(offset?: number): Long {
    const pos = offset !== undefined ? offset : this._roffset;
    const high = this.buffer.readUInt32BE(pos);
    const low = this.buffer.readUInt32BE(pos + 4);
    if (offset === undefined) this._roffset += 8;
    return Long.fromBits(low, high, true);
  }

  readInt64BE(offset?: number): Long {
    const pos = offset !== undefined ? offset : this._roffset;
    const high = this.buffer.readInt32BE(pos);
    const low = this.buffer.readUInt32BE(pos + 4);
    if (offset === undefined) this._roffset += 8;
    return Long.fromBits(low, high, false);
  }

  readDoubleBE(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    const value = this.buffer.readDoubleBE(pos);
    if (offset === undefined) this._roffset += 8;
    return value;
  }

  readFloatBE(offset?: number): number {
    const pos = offset !== undefined ? offset : this._roffset;
    const value = this.buffer.readFloatBE(pos);
    if (offset === undefined) this._roffset += 4;
    return value;
  }

  toString(encoding: BufferEncoding, start: number, end: number): string {
    return this.buffer.toString(encoding, start, end);
  }

  slice(start: number, end: number): SmartBuffer {
    const result = new SmartBuffer(end - start);
    this.buffer.copy(result.buffer, 0, start, end);
    result.position = end - start;
    return result;
  }

  /** Skip bytes in read buffer */
  skipRead(bytes: number): void {
    this._roffset += bytes;
  }

  /** Get remaining unread buffer for decoding */
  getRemainingBuffer(): Buffer {
    return this.buffer.slice(this._roffset, this.position);
  }

  toBuffer(): Buffer {
    return this.buffer.slice(0, this.position);
  }
}
