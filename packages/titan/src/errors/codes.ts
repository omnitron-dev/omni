/**
 * Standard error codes — re-exported from @omnitron-dev/netron-protocol.
 *
 * SHARED-PROTO: the ENTIRE error-code module — the ErrorCode / ErrorCategory
 * enums, the range classifiers, the ERROR_METADATA table, and the table-driven
 * name / message / retryable / HTTP-status helpers — now lives in the shared
 * wire-protocol package so the server and the browser client cannot drift.
 * Re-exported here unchanged so titan's public `@omnitron-dev/titan/errors`
 * surface is preserved.
 */

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
} from '@omnitron-dev/netron-protocol';
export type { ErrorMetadata } from '@omnitron-dev/netron-protocol';
