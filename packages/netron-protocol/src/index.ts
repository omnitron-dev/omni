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
