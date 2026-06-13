/**
 * SHARED-PROTO: the `Reference` class now lives in
 * @omnitron-dev/netron-protocol — shared with netron-browser. Re-exported here
 * so titan's `./reference.js` importers are unchanged (and `instanceof Reference`
 * checks still resolve to the one shared class).
 */
export { Reference } from '@omnitron-dev/netron-protocol';
