/**
 * Unique identifier generation for Netron
 * Browser-compatible implementation using native crypto API
 */

/**
 * Uid class for generating sequential numeric IDs and random UUIDs
 *
 * @example
 * ```typescript
 * const uid = new Uid();
 * const id1 = uid.next(); // 1
 * const id2 = uid.next(); // 2
 *
 * const uuid = Uid.randomUUID(); // 'a1b2c3d4-...'
 * ```
 */
export class Uid {
  private id = 0;

  /**
   * Get the next sequential ID
   * @returns The next numeric ID
   */
  next(): number {
    return ++this.id;
  }

  /**
   * Reset the UID counter to a specific value
   * @param initialValue - The value to reset to (default: 0)
   */
  reset(initialValue: number = 0): void {
    this.id = initialValue;
  }

  /**
   * Generate a random UUID using browser's native crypto API
   * @returns A RFC4122 v4 compliant UUID string
   */
  static randomUUID(): string {
    // Browser native crypto.randomUUID()
    // Supported in all modern browsers (Chrome 92+, Firefox 95+, Safari 15.4+)
    return crypto.randomUUID();
  }
}

/**
 * Generate a random UUID
 * Convenience function for generating UUIDs
 *
 * @returns A RFC4122 v4 compliant UUID string
 */
export const randomUUID = (): string => crypto.randomUUID();

/**
 * Generate a short random ID (first segment of UUID)
 * Useful for shorter IDs when full UUID is not needed
 *
 * @returns A short random ID string (8 characters)
 */
export const generateShortId = (): string => crypto.randomUUID().split('-')[0]!;
