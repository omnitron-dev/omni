/**
 * Get value at path in object
 */
export function getPath(obj: any, path: string): any {
  if (!path) return obj;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * Set value at path in object (immutable)
 */
export function setPath(obj: any, path: string, value: any): any {
  if (!path) return value;

  const keys = path.split('.');
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current: any = result;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];

    if (next === null || next === undefined) {
      current[key] = {};
    } else {
      current[key] = Array.isArray(next) ? [...next] : { ...next };
    }

    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return result;
}

/**
 * Delete value at path in object (immutable)
 */
export function deletePath(obj: any, path: string): any {
  if (!path) return undefined;

  const keys = path.split('.');
  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current: any = result;
  const parents: any[] = [result];

  // Navigate to parent
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = current[key];

    if (next === null || next === undefined) {
      return result; // Path doesn't exist
    }

    current[key] = Array.isArray(next) ? [...next] : { ...next };
    current = current[key];
    parents.push(current);
  }

  // Delete the key
  const lastKey = keys[keys.length - 1];
  if (Array.isArray(current)) {
    current.splice(Number(lastKey), 1);
  } else {
    delete current[lastKey];
  }

  return result;
}

/**
 * Check if path exists in object
 */
export function hasPath(obj: any, path: string): boolean {
  if (!path) return true;

  const keys = path.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return false;
    }
    if (!(key in current)) {
      return false;
    }
    current = current[key];
  }

  return true;
}
