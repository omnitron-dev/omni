/**
 * Standard error codes — re-exported from @omnitron-dev/netron-protocol.
 *
 * SHARED-PROTO: the whole error-code module now comes from the shared
 * wire-protocol package (single source of truth with the titan server). The
 * browser previously kept its own hand-synced clone, incl. inline
 * name/message/retryable helpers — those are now the shared table-driven ones
 * (output-identical, verified). Re-exported so existing importers are unchanged.
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
