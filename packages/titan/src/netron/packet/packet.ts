import { Uid } from '../uid.js';
import { PacketType, TYPE_STREAM, PacketImpulse } from './types.js';

/**
 * Extracts the value of a single bit from a number at a specified position.
 * This is a low-level bit manipulation utility function used throughout the packet implementation.
 *
 * @param {number} target - The source number from which to extract the bit value
 * @param {number} offset - The zero-based position of the bit to extract (0 = least significant bit)
 * @returns {number} The value of the bit at the specified position (0 or 1)
 *
 * @example
 * // Get the 3rd bit (position 2) of the number 5 (binary 101)
 * const bit = getBit(5, 2); // Returns 1
 */
const getBit = (target: number, offset: number): number => (target >> offset) & 1;

/**
 * Clears a range of bits in a number, setting them to 0.
 * This operation preserves all other bits in the number while zeroing out the specified range.
 *
 * @param {number} target - The number in which to clear bits
 * @param {number} offset - The starting position of the bits to clear
 * @param {number} count - The number of consecutive bits to clear
 * @returns {number} A new number with the specified bits cleared
 *
 * @example
 * // Clear bits 2-4 (inclusive) of the number 255 (binary 11111111)
 * const result = clearBits(255, 2, 3); // Returns 227 (binary 11100011)
 */
const clearBits = (target: number, offset: number, count: number): number => {
  let result = target;
  for (let i = offset; i < offset + count; ++i) {
    result &= ~(1 << i);
  }
  return result;
};

/**
 * Writes a value into a range of bits in a number.
 * This operation combines clearing the target bits and then setting them to the new value.
 *
 * @param {number} target - The number in which to write bits
 * @param {number} val - The value to write into the bits
 * @param {number} offset - The starting position to write the bits
 * @param {number} count - The number of bits to write
 * @returns {number} A new number with the specified bits updated
 *
 * @example
 * // Write the value 3 (binary 11) into bits 2-3 of the number 0
 * const result = writeBits(0, 3, 2, 2); // Returns 12 (binary 1100)
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
 * Reads a range of bits from a number and returns them as a new value.
 * This operation extracts consecutive bits and combines them into a single number.
 *
 * @param {number} target - The number from which to read bits
 * @param {number} offset - The starting position to read bits
 * @param {number} count - The number of bits to read
 * @returns {number} The value of the read bits combined into a single number
 *
 * @example
 * // Read bits 2-3 from the number 12 (binary 1100)
 * const value = readBits(12, 2, 2); // Returns 3 (binary 11)
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

const IMPULSE_OFFSET = 6; // Bit position for the impulse flag
const ERROR_OFFSET = 7; // Bit position for the error flag
const TYPE_OFFSET = 0; // Starting bit position for the type field
const TYPE_SIZE = 4; // Number of bits used for the type field
const EOS_OFFSET = 4; // Bit position for the end of stream flag
const LIVE_OFFSET = 5; // Bit position for the live stream flag

const uid = new Uid();

/**
 * Represents a Netron network packet with its control flags and payload data.
 *
 * The packet structure consists of:
 * - flags: Control flags (uint8) containing various packet metadata
 * - id: Packet identifier (uint32) for tracking and correlation
 * - data: The actual payload data of the packet
 * - streamId: Optional unique identifier for stream packets (uint32)
 * - streamIndex: Optional chunk number for stream packets (uint32)
 *
 * The control flags are organized as follows:
 *
 * | Field    | Offset | Bits | Range  | Description                                      |
 * |----------|--------|------|--------|--------------------------------------------------|
 * | type     | 0      | 4    | 0-15   | Packet type (see ACTION_*)                       |
 * | eos      | 4      | 1    | 0-1    | End of stream flag                               |
 * | live     | 5      | 1    | 0-1    | Live stream indicator                            |
 * | impulse  | 6      | 1    | 0-1    | Request/response flag                            |
 * | error    | 7      | 1    | 0-1    | Error indicator                                  |
 *
 * @class Packet
 * @property {number} flags - The control flags of the packet (uint8)
 * @property {any} data - The payload data of the packet
 * @property {number} [streamId] - Unique identifier for stream packets (uint32)
 * @property {number} [streamIndex] - Chunk number for stream packets (uint32)
 */
export class Packet {
  /** Control flags of the packet (uint8) containing various metadata bits */
  public flags = 0;

  /** The actual payload data of the packet */
  public data: any;

  /** Unique identifier for stream packets (uint32) */
  public streamId?: number;

  /** Chunk number for stream packets (uint32) */
  public streamIndex?: number;

  /**
   * Creates a new Packet instance with the specified identifier.
   * The identifier is used for tracking and correlation of packets in the network.
   *
   * @param {number} id - The unique identifier for this packet (uint32)
   * @throws {Error} If the provided ID is not a valid unsigned 32-bit integer
   */
  constructor(public id: number) { }

