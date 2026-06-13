/**
 * @omnitron-dev/netron-protocol
 *
 * Dependency-free Netron wire-protocol primitives shared by the server
 * (@omnitron-dev/titan) and the browser client (@omnitron-dev/netron-browser).
 * Both import from here so the on-the-wire contract has a single source of
 * truth and cannot silently drift between the two implementations.
 *
 * Scope grows incrementally (SHARED-PROTO): UID + wire constants first; packet
 * types/codec, serializer, definitions and shared error codes follow.
 */

export { MAX_UID_VALUE } from './constants.js';
export { Uid } from './uid.js';
export { uuid } from './uuid.js';

// Packet wire types: impulse, type codes (TYPE_*), the PacketType union, and
// the StreamType enum. These define the binary protocol's opcode space and must
// be identical on both ends.
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
} from './packet-types.js';
export type { PacketImpulse, PacketType } from './packet-types.js';
