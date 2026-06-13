/**
 * SHARED-PROTO: the `Definition` class now lives in
 * @omnitron-dev/netron-protocol — shared with netron-browser so both ends
 * marshal the same service-definition shape. Re-exported here so titan's
 * `./definition.js` importers (netron, peers, service-stub, streams, the
 * netron barrel) are unchanged.
 */
export { Definition } from '@omnitron-dev/netron-protocol';