  /**
   * Sets the packet type in the control flags while preserving all other flags.
   * The type field occupies 4 bits (0-3) in the flags byte and determines
   * the primary purpose of the packet in the protocol.
   *
   * @param {PacketType} type - The type to set in the packet flags
   * @throws {Error} If the type value exceeds the 4-bit range (0-15)
   */
  setType(type: PacketType) {
    this.flags = writeBits(clearBits(this.flags, TYPE_OFFSET, TYPE_SIZE), type, TYPE_OFFSET, TYPE_SIZE);
  }

  /**
   * Retrieves the packet type from the control flags.
   * This method extracts the 4-bit type field from the flags byte.
   *
   * @returns {PacketType} The type of the packet as specified in the flags
   */
  getType(): PacketType {
    return readBits(this.flags, TYPE_OFFSET, TYPE_SIZE) as PacketType;
  }

  /**
   * Sets the impulse flag in the control flags.
   * The impulse flag (bit 6) indicates whether this is a request (1) or response (0) packet.
   * This flag is crucial for request-response pattern implementation in the protocol.
   *
   * @param {PacketImpulse} val - The value to set for the impulse flag (0 or 1)
   * @throws {Error} If the value is not 0 or 1
   */
  setImpulse(val: PacketImpulse) {
    this.flags = (this.flags & ~(1 << IMPULSE_OFFSET)) | (val << IMPULSE_OFFSET);
  }

  /**
   * Retrieves the impulse flag from the control flags.
   *
   * @returns {PacketImpulse} The value of the impulse flag (0 or 1)
   */
  getImpulse(): PacketImpulse {
    return getBit(this.flags, IMPULSE_OFFSET) as PacketImpulse;
  }

  /**
   * Sets the error flag in the control flags.
   * The error flag (bit 7) indicates whether this packet represents an error condition.
   * When set, the packet's data typically contains error information.
   *
   * @param {0 | 1} val - The value to set for the error flag (0 or 1)
   * @throws {Error} If the value is not 0 or 1
   */
  setError(val: 0 | 1) {
    this.flags = (this.flags & ~(1 << ERROR_OFFSET)) | (val << ERROR_OFFSET);
  }

  /**
   * Retrieves the error flag from the control flags.
   *
   * @returns {number} The value of the error flag (0 or 1)
   */
  getError() {
    return getBit(this.flags, ERROR_OFFSET);
  }

  /**
   * Sets comprehensive stream information in the packet.
   * This method updates both the stream metadata fields and the corresponding control flags
   * for stream-specific attributes (end-of-stream and live stream indicators).
   *
   * @param {number} streamId - The unique identifier for the stream (uint32)
   * @param {number} streamIndex - The sequential position of this chunk in the stream (uint32)
   * @param {boolean} isLast - Indicates if this is the final chunk in the stream
   * @param {boolean} isLive - Indicates if this is a live streaming packet
   * @throws {Error} If streamId or streamIndex are not valid unsigned 32-bit integers
   */
  setStreamInfo(streamId: number, streamIndex: number, isLast: boolean, isLive: boolean) {
    this.streamId = streamId;
    this.streamIndex = streamIndex;
    this.flags = writeBits(writeBits(this.flags, isLast ? 1 : 0, EOS_OFFSET, 1), isLive ? 1 : 0, LIVE_OFFSET, 1);
  }

  /**
   * Determines if this packet is part of a stream.
   * This check is based on the packet type being set to TYPE_STREAM.
   *
   * @returns {boolean} True if the packet is a stream chunk, false otherwise
   */
  isStreamChunk(): boolean {
    return this.getType() === TYPE_STREAM;
  }

  /**
   * Checks if this packet represents the final chunk of a stream.
   * This is determined by the end-of-stream flag (bit 4) in the control flags.
   *
   * @returns {boolean} True if the packet is the last chunk of a stream, false otherwise
   */
  isLastChunk(): boolean {
    return getBit(this.flags, EOS_OFFSET) === 1;
  }

  /**
   * Determines if this packet is part of a live stream.
   * This is indicated by the live stream flag (bit 5) in the control flags.
   *
   * @returns {boolean} True if the stream is live, false otherwise
   */
  isLive(): boolean {
    return getBit(this.flags, LIVE_OFFSET) === 1;
  }

  /**
   * Generates a new unique packet identifier using the UID generator.
   * This method is used to ensure unique packet identification across the network.
   *
   * @returns {number} A new unique packet identifier (uint32)
   */
  static nextId(): number {
    return uid.next();
  }

  /**
   * Resets the packet ID generator to its initial state.
   * This method should be used with caution as it may cause ID collisions
   * if packets with old IDs are still in transit.
   */
  static resetId() {
    uid.reset();
  }
}
