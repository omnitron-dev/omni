/**
 * Browser-compatible UUID generation
 * Replaces node:crypto with Web Crypto API
 */

/**
 * Generates a cryptographically secure UUID v4.
 * Uses the Web Crypto API which is available in all modern browsers.
 *
 * @returns {string} A UUID v4 string
 */
export function uuid(): string {
  // Modern browsers support crypto.randomUUID
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older browsers using crypto.getRandomValues
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    // RFC 4122 version 4 UUID
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version (4) and variant bits
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // Variant 10

    // Convert to hex string with dashes
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Final fallback for very old environments (not cryptographically secure)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
