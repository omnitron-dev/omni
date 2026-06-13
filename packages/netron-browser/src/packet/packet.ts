/**
 * SHARED-PROTO: the `Packet` wire-frame class + `createPacket` now come from
 * @omnitron-dev/netron-protocol — the single shared implementation used by both
 * the titan server and this browser client (both encode/decode the identical
 * binary format). Re-exported here so existing `./packet.js` importers are
 * unchanged. The browser-only stream-packet factories stay local (they build
 * the shared Packet).
 */
import {
  Packet,
  createPacket,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
} from '@omnitron-dev/netron-protocol';

export { Packet, createPacket };

/** Creates a new stream error packet. */
export const createStreamErrorPacket = (id: number, streamId: number, message: string, stack?: string): Packet => {
  const packet = new Packet(id);
  packet.setImpulse(1);
  packet.setType(TYPE_STREAM_ERROR);
  packet.data = { streamId, message, stack };
  return packet;
};

/** Creates a new stream close packet. */
export const createStreamClosePacket = (id: number, streamId: number, reason?: string): Packet => {
  const packet = new Packet(id);
  packet.setImpulse(1);
  packet.setType(TYPE_STREAM_CLOSE);
  packet.data = { streamId, reason };
  return packet;
};
