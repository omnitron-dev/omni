import { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';
import { Buffer } from 'buffer';

import { Packet } from './packet.js';
import { serializer } from './serializer.js';
import { TYPE_PING, TYPE_CALL, TYPE_STREAM, TYPE_STREAM_ERROR, TYPE_STREAM_CLOSE } from './types.js';
import { SerializationError } from '../errors/index.js';

export * from './types.js';
export * from './packet.js';
export * from './serializer.js';

/**
 * Creates a new stream packet with stream-specific parameters.
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
 * Estimates the buffer size needed for encoding a packet.
 * This function provides a reasonable estimate to minimize buffer reallocations
 * during the encoding process, improving performance.
 *
 * @param {Packet} packet - The Packet instance to estimate size for.
 * @returns {number} The estimated buffer size in bytes.
 *
 * @remarks
 * The estimation includes:
 * - Base overhead: 5 bytes (4 bytes ID + 1 byte flags)
 * - Stream overhead: 8 bytes (4 bytes streamId + 4 bytes streamIndex) if stream packet
 * - Data size estimation based on packet type
 */
const estimatePacketSize = (packet: Packet): number => {
  const baseOverhead = 5; // 4 bytes ID + 1 byte flags
  const streamOverhead = packet.isStreamChunk() ? 8 : 0;

  const packetType = packet.getType();
  let estimatedDataSize: number;

  switch (packetType) {
    case TYPE_PING:
      estimatedDataSize = 32;
      break;
    case TYPE_CALL:
      estimatedDataSize = 512;
      break;
    case TYPE_STREAM:
      estimatedDataSize = 256;
      break;
    case TYPE_STREAM_ERROR:
    case TYPE_STREAM_CLOSE:
      estimatedDataSize = 128;
      break;
    default:
      estimatedDataSize = 256;
  }

  return baseOverhead + streamOverhead + estimatedDataSize;
};

/**
 * Encodes a Packet instance into a binary buffer for network transmission.
 * This function handles the serialization of packet data into a format suitable
 * for network transmission, including proper byte ordering and stream metadata.
 *
 * @param {Packet} packet - The Packet instance to be encoded.
 * @returns {Uint8Array} A Uint8Array containing the binary representation of the packet.
 *
 * @remarks
 * The encoding process follows this structure:
 * 1. Packet ID (4 bytes, big-endian)
 * 2. Flags (1 byte)
 * 3. Serialized data payload
 * 4. Stream metadata (if applicable)
 *
 * @throws {SerializationError} If the packet data cannot be properly serialized.
 */
export const encodePacket = (packet: Packet): Uint8Array => {
  const buf = new SmartBuffer(estimatePacketSize(packet));

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

  // Convert the SmartBuffer to a Uint8Array and return it.
  return buf.toBuffer();
};

/**
 * Decodes a binary buffer into a Packet instance.
 * This function handles the deserialization of network data back into a Packet object,
 * including proper parsing of headers and stream metadata with comprehensive validation.
 *
 * @param {Uint8Array | ArrayBuffer} buf - The binary data to decode into a packet.
 * @returns {Packet} A reconstructed Packet instance from the binary data.
 * @throws {SerializationError} If the packet data is invalid or cannot be decoded.
 *
 * @remarks
 * The decoding process follows this structure:
 * 1. Validate minimum packet size (5 bytes)
 * 2. Read packet ID (4 bytes, big-endian)
 * 3. Read flags (1 byte)
 * 4. Validate packet type (0x00-0x07)
 * 5. Deserialize data payload
 * 6. Validate and read stream metadata (if applicable)
 *
 * @example
 * const packet = decodePacket(receivedBuffer);
 */
export const decodePacket = (buf: Uint8Array | ArrayBuffer): Packet => {
  // Convert to Buffer for SmartBuffer.wrap
  const bufferInput = buf instanceof Uint8Array ? Buffer.from(buf) : buf;

  // Validate minimum packet size (4 bytes ID + 1 byte flags)
  const MIN_PACKET_SIZE = 5;
  if (bufferInput.byteLength < MIN_PACKET_SIZE) {
    throw SerializationError.decode(
      buf,
      new Error(`Packet too small: ${bufferInput.byteLength} bytes, minimum ${MIN_PACKET_SIZE} bytes required`)
    );
  }

  const buffer = SmartBuffer.wrap(bufferInput);

  const pkt = new Packet(buffer.readUInt32BE());
  pkt.flags = buffer.readUInt8()!;

  // Validate packet type (0x00-0x07)
  const packetType = pkt.getType();
  if (packetType < 0x00 || packetType > 0x07) {
    throw SerializationError.decode(
      buf,
      new Error(`Invalid packet type: 0x${packetType.toString(16)}. Expected 0x00-0x07`)
    );
  }

  // Attempt to decode the packet's data using the serializer.
  // decode() throws Error if buffer is incomplete
  try {
    pkt.data = serializer.decode(buffer);
  } catch (error) {
    throw SerializationError.decode(buf, error instanceof Error ? error : undefined);
  }

  // If the packet is part of a stream, validate and read the stream-specific information.
  if (pkt.isStreamChunk()) {
    const remainingBytes = buffer.length; // remaining unread bytes
    const STREAM_METADATA_SIZE = 8; // 4 bytes streamId + 4 bytes streamIndex

    if (remainingBytes < STREAM_METADATA_SIZE) {
      throw SerializationError.decode(
        buf,
        new Error(
          `Incomplete stream metadata: ${remainingBytes} bytes remaining, ${STREAM_METADATA_SIZE} bytes required`
        )
      );
    }

    pkt.streamId = buffer.readUInt32BE();
    pkt.streamIndex = buffer.readUInt32BE();
  }

  return pkt;
};
