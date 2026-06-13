/**
 * SHARED-PROTO: the `Packet` wire-frame class now lives in
 * @omnitron-dev/netron-protocol (shared with netron-browser — both encode/decode
 * the same binary format; the per-package serializers, which bind env-specific
 * StreamReference codecs, operate on this one class). Re-exported so titan's
 * `./packet.js` importers (the serializer, index barrel, transport types) are
 * unchanged.
 */
export { Packet } from '@omnitron-dev/netron-protocol';
