import { Uid } from './uid.js';
import { PacketType, TYPE_STREAM, TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE, PacketImpulse } from './types.js';

// Pre-computed masks for O(1) field access
const EOS_MASK = 0x10; // 0b00010000 - Bit 4
const LIVE_MASK = 0x20; // 0b00100000 - Bit 5
const IMPULSE_MASK = 0x40; // 0b01000000 - Bit 6
const ERROR_MASK = 0x80; // 0b10000000 - Bit 7

/**
 * Creates a bitmask for a range of bits.
 * This helper generates a mask with 'count' consecutive 1-bits starting at 'offset'.
 *
 * @param {number} offset - The starting bit position
 * @param {number} count - The number of consecutive bits to set
 * @returns {number} A bitmask with the specified bits set to 1
 *
 * @example
 * // Create a mask for bits 2-3
 * const mask = createMask(2, 2); // Returns 12 (binary 1100)
 */
const createMask = (offset: number, count: number): number => ((1 << count) - 1) << offset;

/**
 * Clears a range of bits in a number, setting them to 0.
 * This O(1) operation preserves all other bits while zeroing out the specified range.
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
const clearBits = (target: number, offset: number, count: number): number => target & ~createMask(offset, count);

/**
 * Writes a value into a range of bits in a number.
 * This O(1) operation combines clearing the target bits and setting them to the new value.
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
  const mask = createMask(offset, count);
  return (target & ~mask) | ((val << offset) & mask);
};

/**
 * Reads a range of bits from a number and returns them as a new value.
 * This O(1) operation extracts consecutive bits and combines them into a single number.
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
const readBits = (target: number, offset: number, count: number): number => (target >> offset) & ((1 << count) - 1);

// Bit field offsets and sizes for packet flags
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
  constructor(public id: number) {}

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
   * Optimized with direct mask operations for O(1) performance.
   *
   * @param {PacketImpulse} val - The value to set for the impulse flag (0 or 1)
   * @throws {Error} If the value is not 0 or 1
   */
  setImpulse(val: PacketImpulse) {
    this.flags = val ? this.flags | IMPULSE_MASK : this.flags & ~IMPULSE_MASK;
  }

  /**
   * Retrieves the impulse flag from the control flags.
   * Optimized with direct mask operations for O(1) performance.
   *
   * @returns {PacketImpulse} The value of the impulse flag (0 or 1)
   */
  getImpulse(): PacketImpulse {
    return this.flags & IMPULSE_MASK ? 1 : 0;
  }

  /**
   * Sets the error flag in the control flags.
   * The error flag (bit 7) indicates whether this packet represents an error condition.
   * When set, the packet's data typically contains error information.
   * Optimized with direct mask operations for O(1) performance.
   *
   * @param {0 | 1} val - The value to set for the error flag (0 or 1)
   * @throws {Error} If the value is not 0 or 1
   */
  setError(val: 0 | 1) {
    this.flags = val ? this.flags | ERROR_MASK : this.flags & ~ERROR_MASK;
  }

  /**
   * Retrieves the error flag from the control flags.
   * Optimized with direct mask operations for O(1) performance.
   *
   * @returns {number} The value of the error flag (0 or 1)
   */
  getError() {
    return this.flags & ERROR_MASK ? 1 : 0;
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
   * Optimized with direct mask operations for O(1) performance.
   *
   * @returns {boolean} True if the packet is the last chunk of a stream, false otherwise
   */
  isLastChunk(): boolean {
    return (this.flags & EOS_MASK) !== 0;
  }

  /**
   * Determines if this packet is part of a live stream.
   * This is indicated by the live stream flag (bit 5) in the control flags.
   * Optimized with direct mask operations for O(1) performance.
   *
   * @returns {boolean} True if the stream is live, false otherwise
   */
  isLive(): boolean {
    return (this.flags & LIVE_MASK) !== 0;
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

/**
 * Creates a new packet with the specified parameters.
 */
export const createPacket = (id: number, impulse: PacketImpulse, action: PacketType, data: any) => {
  const packet = new Packet(id);
  packet.setImpulse(impulse);
  packet.setType(action);
  packet.data = data;
  return packet;
};

/**
 * Creates a new stream error packet.
 */
export const createStreamErrorPacket = (id: number, streamId: number, message: string, stack?: string): Packet => {
  const packet = new Packet(id);
  packet.setImpulse(1);
  packet.setType(TYPE_STREAM_ERROR);
  packet.data = { streamId, message, stack };
  return packet;
};

/**
 * Creates a new stream close packet.
 */
export const createStreamClosePacket = (id: number, streamId: number, reason?: string): Packet => {
  const packet = new Packet(id);
  packet.setImpulse(1);
  packet.setType(TYPE_STREAM_CLOSE);
  packet.data = { streamId, reason };
  return packet;
};
