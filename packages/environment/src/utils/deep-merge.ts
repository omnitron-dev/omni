import { DEFAULT_MERGE_STRATEGY, MergeStrategy } from '../types/operations.js';

/**
 * Deep merge two objects
 */
export function deepMerge(target: any, source: any, strategy: MergeStrategy = {}): any {
  const opts = { ...DEFAULT_MERGE_STRATEGY, ...strategy };

  // Handle primitives
  if (source === null || source === undefined) {
    return target;
  }
  if (target === null || target === undefined) {
    return source;
  }

  // If types don't match, return based on conflict strategy
  if (typeof target !== typeof source) {
    return opts.conflicts === 'prefer-left' ? target : source;
  }

  // Handle arrays
  if (Array.isArray(target) && Array.isArray(source)) {
    if (opts.arrays === 'concat') {
      return [...target, ...source];
    }
    return source; // replace
  }

  // Handle objects
  if (isPlainObject(target) && isPlainObject(source)) {
    const result: any = { ...target };

    for (const key of Object.keys(source)) {
      if (key in result) {
        // Use custom resolver if provided
        if (opts.resolver) {
          result[key] = opts.resolver(key, result[key], source[key]);
        } else if (opts.strategy === 'deep') {
          result[key] = deepMerge(result[key], source[key], strategy);
        } else {
          // Shallow merge - prefer right
          result[key] = opts.conflicts === 'prefer-left' ? result[key] : source[key];
        }
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  // For everything else, return based on conflict strategy
  return opts.conflicts === 'prefer-left' ? target : source;
}

/**
 * Check if value is a plain object
 */
function isPlainObject(value: any): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}
