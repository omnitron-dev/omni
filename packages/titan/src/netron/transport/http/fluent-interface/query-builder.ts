/**
 * Query Builder — re-export shim.
 *
 * SHARED-HTTP-CORE: the implementation now lives in @omnitron-dev/netron-http-core
 * (single source of truth shared with netron-browser). Stable import path for
 * existing consumers (configurable-proxy, http interface).
 */
export { QueryBuilder } from '@omnitron-dev/netron-http-core';
export type { QueryOptions } from '@omnitron-dev/netron-http-core';
