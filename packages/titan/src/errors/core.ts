/**
 * Core error classes — re-exported from @omnitron-dev/netron-protocol.
 *
 * SHARED-PROTO: the entire TitanError hierarchy (TitanError + AggregateError +
 * ErrorPool + the stats/cache/pool/metrics machinery + helpers) now lives in the
 * shared wire-protocol package, so the server and the browser client use ONE
 * class — an error constructed or serialized on one end IS the same class on the
 * other. titan's public `@omnitron-dev/titan/errors` surface is preserved here
 * by re-export.
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
