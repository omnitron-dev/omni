/**
 * SHARED-PROTO: the UUIDv7 generator now lives in @omnitron-dev/netron-protocol
 * (shared with the titan server). Re-exported here so the public barrel export
 * (`export { uuid } from './utils/uuid.js'`) and internal importers are
 * unchanged. The shared implementation IS this generator (Web Crypto-based v7).
 */
export { uuid } from '@omnitron-dev/netron-protocol';
