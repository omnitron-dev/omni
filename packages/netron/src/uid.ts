import { MAX_UID_VALUE } from './constants';

/**
 * Class for generating unique packet identifiers.
 */
export class Uid {
  private value: number = 0 >>> 0;

  constructor(initialValue: number = 0) {
    this.reset(initialValue);
  }

  /**
   * Creates a new unique identifier.
   * @returns {number} A new unique identifier.
   */
  next(): number {
    this.value = this.value === MAX_UID_VALUE ? 1 : this.value + 1;
    return this.value;
  }

  /**
   * Resets the identifier to the initial value.
   * @param {number} initialValue - The initial value to reset to.
   */
  reset(initialValue: number = 0) {
    this.value = initialValue >>> 0;
  }
}
