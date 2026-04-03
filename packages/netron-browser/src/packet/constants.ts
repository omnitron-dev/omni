/**
 * The maximum value that can be used for unique identifiers (UIDs) in the Netron system.
 * This value is derived from Number.MAX_SAFE_INTEGER with an unsigned right shift operation
 * to ensure it's a valid 32-bit unsigned integer. This is crucial for maintaining
 * compatibility with network protocols and binary operations.
 *
 * @constant {number} MAX_UID_VALUE
 * @see Number.MAX_SAFE_INTEGER
 */
export const MAX_UID_VALUE = Number.MAX_SAFE_INTEGER >>> 0;
