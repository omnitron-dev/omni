/**
 * SHARED-PROTO: the UID generator now lives in @omnitron-dev/netron-protocol,
 * shared with the titan server so both ends use ONE implementation. Re-exported
 * here so existing `./uid.js` importers (packet, writable-stream) are unchanged.
 */
export { Uid } from '@omnitron-dev/netron-protocol';
