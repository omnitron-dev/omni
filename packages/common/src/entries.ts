import { isNil } from './predicates';

// Cache the own property names of a plain object prototype to filter out later
const objectOwnProps = Object.getOwnPropertyNames(Object.getPrototypeOf({}));

/**
 * Retrieves the keys of an object based on the specified options.
 *
 * @param {any} obj - The object from which to retrieve keys.
 * @param {boolean} enumOnly - If true, only enumerable keys are retrieved.
 * @param {boolean} followProto - If true, keys from the prototype chain are included.
 * @returns {string[]} - An array of keys.
 */
const _keys = (obj: any, enumOnly: boolean, followProto: boolean): string[] => {
  // If not following the prototype chain, return keys based on enumOnly flag
  if (!followProto) {
    return enumOnly ? Object.keys(obj) : Object.getOwnPropertyNames(obj);
  }

  const props: string[] = []; // Array to store the keys
  const seen = new Set<string>(); // Set to track seen keys

  // Collect properties starting from the furthest prototype
  const protoChain: any[] = [];
  let current = obj;
  while (current) {
    protoChain.unshift(current); // Add current object to the beginning of the chain
    current = Object.getPrototypeOf(current); // Move up the prototype chain
  }

  // Process each object in the prototype chain
  for (const proto of protoChain) {
    const keys = enumOnly
      ? Object.keys(proto) // Get enumerable keys
      : Object.getOwnPropertyNames(proto); // Get all keys

    for (const key of keys) {
      // Add key if it hasn't been seen and isn't a default object property
      if (!seen.has(key) && !objectOwnProps.includes(key)) {
        seen.add(key);
        props.push(key);
      }
    }
  }

  return props;
};

/**
 * Retrieves the keys of an object based on the specified options.
 *
 * @param {any} obj - The object from which to retrieve keys.
 * @param {Object} options - Options to modify behavior.
 * @param {boolean} [options.enumOnly=true] - If true, only enumerable keys are retrieved.
 * @param {boolean} [options.followProto=false] - If true, keys from the prototype chain are included.
 * @param {boolean} [options.all=false] - If true, overrides other options to include all keys.
 * @returns {string[]} - An array of keys.
 */
export const keys = (obj: any, { enumOnly = true, followProto = false, all = false } = {}): string[] => {
  // Return empty array if object is null or undefined
  if (isNil(obj)) {
    return [];
  }

  // If 'all' option is true, set flags to include all keys
  if (all) {
    enumOnly = false;
    followProto = true;
  }

  return _keys(obj, enumOnly, followProto);
};

/**
 * Retrieves the values of an object based on the specified options.
 *
 * @param {any} obj - The object from which to retrieve values.
 * @param {Object} options - Options to modify behavior.
 * @param {boolean} [options.enumOnly=true] - If true, only values of enumerable keys are retrieved.
 * @param {boolean} [options.followProto=false] - If true, values from the prototype chain are included.
 * @param {boolean} [options.all=false] - If true, overrides other options to include all values.
 * @returns {any[]} - An array of values.
 */
export const values = (obj: any, { enumOnly = true, followProto = false, all = false } = {}): any[] => {
  // Return empty array if object is null or undefined
  if (isNil(obj)) {
    return [];
  }

  // If 'all' option is true, set flags to include all values
  if (all) {
    enumOnly = false;
    followProto = true;
  }

  // If not following prototype and only enumerable, use Object.values
  if (!followProto && enumOnly) {
    return Object.values(obj);
  }

  // Map keys to their corresponding values
  return _keys(obj, enumOnly, followProto).map((key) => obj[key]);
};

/**
 * Retrieves the entries of an object based on the specified options.
 *
 * @param {any} obj - The object from which to retrieve entries.
 * @param {Object} options - Options to modify behavior.
 * @param {boolean} [options.enumOnly=true] - If true, only entries of enumerable keys are retrieved.
 * @param {boolean} [options.followProto=false] - If true, entries from the prototype chain are included.
 * @param {boolean} [options.all=false] - If true, overrides other options to include all entries.
 * @returns {Array<[string, any]>} - An array of key-value pairs.
 */
export const entries = (obj: any, { enumOnly = true, followProto = false, all = false } = {}): Array<[string, any]> => {
  // Return empty array if object is null or undefined
  if (isNil(obj)) {
    return [];
  }

  // If 'all' option is true, set flags to include all entries
  if (all) {
    enumOnly = false;
    followProto = true;
  }

  // Map keys to key-value pairs
  return _keys(obj, enumOnly, followProto).map((key) => [key, obj[key]]);
};
