import { Uid } from '../uid';
import { PacketType, TYPE_STREAM, PacketImpulse } from './types';

/**
 * Gets the value of the bit at the specified position.
 * @param target - The number from which to get the bit.
 * @param offset - The position of the bit to get.
 * @returns The value of the bit (0 or 1).
 */
const getBit = (target: number, offset: number): number => (target >> offset) & 1;

/**
 * Clears multiple bits starting from the specified position.
 * @param target - The number in which to clear the bits.
 * @param offset - The starting position to clear the bits.
 * @param count - The number of bits to clear.
 * @returns A new number with the bits cleared.
 */
const clearBits = (target: number, offset: number, count: number): number => {
  let result = target;
  for (let i = offset; i < offset + count; ++i) {
    result &= ~(1 << i);
  }
  return result;
};

/**
 * Writes multiple bits at the specified position.
 * @param target - The number in which to write the bits.
 * @param val - The value to write.
 * @param offset - The starting position to write the bits.
 * @param count - The number of bits to write.
 * @returns A new number with the bits written.
 */
const writeBits = (target: number, val: number, offset: number, count: number): number => {
  let result = target;
  for (let i = 0; i < count; ++i) {
    if (val & (1 << i)) {
      result |= 1 << (offset + i);
    }
  }
  return result;
};

/**
 * Reads multiple bits starting from the specified position.
 * @param target - The number from which to read the bits.
 * @param offset - The starting position to read the bits.
 * @param count - The number of bits to read.
 * @returns The value of the read bits.
 */
const readBits = (target: number, offset: number, count: number): number => {
  let val = 0;
  for (let i = 0; i < count; ++i) {
    if (getBit(target, offset + i)) {
      val |= 1 << i;
    }
  }
  return val;
};

/**
 * Represents a netron packet.
 *
 * Packet fields in order from left to right:
 * - flags - control flags (uint8)
 * - id    - packet identifier (uint32)
 * - data  - payload
 *
 * flags:
 *
 *   name    | offset | bits | min-max | description
 *  -------------------------------------------------------------------------------------------------------------------------------------
 *   type           0      4      0-15 | Packet type (see ACTION_*)
 *   eos            4      1       0-1 | End of stream (1 - last packet, 0 - not last packet)
 *   live           5      1       0-1 | Live stream (1 - live, 0 - not live)
 *   impulse        6      1       0-1 | Impulse (1 - request, 0 - response) (note: for stream packets, impulse is always 0)
 *   error          7      1       0-1 | Error (1 - error present, 0 - no error)
 *
 */

const IMPULSE_OFFSET = 6; // Offset for the impulse flag
const ERROR_OFFSET = 7; // Offset for the error flag
const TYPE_OFFSET = 0; // Offset for the packet type
const TYPE_SIZE = 4; // Size of the packet type field
const EOS_OFFSET = 4; // Offset for the end of stream flag
const LIVE_OFFSET = 5; // Offset for the live flag

const uid = new Uid();

export class Packet {
  public flags = 0; // Control flags of the packet (uint8)
  public data: any; // Payload of the packet (any)
  public streamId?: number; // Unique stream ID (uint32)
  public streamIndex?: number; // Chunk number (uint32)

  /**
   * Constructor for the Packet class.
   * @param id - Packet identifier (uint32).
   */
  constructor(public id: number) { }

  /**
   * Sets the type in the control flags.
   * @param type - The type to set.
   */
  setType(type: PacketType) {
    this.flags = writeBits(clearBits(this.flags, TYPE_OFFSET, TYPE_SIZE), type, TYPE_OFFSET, TYPE_SIZE);
  }

  /**
   * Gets the type from the control flags.
   * @returns The type set in the control flags.
   */
  getType(): PacketType {
    return readBits(this.flags, TYPE_OFFSET, TYPE_SIZE) as PacketType;
  }

  /**
   * Sets the impulse in the control flags.
   * @param val - The value of the impulse (0 or 1).
   */
  setImpulse(val: PacketImpulse) {
    this.flags = (this.flags & ~(1 << IMPULSE_OFFSET)) | (val << IMPULSE_OFFSET);
  }

  /**
   * Gets the impulse from the control flags.
   * @returns The value of the impulse (0 or 1).
   */
  getImpulse(): PacketImpulse {
    return getBit(this.flags, IMPULSE_OFFSET) as PacketImpulse;
  }

  /**
   * Sets the error in the control flags.
   * @param val - The value of the error (0 or 1).
   */
  setError(val: 0 | 1) {
    this.flags = (this.flags & ~(1 << ERROR_OFFSET)) | (val << ERROR_OFFSET);
  }

  /**
   * Gets the error from the control flags.
   * @returns The value of the error (0 or 1).
   */
  getError() {
    return getBit(this.flags, ERROR_OFFSET);
  }

  // Methods for working with streams
  /**
   * Sets the stream information in the control flags.
   * @param streamId - The unique stream ID.
   * @param streamIndex - The chunk number.
   * @param streamType - The type of the stream.
   */
  setStreamInfo(streamId: number, streamIndex: number, isLast: boolean, isLive: boolean) {
    this.streamId = streamId;
    this.streamIndex = streamIndex;
    this.flags = writeBits(writeBits(this.flags, isLast ? 1 : 0, EOS_OFFSET, 1), isLive ? 1 : 0, LIVE_OFFSET, 1);
  }

  /**
   * Checks if the packet is a stream chunk.
   * @returns True if the packet is a stream chunk, false otherwise.
   */
  isStreamChunk(): boolean {
    return this.getType() === TYPE_STREAM;
  }

  /**
   * Checks if the packet is the last chunk of a stream.
   * @returns True if the packet is the last chunk of a stream, false otherwise.
   */
  isLastChunk(): boolean {
    return getBit(this.flags, EOS_OFFSET) === 1;
  }

  /**
   * Checks if the stream is live.
   * @returns True if the stream is live, false otherwise.
   */
  isLive(): boolean {
    return getBit(this.flags, LIVE_OFFSET) === 1;
  }

  /**
   * Generates the next packet ID.
   * @returns The next packet ID.
   */
  static nextId(): number {
    return uid.next();
  }

  /**
   * Resets the packet ID generator.
   */
  static resetId() {
    uid.reset();
  }
}
