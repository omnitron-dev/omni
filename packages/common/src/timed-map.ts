/**
 * Represents a map that stores keys only for a specified time interval.
 */
export class TimedMap<K, V> {
  // Maximum lifespan of keys in milliseconds
  public timeout: number;
  // Callback function invoked for each key after its time expires
  private timeoutCallback: (key: K) => void;
  // Internal storage where each key is associated with a value and a timer
  private map = new Map<K, { value: V; timer: ReturnType<typeof setTimeout> }>();

  /**
   * Constructor for the TimedMap class.
   * @param {number} [timeoutMs=1000] - Maximum lifespan of keys in milliseconds, default is 1000.
   * @param {Function} [callback] - Callback function invoked for each key after its time expires.
   */
  constructor(timeoutMs?: number, callback?: (key: K) => void) {
    this.timeout = timeoutMs ?? 1000; // Set the lifespan of keys
    this.timeoutCallback = callback ?? ((key: K) => this.map.delete(key)); // Set the callback function
  }

  /**
   * Sets a value for the specified key with an optional timeout and callback function.
   * @param {K} key - The key for which the value is set.
   * @param {V} value - The value to be set.
   * @param {Function} [callback] - Callback function invoked after the time expires.
   * @param {number} [timeout] - Time in milliseconds after which the callback function will be invoked.
   */
  set(key: K, value: V, callback?: (key: K) => void, timeout?: number) {
    this.clearTimeout(key); // Clear existing timer for the key
    const timer = setTimeout(
      callback ? callback : this.timeoutCallback,
      Number.isInteger(timeout) ? timeout : this.timeout,
      key
    );
    this.map.set(key, { value, timer }); // Set the new value and timer
  }

  /**
   * Returns the value associated with the specified key.
   * @param {K} key - The key for which the value is to be retrieved.
   * @returns {V | undefined} - The value associated with the key, or undefined if the key is not found.
   */
  get(key: K): V | undefined {
    return this.map.get(key)?.value;
  }

  /**
   * Executes the specified function for each element in the map.
   * @param {Function} callback - Function invoked for each element.
   * @param {any} thisArg - Value used as this when executing the callback function.
   */
  forEach(callback: (value: V, key: K, map: TimedMap<K, V>) => void, thisArg: any) {
    this.map.forEach((obj, key) => {
      callback.call(thisArg, obj.value, key, this);
    });
  }

  /**
   * Returns an iterator for the [key, value] pairs in the map.
   * @returns {IterableIterator<[K, V]>} - Iterator for the [key, value] pairs.
   */
  *entries() {
    for (const [key, obj] of this.map.entries()) {
      yield [key, obj.value];
    }
  }

  /**
   * Returns an iterator for the values in the map.
   * @returns {IterableIterator<V>} - Iterator for the values.
   */
  *values() {
    for (const obj of this.map.values()) {
      yield obj.value;
    }
  }

  /**
   * Removes the element with the specified key from the map.
   * @param {K} key - The key of the element to be removed.
   * @returns {boolean} - true if the element was successfully removed, otherwise false.
   */
  delete(key: K) {
    this.clearTimeout(key); // Clear the timer for the key being removed
    return this.map.delete(key);
  }

  /**
   * Clears the map, removing all elements and clearing all timers.
   */
  clear() {
    this.map.forEach((obj) => {
      clearTimeout(obj.timer as any); // Clear each timer
    });
    this.map.clear(); // Clear the map
  }

  /**
   * Clears the timer for the specified key, if it exists.
   * @param {K} key - The key for which the timer is to be cleared.
   */
  private clearTimeout(key: K) {
    if (this.map.has(key)) {
      clearTimeout(this.map.get(key)!.timer as any); // Clear the timer
    }
  }
}
