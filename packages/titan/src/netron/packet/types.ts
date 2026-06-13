/**
 * SHARED-PROTO: the packet wire types (PacketImpulse, TYPE_* opcodes,
 * PacketType, StreamType) now live in @omnitron-dev/netron-protocol — the single
 * source of truth shared with the other end of the connection. Re-exported here
 * so every `./types.js` importer (packet, serializer, peers, streams) is
 * unchanged.
 */
export {
  TYPE_PING,
  TYPE_GET,
  TYPE_SET,
  TYPE_CALL,
  TYPE_TASK,
  TYPE_STREAM,
  TYPE_STREAM_ERROR,
  TYPE_STREAM_CLOSE,
  StreamType,
} from '@omnitron-dev/netron-protocol';
export type { PacketImpulse, PacketType } from '@omnitron-dev/netron-protocol';
