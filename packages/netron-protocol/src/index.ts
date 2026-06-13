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

// Service-definition shape types + the Definition class.
export type {
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
  ServiceContract,
  ServiceMetadataWithContract,
} from './definition-types.js';
export { Definition } from './definition.js';
export { Reference } from './reference.js';

// Wire error taxonomy: the HTTP-semantic ErrorCode enum, ErrorCategory, and the
// range classifiers. The metadata table / name+message helpers stay per-package
// (titan's table-driven version vs the browser's; not part of the wire shape).
export {
  ErrorCode,
  ErrorCategory,
  getErrorCategory,
  isClientError,
  isServerError,
  toHttpStatus,
  ERROR_METADATA,
  isRetryableError,
  getErrorName,
  getDefaultMessage,
} from './error-codes.js';
export type { ErrorMetadata } from './error-codes.js';

// The TitanError class hierarchy + helpers (shared so an error constructed or
// serialized on one end is the same class on the other).
export {
  TitanError,
  AggregateError,
  ErrorPool,
  createError,
  isErrorCode,
  ensureError,
} from './error.js';
export type {
  ErrorContext,
  ErrorOptions,
  RetryStrategy,
  MetricsOptions,
  SerializedError,
} from './error.js';

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

// The Packet class (binary wire frame) + its convenience constructor. The
// per-package serializers (which bind env-specific StreamReference codecs)
// operate on this shared class.
export { Packet, createPacket } from './packet.js';
