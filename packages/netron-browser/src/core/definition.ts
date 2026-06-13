/**
 * SHARED-PROTO: the `Definition` class now lives in
 * @omnitron-dev/netron-protocol — shared with the titan server so both ends
 * marshal the same service-definition shape. Re-exported here so existing
 * `core/definition.js` importers are unchanged.
 */
export { Definition } from '@omnitron-dev/netron-protocol';
