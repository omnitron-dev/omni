/**
 * Object Utilities
 *
 * Type-safe object manipulation helpers.
 *
 * @module @omnitron/prism/utils
 */

/**
 * Check if an object has specific keys.
 *
 * @template T - Object type
 * @template K - Key type
 * @param {T | null | undefined} obj - Object to check
 * @param {K[]} keys - Keys to check for
 * @returns {boolean} True if object has all specified keys
 *
 * @example
 * ```ts
 * const user = { name: 'John', email: 'john@example.com' };
 * hasKeys(user, ['name', 'email']); // true
 * hasKeys(user, ['name', 'age']);   // false
 * hasKeys(null, ['name']);          // false
 * hasKeys(user, []);                // false
 * ```
 */
export function hasKeys<T extends object, K extends keyof T>(obj: T | null | undefined, keys: K[]): boolean {
  if (!obj || !keys.length || typeof obj !== 'object') {
    return false;
  }

  return keys.every((key) => key in obj);
}

/**
 * Omit specific keys from an object.
 *
 * @template T - Object type
 * @template K - Keys to omit
 * @param {T} obj - Source object
 * @param {K[]} keys - Keys to omit
 * @returns {Omit<T, K>} New object without specified keys
 *
 * @example
 * ```ts
 * const user = { name: 'John', email: 'john@example.com', password: '...' };
 * omit(user, ['password']); // { name: 'John', email: 'john@example.com' }
 * ```
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result as Omit<T, K>;
}

/**
 * Pick specific keys from an object.
 *
 * @template T - Object type
 * @template K - Keys to pick
 * @param {T} obj - Source object
 * @param {K[]} keys - Keys to pick
 * @returns {Pick<T, K>} New object with only specified keys
 *
 * @example
 * ```ts
 * const user = { name: 'John', email: 'john@example.com', password: '...' };
 * pick(user, ['name', 'email']); // { name: 'John', email: 'john@example.com' }
 * ```
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key];
    }
  }
  return result;
}

/**
 * Deep clone an object.
 *
 * @template T - Object type
 * @param {T} obj - Object to clone
 * @returns {T} Deep cloned object
 *
 * @example
 * ```ts
 * const original = { a: 1, b: { c: 2 } };
 * const cloned = deepClone(original);
 * cloned.b.c = 3; // original.b.c is still 2
 * ```
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as unknown as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

/**
 * Check if a value is empty (null, undefined, empty string, empty array, empty object).
 *
 * @param {unknown} value - Value to check
 * @returns {boolean} True if empty
 *
 * @example
 * ```ts
 * isEmpty(null);      // true
 * isEmpty('');        // true
 * isEmpty([]);        // true
 * isEmpty({});        // true
 * isEmpty('hello');   // false
 * isEmpty([1]);       // false
 * ```
 */
export function isEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }

  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value as object).length === 0;
  }

  return false;
}
