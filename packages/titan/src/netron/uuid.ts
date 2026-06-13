/**
 * SHARED-PROTO: the service-Definition UUIDv7 generator now lives in
 * @omnitron-dev/netron-protocol (shared with netron-browser; uses the Web Crypto
 * API, available in Node ≥18 and browsers). Re-exported here so titan's
 * `./uuid.js` importer (definition) is unchanged.
 *
 * (titan's own `utils/id.generateUuidV7` — the pooled node:crypto variant of the
 * SAME v7 algorithm — remains for non-netron callers; only the netron Definition
 * id path moves to the shared generator. Definition ids are opaque, so this has
 * no wire-format impact.)
 */
export { uuid } from '@omnitron-dev/netron-protocol';
