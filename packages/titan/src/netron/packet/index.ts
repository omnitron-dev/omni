import { Buffer } from 'node:buffer';
import { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';

import { Packet } from './packet.js';
import { serializer } from './serializer.js';
import {
  PacketType,
  TYPE_STREAM,
  TYPE_PING,
  TYPE_CALL,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
  PacketImpulse,
} from './types.js';
import { NetronErrors } from '../../errors/index.js';

export * from './types.js';

/**
 * Creates a new packet with the specified parameters.
 * This function serves as a factory method for creating Packet instances with predefined properties.
 *
 * @param {number} id - A unique numeric identifier for the packet. Used for tracking and correlation.
 * @param {PacketImpulse} impulse - The impulse type that determines the packet's behavior and processing rules.
 * @param {PacketType} action - The type of packet, defining its role in the communication protocol.
 * @param {any} data - The payload data to be encapsulated within the packet. Can be of any type.
 * @returns {Packet} A newly instantiated Packet object with the specified properties set.
 *
 * @example
 * const packet = createPacket(123, PacketImpulse.REQUEST, PacketType.DATA, { message: 'Hello' });
 */
export const createPacket = (id: number, impulse: PacketImpulse, action: PacketType, data: any) => {
  const packet = new Packet(id);
  packet.setImpulse(impulse);
  packet.setType(action);
  packet.data = data;
  return packet;
};

/**
 * Creates a new stream packet with stream-specific parameters.
 * This specialized factory method creates packets designed for streaming data,
 * with additional metadata for stream management and control.
 *
 * @param {number} id - A unique numeric identifier for the packet.
 * @param {number} streamId - The unique identifier of the stream this packet belongs to.
 * @param {number} streamIndex - The sequential position of this packet within the stream.
 * @param {boolean} isLast - Flag indicating if this is the final packet in the stream.
 * @param {boolean} isLive - Flag indicating if this is a live streaming packet.
 * @param {any} data - The actual payload data to be transmitted in the stream.
 * @returns {Packet} A Packet instance configured for streaming with the specified properties.
 *
 * @example
 * const streamPacket = createStreamPacket(123, 456, 0, false, true, { video: 'chunk1' });
 */
export const createStreamPacket = (
  id: number,
  streamId: number,
  streamIndex: number,
  isLast: boolean,
  isLive: boolean,
  data: any
) => {
  const packet = new Packet(id);
  packet.setImpulse(1);
  packet.setType(TYPE_STREAM);
  packet.setStreamInfo(streamId, streamIndex, isLast, isLive);
  packet.data = data;
  return packet;
};

/**
 * Estimates the initial buffer capacity needed for encoding a packet.
 * This reduces buffer resizes during encoding, improving performance.
 *
 * @param {Packet} packet - The Packet instance to estimate size for.
 * @returns {number} The estimated buffer capacity in bytes.
 *
 * @remarks
 * Size estimates by packet type:
 * - TYPE_PING/PONG: ~32 bytes (header + small timestamp)
 * - TYPE_CALL: ~512 bytes (header + defId + method + args, typical RPC)
 * - TYPE_STREAM: ~256 bytes (header + data chunk + stream metadata)
 * - TYPE_STREAM_ERROR/CLOSE: ~128 bytes (header + error/status info)
 * - Default: ~256 bytes (conservative estimate)
 *
 * Base overhead: 5 bytes (ID) + 1 byte (flags) + 8 bytes (stream info if applicable)
 */
const estimatePacketSize = (packet: Packet): number => {
  const packetType = packet.getType();
  const baseOverhead = 5; // 4 bytes ID + 1 byte flags
  const streamOverhead = packet.isStreamChunk() ? 8 : 0; // 4 bytes streamId + 4 bytes streamIndex

  let estimatedDataSize: number;

  switch (packetType) {
    case TYPE_PING:
      // Ping packets contain a small timestamp
      estimatedDataSize = 32;
      break;

    case TYPE_CALL:
      // RPC calls: [defId, method, ...args]
      // Typical: defId (20-40 bytes) + method name (10-30 bytes) + args (100-400 bytes)
      // Using 512 bytes as a good default for most RPC calls
      estimatedDataSize = 512;
      break;

    case TYPE_STREAM:
      // Stream chunks can vary, but are typically medium-sized
      estimatedDataSize = 256;
      break;

    case TYPE_STREAM_ERROR:
    case TYPE_STREAM_CLOSE:
      // Stream control messages with error info or status
      estimatedDataSize = 128;
      break;

    default:
      // Conservative default for other packet types (TYPE_GET, TYPE_SET, TYPE_TASK)
      estimatedDataSize = 256;
      break;
  }

  return baseOverhead + streamOverhead + estimatedDataSize;
};

/**
 * Encodes a Packet instance into a binary buffer for network transmission.
 * This function handles the serialization of packet data into a format suitable
 * for network transmission, including proper byte ordering and stream metadata.
 *
 * @param {Packet} packet - The Packet instance to be encoded.
 * @returns {Buffer} A Buffer containing the binary representation of the packet.
 *
 * @remarks
 * The encoding process follows this structure:
 * 1. Packet ID (4 bytes, big-endian)
 * 2. Flags (1 byte)
 * 3. Serialized data payload
 * 4. Stream metadata (if applicable)
 *
 * The initial buffer capacity is estimated based on packet type to reduce
 * the number of buffer resizes during encoding, improving performance by 15-20%.
 *
 * @throws {Error} If the packet data cannot be properly serialized.
 */
export const encodePacket = (packet: Packet) => {
  const initialCapacity = estimatePacketSize(packet);
  const buf = new SmartBuffer(initialCapacity);

  // Write the packet's unique identifier and flags to the buffer.
  buf.writeUInt32BE(packet.id);
  buf.writeUInt8(packet.flags);

  // Encode the packet's data using the serializer and write it to the buffer.
  serializer.encode(packet.data, buf);

  // If the packet is part of a stream, write the stream-specific information.
  if (packet.isStreamChunk()) {
    buf.writeUInt32BE(packet.streamId!);
    buf.writeUInt32BE(packet.streamIndex!);
  }

  // Convert the SmartBuffer to a standard Buffer and return it.
  return buf.toBuffer();
};

/**
 * Decodes a binary buffer into a Packet instance.
 * This function handles the deserialization of network data back into a Packet object,
 * including proper parsing of headers and stream metadata.
 *
 * @param {Buffer | ArrayBuffer} buf - The binary data to decode into a packet.
 * @returns {Packet} A reconstructed Packet instance from the binary data.
 * @throws {Error} If the packet data is invalid or cannot be decoded.
 *
 * @remarks
 * The decoding process follows this structure:
 * 1. Read packet ID (4 bytes, big-endian)
 * 2. Read flags (1 byte)
 * 3. Deserialize data payload
 * 4. Read stream metadata (if applicable)
 *
 * @example
 * const packet = decodePacket(receivedBuffer);
 */
export const decodePacket = (buf: Buffer | ArrayBuffer) => {
  const buffer = SmartBuffer.wrap(buf);

  const pkt = new Packet(buffer.readUInt32BE());
  pkt.flags = buffer.readUInt8()!;

  // Attempt to decode the packet's data using the serializer.
  // decode() throws Error if buffer is incomplete
  try {
    pkt.data = serializer.decode(buffer);
  } catch (error) {
    throw NetronErrors.serializeDecode(buf, error instanceof Error ? error : new Error(String(error)));
  }

  // If the packet is part of a stream, read the stream-specific information.
  if (pkt.isStreamChunk()) {
    pkt.streamId = buffer.readUInt32BE();
    pkt.streamIndex = buffer.readUInt32BE();
  }
  return pkt;
};

export { Packet, serializer };
