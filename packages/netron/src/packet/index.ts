import { Buffer } from 'buffer';
import { SmartBuffer } from '@devgrid/smartbuffer';

import { Packet } from './packet';
import { serializer } from './serializer';
import { PacketType, TYPE_STREAM, PacketImpulse } from './types';

export * from './types';

/**
 * Creates a new packet with the specified parameters.
 *
 * @param id - The unique identifier for the packet.
 * @param impulse - The impulse type of the packet, indicating its purpose or action.
 * @param action - The type of packet, defining its role in communication.
 * @param data - The payload or content of the packet.
 * @returns A new Packet instance with the specified properties.
 */
export const createPacket = (id: number, impulse: PacketImpulse, action: PacketType, data: any) => {
  const packet = new Packet(id);
  packet.setImpulse(impulse);
  packet.setType(action);
  packet.data = data;
  return packet;
};

/**
 * Creates a new stream packet with the specified parameters.
 *
 * @param id - The unique identifier for the packet.
 * @param streamId - The identifier for the stream to which this packet belongs.
 * @param streamIndex - The index of the packet within the stream.
 * @param isLast - Indicates if this is the last packet in the stream.
 * @param isLive - Indicates if the stream is live.
 * @param data - The payload or content of the packet.
 * @returns A new Packet instance configured as a stream packet.
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
  packet.setType(TYPE_STREAM);
  packet.setStreamInfo(streamId, streamIndex, isLast, isLive);
  packet.data = data;
  return packet;
};

/**
 * Encodes a packet into a buffer for transmission.
 *
 * @param packet - The Packet instance to be encoded.
 * @returns A Buffer containing the encoded packet data.
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
 * Decodes a buffer into a packet.
 *
 * @param buf - The Buffer or ArrayBuffer containing the encoded packet data.
 * @returns A Packet instance reconstructed from the buffer data.
 * @throws An error if the packet data is invalid or cannot be decoded.
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
