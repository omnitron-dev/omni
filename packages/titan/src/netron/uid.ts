/**
 * SHARED-PROTO: the UID generator now lives in the dependency-free
 * `@omnitron-dev/netron-protocol` package so the server (titan) and the browser
 * client (netron-browser) share ONE implementation of the on-the-wire UID
 * contract instead of two separately-maintained copies.
 *
 * Re-exported here so titan's internal `./uid.js` importers (definition,
 * netron, packet, writable-stream, the netron barrel) keep working unchanged.
 */
export { Uid } from '@omnitron-dev/netron-protocol';
