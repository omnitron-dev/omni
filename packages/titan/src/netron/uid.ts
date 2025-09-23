import { MAX_UID_VALUE } from './constants.js';

/**
 * A class that provides functionality for generating and managing unique identifiers (UIDs)
 * within the Netron system. This implementation ensures thread-safe and sequential
 * generation of unique identifiers while maintaining a strict upper bound.
 *
 * @class Uid
 * @description Core identifier generation system for packet tracking and correlation
 * @property {number} value - Current UID value, stored as an unsigned 32-bit integer
 */
export class Uid {
  /**
   * Current UID value, stored as an unsigned 32-bit integer.
   * The value is initialized using a zero-fill right shift to ensure proper
   * unsigned integer representation.
   *
   * @private
   * @type {number}
   */
  private value: number = 0 >>> 0;

  /**
   * Creates a new Uid instance with an optional initial value.
   * The constructor ensures proper initialization by calling reset() with
   * the provided initial value.
   *
   * @constructor
   * @param {number} [initialValue=0] - The starting value for UID generation
   */
  constructor(initialValue: number = 0) {
    this.reset(initialValue);
  }

  /**
   * Generates the next unique identifier in sequence.
   * This method implements a circular counter that wraps around to 1 when
   * reaching MAX_UID_VALUE, ensuring continuous unique identifier generation
   * within the defined bounds.
   *
   * @method next
   * @returns {number} The next unique identifier in sequence
   * @throws {Error} If the maximum UID value is exceeded
   */
  next(): number {
    this.value = this.value === MAX_UID_VALUE ? 1 : this.value + 1;
    return this.value;
  }

  /**
   * Resets the UID generator to a specified initial value.
   * The value is converted to an unsigned 32-bit integer using a zero-fill
   * right shift operation to ensure proper numeric representation.
   *
   * @method reset
   * @param {number} [initialValue=0] - The value to reset the generator to
   * @throws {Error} If the initial value exceeds MAX_UID_VALUE
   */
  reset(initialValue: number = 0) {
    this.value = initialValue >>> 0;
  }
}
