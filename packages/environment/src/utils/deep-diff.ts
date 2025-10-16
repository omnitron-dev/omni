import { EnvironmentDiff } from '../types/operations.js';

/**
 * Compute deep difference between two objects
 */
export function deepDiff(before: any, after: any, path = ''): Partial<EnvironmentDiff> {
  const added: Record<string, any> = {};
  const modified: Record<string, { before: any; after: any }> = {};
  const deleted: string[] = [];

  // Handle null/undefined
  if (before === null || before === undefined) {
    if (after !== null && after !== undefined) {
      added[path || 'root'] = after;
    }
    return { added, modified, deleted };
  }

  if (after === null || after === undefined) {
    deleted.push(path || 'root');
    return { added, modified, deleted };
  }

  // If types don't match, treat as modification
  if (typeof before !== typeof after) {
    modified[path || 'root'] = { before, after };
    return { added, modified, deleted };
  }

  // Handle arrays
  if (Array.isArray(before) && Array.isArray(after)) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      modified[path || 'root'] = { before, after };
    }
    return { added, modified, deleted };
  }

  // Handle objects
  if (isPlainObject(before) && isPlainObject(after)) {
    const beforeKeys = new Set(Object.keys(before));
    const afterKeys = new Set(Object.keys(after));

    // Find added keys
    for (const key of afterKeys) {
      if (!beforeKeys.has(key)) {
        const newPath = path ? `${path}.${key}` : key;
        added[newPath] = after[key];
      }
    }

    // Find deleted keys
    for (const key of beforeKeys) {
      if (!afterKeys.has(key)) {
        const newPath = path ? `${path}.${key}` : key;
        deleted.push(newPath);
      }
    }

    // Find modified keys
    for (const key of beforeKeys) {
      if (afterKeys.has(key)) {
        const newPath = path ? `${path}.${key}` : key;
        const subDiff = deepDiff(before[key], after[key], newPath);

        Object.assign(added, subDiff.added);
        Object.assign(modified, subDiff.modified);
        deleted.push(...(subDiff.deleted || []));
      }
    }

    return { added, modified, deleted };
  }

  // For primitives
  if (before !== after) {
    modified[path || 'root'] = { before, after };
  }

  return { added, modified, deleted };
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
