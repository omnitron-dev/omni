/**
 * Core error classes — re-exported from @omnitron-dev/netron-protocol.
 *
 * SHARED-PROTO: the TitanError hierarchy now comes from the shared wire-protocol
 * package (single class shared with the titan server). The browser previously
 * carried a slimmer hand-synced clone; it now inherits the full class (incl.
 * fromJSON for wire-deserialization, which it already used). Re-exported so
 * existing `errors/core.js` importers are unchanged.
 */
export {
  TitanError,
  AggregateError,
  ErrorPool,
  createError,
  isErrorCode,
  ensureError,
} from '@omnitron-dev/netron-protocol';
export type {
  ErrorContext,
  ErrorOptions,
  RetryStrategy,
  MetricsOptions,
  SerializedError,
} from '@omnitron-dev/netron-protocol';
