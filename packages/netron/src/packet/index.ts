import { Buffer } from 'buffer';
import { SmartBuffer } from '@omnitron-dev/smartbuffer';

import { Packet } from './packet';
import { serializer } from './serializer';
import { PacketType, TYPE_STREAM, PacketImpulse } from './types';

export * from './types';

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
 * @throws {Error} If the packet data cannot be properly serialized.
 */
export const encodePacket = (packet: Packet) => {
  const buf = new SmartBuffer(SmartBuffer.DEFAULT_CAPACITY, true);

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
  const result = serializer.decoder.tryDecode(buffer);
  if (!result) {
    throw new Error('Invalid packet');
  }
  pkt.data = result.value;

  // If the packet is part of a stream, read the stream-specific information.
  if (pkt.isStreamChunk()) {
    pkt.streamId = buffer.readUInt32BE();
    pkt.streamIndex = buffer.readUInt32BE();
  }
  return pkt;
};

export { Packet, serializer };
