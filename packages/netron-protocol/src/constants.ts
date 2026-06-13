/**
 * Shared Netron wire-protocol constants.
 *
 * Single source of truth for values that MUST agree byte-for-byte between the
 * server (@omnitron-dev/titan) and the browser client
 * (@omnitron-dev/netron-browser). Previously each package declared its own copy
 * (with identical values but separate maintenance), inviting silent drift.
 */

/**
 * The maximum value usable for a unique identifier (UID).
 *
 * `Number.MAX_SAFE_INTEGER >>> 0` coerces to a 32-bit unsigned integer, which
 * is what the UID counter and the binary packet header operate on. Both ends of
 * a connection must agree on this bound for UID wrap-around to line up.
 */
export const MAX_UID_VALUE = Number.MAX_SAFE_INTEGER >>> 0;
