import { falsely } from './primitives';
import { isArray, isObject, isString, isFunction } from './predicates';

// Define the options for the omit function
type OmitOptions = {
  deep?: boolean; // If true, omit properties deeply
  pattern?: boolean; // If true, use pattern matching
  path?: boolean; // If true, interpret strings as paths
};

// Define the type for the predicate function used in omit
type OmitPredicate = (key: string | symbol, value: any, object: any) => boolean;

// Main function to omit properties from an object
export const omit = (obj?: any, options?: any, omitOptions?: OmitOptions): Record<string | symbol, any> => {
  // Return an empty object if the input is not an object
  if (!isObject(obj)) {
    return {};
  }

  let isShouldOmit: OmitPredicate;

  // Determine the predicate function based on the type of options
  if (isFunction(options)) {
    // If options is a function, use it directly as the predicate
    isShouldOmit = (key: string | symbol, value: any, object: any) =>
      (options as (key: string | symbol, value: any, object: any) => boolean)(key, value, object);
  } else if (isArray(options)) {
    // If options is an array, create a set for quick lookup
    if (omitOptions?.path) {
      // If path option is true, handle dot notation paths
      return options.reduce(
        (acc, path) => {
          if (isString(path) && path.includes('.')) {
            return omitByPath(acc, path.split('.'));
          }
          const optionsSet = new Set([path]);
          return omit(acc, (name: string | symbol) => optionsSet.has(name));
        },
        { ...obj }
      );
    }
    const optionsSet = new Set(options);
    isShouldOmit = (name: string | symbol) => optionsSet.has(name);
  } else if (isString(options)) {
    // If options is a string, check for dot notation
    if (options.includes('.') && omitOptions?.path) {
      const paths = options.split('.');
      return omitByPath(obj, paths);
    } else {
      isShouldOmit = (val: string | symbol) => val.toString() === options;
    }
  } else if (options instanceof RegExp) {
    // If options is a RegExp, use it to test keys
    isShouldOmit = (key: string | symbol) => options.test(key.toString());
  } else if (options === true) {
    // If options is true, omit all properties
    return {};
  } else if (!options) {
    // If no options are provided, use a default predicate
    isShouldOmit = falsely;
  } else {
    // Throw an error for invalid options type
    throw new Error('Invalid options type');
  }

  // Get all property names and symbols of the object
  const list: (string | symbol)[] = [...Object.getOwnPropertyNames(obj), ...Object.getOwnPropertySymbols(obj)];

  const result: Record<string | symbol, any> = {};

  // Iterate over each property
  for (let i = 0; i < list.length; i += 1) {
    const key = list[i];
    if (key === undefined) continue; // Added to fix an error

    const val = obj[key as keyof typeof obj];

    // Check if the property should be omitted
    if (!isShouldOmit(key, val, obj)) {
      const descr = Object.getOwnPropertyDescriptor(obj, key as PropertyKey);
      if (descr) {
        // If deep option is true and the value is an object, omit deeply
        if (omitOptions?.deep && isObject(val)) {
          Object.defineProperty(result, key as PropertyKey, {
            ...descr,
            value: omit(val, options, omitOptions),
          });
        } else {
          // Otherwise, copy the property descriptor
          Object.defineProperty(result, key as PropertyKey, descr);
        }
      }
    }
  }
  return result;
};

// Helper function to handle dot notation paths
function omitByPath(obj: any, paths: string[]): any {
  if (!isObject(obj)) return obj;
  if (paths.length === 0) return obj;

  const [current, ...rest] = paths;
  const result = { ...obj };

  if (rest.length === 0) {
    // Delete the property if it's the last in the path
    delete result[current as keyof typeof result];
  } else if (isObject(obj[current as keyof typeof obj])) {
    // Recursively handle nested objects
    result[current as keyof typeof result] = omitByPath(obj[current as keyof typeof obj], rest);
  }

  return result;
}
