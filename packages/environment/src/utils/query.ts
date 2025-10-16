import { JSONPath } from 'jsonpath-plus';

/**
 * Query result interface
 */
export interface QueryResult {
  path: string;
  value: any;
}

/**
 * Query options
 */
export interface QueryOptions {
  wrap?: boolean; // Return QueryResult[] instead of any[]
}

/**
 * Parse array access from path segment (e.g., "users[0]" => { key: "users", index: 0 })
 */
function parseArrayAccess(segment: string): { key: string; index?: number } {
  const match = segment.match(/^([^[]+)\[(\d+)\]$/);
  if (match) {
    return { key: match[1], index: parseInt(match[2], 10) };
  }
  return { key: segment };
}

/**
 * Parse filter expression (e.g., "[?(@.environment === "production")]")
 */
function parseFilter(segment: string): { key: string; filter?: string } {
  const match = segment.match(/^([^[]+)\[\?\((.+)\)\]$/);
  if (match) {
    return { key: match[1], filter: match[2] };
  }
  return { key: segment };
}

/**
 * Evaluate filter expression on an object
 */
function evaluateFilter(obj: any, filter: string): boolean {
  try {
    // Simple filter evaluation (supports @.property === value, @.property > value, etc.)
    // Replace @ with obj reference
    const expression = filter.replace(/@\.(\w+)/g, 'obj.$1');
    // Use Function constructor for evaluation (safer than eval)
    const fn = new Function('obj', `return ${expression};`);
    return fn(obj);
  } catch {
    return false;
  }
}

/**
 * Match wildcard pattern against a string
 */
function matchWildcard(pattern: string, str: string): boolean {
  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .split('*')
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

/**
 * Query with wildcard support
 * Supports:
 * - Simple paths: 'database.host'
 * - Single-level wildcards: '*.host' (matches any key at that level)
 * - Recursive wildcards: '**.timeout' (matches at all levels)
 * - Array access: 'api.endpoints[0]'
 * - Array filters: 'databases[?(@.environment === "production")]'
 */
export function queryWildcard(data: any, pattern: string, options?: QueryOptions): any[] {
  const results: QueryResult[] = [];

  // Handle recursive wildcard at the start
  if (pattern.startsWith('**.')) {
    const restPattern = pattern.slice(3);
    collectRecursive(data, '', restPattern, results);
    return options?.wrap ? results : results.map((r) => r.value);
  }

  // Split pattern into segments
  const segments = pattern.split('.');

  function traverse(obj: any, segmentIndex: number, currentPath: string) {
    if (segmentIndex >= segments.length) {
      results.push({ path: currentPath, value: obj });
      return;
    }

    const segment = segments[segmentIndex];

    // Handle recursive wildcard
    if (segment === '**') {
      const restPattern = segments.slice(segmentIndex + 1).join('.');
      collectRecursive(obj, currentPath, restPattern, results);
      return;
    }

    // Handle array filter
    const filterParsed = parseFilter(segment);
    if (filterParsed.filter) {
      const target = obj[filterParsed.key];
      if (Array.isArray(target)) {
        target.forEach((item, index) => {
          if (evaluateFilter(item, filterParsed.filter!)) {
            const newPath = currentPath ? `${currentPath}.${filterParsed.key}[${index}]` : `${filterParsed.key}[${index}]`;
            traverse(item, segmentIndex + 1, newPath);
          }
        });
      }
      return;
    }

    // Handle array access
    const arrayParsed = parseArrayAccess(segment);
    if (arrayParsed.index !== undefined) {
      const target = obj[arrayParsed.key];
      if (Array.isArray(target) && arrayParsed.index < target.length) {
        const newPath = currentPath ? `${currentPath}.${arrayParsed.key}[${arrayParsed.index}]` : `${arrayParsed.key}[${arrayParsed.index}]`;
        traverse(target[arrayParsed.index], segmentIndex + 1, newPath);
      }
      return;
    }

    // Handle wildcard
    if (segment === '*') {
      if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;
            traverse(obj[key], segmentIndex + 1, newPath);
          }
        }
      }
      return;
    }

    // Handle partial wildcard (e.g., "db*")
    if (segment.includes('*')) {
      if (typeof obj === 'object' && obj !== null) {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key) && matchWildcard(segment, key)) {
            const newPath = currentPath ? `${currentPath}.${key}` : key;
            traverse(obj[key], segmentIndex + 1, newPath);
          }
        }
      }
      return;
    }

    // Handle normal segment
    if (typeof obj === 'object' && obj !== null && segment in obj) {
      const newPath = currentPath ? `${currentPath}.${segment}` : segment;
      traverse(obj[segment], segmentIndex + 1, newPath);
    }
  }

  traverse(data, 0, '');
  return options?.wrap ? results : results.map((r) => r.value);
}

/**
 * Collect all matches recursively
 */
function collectRecursive(obj: any, currentPath: string, pattern: string, results: QueryResult[]) {
  if (typeof obj !== 'object' || obj === null) {
    return;
  }

  // Try to match pattern at current level
  const matches = queryWildcard(obj, pattern, { wrap: true }) as QueryResult[];
  for (const match of matches) {
    const fullPath = currentPath ? `${currentPath}.${match.path}` : match.path;
    results.push({ path: fullPath, value: match.value });
  }

  // Recurse into children
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      const newPath = currentPath ? `${currentPath}[${index}]` : `[${index}]`;
      collectRecursive(item, newPath, pattern, results);
    });
  } else {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key;
        collectRecursive(obj[key], newPath, pattern, results);
      }
    }
  }
}

/**
 * Query using JSONPath
 * Standard JSONPath syntax with full support via jsonpath-plus
 * Examples:
 * - '$..secrets.*' - Recursive descent
 * - '$.services[?(@.priority > 5)]' - Array filtering
 * - '$.store.book[*].author' - All book authors
 */
export function queryJSONPath(data: any, pattern: string): any[] {
  try {
    const result = JSONPath({
      path: pattern,
      json: data,
      wrap: false
    });

    // JSONPath can return a single value, array, or undefined
    if (result === undefined) {
      return [];
    }
    return Array.isArray(result) ? result.filter((v) => v !== undefined) : [result];
  } catch (error) {
    // Return empty array on error (don't throw)
    return [];
  }
}

/**
 * Query using XPath-style syntax (simplified)
 * Supports XPath-like patterns:
 * - '//services/star/config' - Recursive descent
 * - '//services/star[enabled=true]' - Predicates
 * - '/root/users/user[0]' - Array access
 */
export function queryXPath(data: any, pattern: string): any[] {
  const results: any[] = [];

  // Convert XPath to internal format
  if (pattern.startsWith('//')) {
    // Recursive descent
    const restPath = pattern.slice(2);
    queryXPathRecursive(data, restPath, results);
  } else if (pattern.startsWith('/')) {
    // Absolute path
    const restPath = pattern.slice(1);
    queryXPathAbsolute(data, restPath, results);
  } else {
    // Relative path (treat as absolute)
    queryXPathAbsolute(data, pattern, results);
  }

  return results;
}

/**
 * Query XPath recursively
 */
function queryXPathRecursive(obj: any, path: string, results: any[]) {
  if (typeof obj !== 'object' || obj === null) {
    return;
  }

  // Try to match at current level
  queryXPathAbsolute(obj, path, results);

  // Recurse into children
  if (Array.isArray(obj)) {
    obj.forEach((item) => queryXPathRecursive(item, path, results));
  } else {
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        queryXPathRecursive(obj[key], path, results);
      }
    }
  }
}

/**
 * Query XPath absolutely from current object
 */
function queryXPathAbsolute(obj: any, path: string, results: any[]) {
  const segments = path.split('/').filter((s) => s.length > 0);

  function traverse(current: any, segmentIndex: number) {
    if (segmentIndex >= segments.length) {
      results.push(current);
      return;
    }

    const segment = segments[segmentIndex];

    // Parse predicate [key=value]
    const predicateMatch = segment.match(/^([^[]+)\[([^=]+)=([^\]]+)\]$/);
    if (predicateMatch) {
      const key = predicateMatch[1];
      const predKey = predicateMatch[2];
      const predValue = predicateMatch[3];

      if (key === '*') {
        // Wildcard with predicate
        if (typeof current === 'object' && current !== null) {
          for (const k in current) {
            if (Object.prototype.hasOwnProperty.call(current, k)) {
              const item = current[k];
              if (typeof item === 'object' && item !== null && item[predKey] == predValue) {
                traverse(item, segmentIndex + 1);
              }
            }
          }
        }
      } else {
        // Specific key with predicate
        const target = current[key];
        if (Array.isArray(target)) {
          target.forEach((item) => {
            if (typeof item === 'object' && item !== null && item[predKey] == predValue) {
              traverse(item, segmentIndex + 1);
            }
          });
        } else if (typeof target === 'object' && target !== null && target[predKey] == predValue) {
          traverse(target, segmentIndex + 1);
        }
      }
      return;
    }

    // Parse array access [index]
    const arrayMatch = segment.match(/^([^[]+)\[(\d+)\]$/);
    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = parseInt(arrayMatch[2], 10);
      const target = current[key];
      if (Array.isArray(target) && index < target.length) {
        traverse(target[index], segmentIndex + 1);
      }
      return;
    }

    // Handle wildcard
    if (segment === '*') {
      if (typeof current === 'object' && current !== null) {
        for (const key in current) {
          if (Object.prototype.hasOwnProperty.call(current, key)) {
            traverse(current[key], segmentIndex + 1);
          }
        }
      }
      return;
    }

    // Normal segment
    if (typeof current === 'object' && current !== null && segment in current) {
      traverse(current[segment], segmentIndex + 1);
    }
  }

  traverse(obj, 0);
}
