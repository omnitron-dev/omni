/**
 * Static Paths Implementation
 *
 * Dynamic route generation for static site generation
 */

import type { GetStaticPaths, StaticPath, StaticPathsContext, StaticPathsResult } from './types.js';

/**
 * Execute getStaticPaths function
 *
 * @param getStaticPaths - Function to execute
 * @param context - Static paths context
 * @returns Static paths result
 */
export async function executeStaticPaths(
  getStaticPaths: GetStaticPaths,
  context?: StaticPathsContext,
): Promise<StaticPathsResult> {
  try {
    const result = await getStaticPaths(context);

    // Validate result
    if (!result || typeof result !== 'object') {
      throw new Error('getStaticPaths must return an object');
    }

    if (!Array.isArray(result.paths)) {
      throw new Error('getStaticPaths must return a paths array');
    }

    if (result.fallback === undefined) {
      throw new Error('getStaticPaths must return a fallback property');
    }

    // Validate each path
    for (const path of result.paths) {
      if (!path.params || typeof path.params !== 'object') {
        throw new Error('Each path must have a params object');
      }
    }

    return result;
  } catch (error) {
    throw new Error(`Error executing getStaticPaths: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create static paths context
 *
 * @param locale - Current locale
 * @param locales - All locales
 * @returns Static paths context
 */
export function createStaticPathsContext(locale?: string, locales?: string[]): StaticPathsContext {
  return {
    locale,
    locales,
  };
}

/**
 * Normalize path params
 *
 * Ensures all params are in the correct format
 *
 * @param params - Params to normalize
 * @returns Normalized params
 */
export function normalizePathParams(params: Record<string, any>): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      normalized[key] = value.map(String);
    } else {
      normalized[key] = String(value);
    }
  }

  return normalized;
}

/**
 * Create a static path
 *
 * @param params - Route parameters
 * @param locale - Locale
 * @returns Static path
 */
export function createStaticPath(params: Record<string, any>, locale?: string): StaticPath {
  return {
    params: normalizePathParams(params),
    locale,
  };
}

/**
 * Validate static paths result
 *
 * @param result - Result to validate
 * @returns Validation errors (empty array if valid)
 */
export function validateStaticPathsResult(result: any): string[] {
  const errors: string[] = [];

  if (!result || typeof result !== 'object') {
    errors.push('Result must be an object');
    return errors;
  }

  if (!Array.isArray(result.paths)) {
    errors.push('Result must have a paths array');
  } else {
    // Validate each path
    result.paths.forEach((path: any, index: number) => {
      if (!path || typeof path !== 'object') {
        errors.push(`Path at index ${index} must be an object`);
      } else if (!path.params || typeof path.params !== 'object') {
        errors.push(`Path at index ${index} must have a params object`);
      }
    });
  }

  if (result.fallback === undefined) {
    errors.push('Result must have a fallback property');
  } else if (typeof result.fallback !== 'boolean' && result.fallback !== 'blocking') {
    errors.push('fallback must be boolean or "blocking"');
  }

  return errors;
}

/**
 * Convert route pattern to path
 *
 * Replaces dynamic segments with param values
 *
 * @param pattern - Route pattern (e.g., "/blog/[slug]")
 * @param params - Parameter values
 * @returns Path (e.g., "/blog/my-post")
 */
export function patternToPath(pattern: string, params: Record<string, string | string[]>): string {
  let path = pattern;

  // Replace catch-all routes [...slug]
  path = path.replace(/\[\.\.\.(\w+)\]/g, (_, paramName) => {
    const value = params[paramName];
    if (Array.isArray(value)) {
      return value.join('/');
    }
    return String(value);
  });

  // Replace optional catch-all routes [[...slug]]
  path = path.replace(/\[\[\.\.\.(\w+)\]\]/g, (_, paramName) => {
    const value = params[paramName];
    if (!value) return '';
    if (Array.isArray(value)) {
      return value.join('/');
    }
    return String(value);
  });

  // Replace dynamic segments [slug]
  path = path.replace(/\[(\w+)\]/g, (_, paramName) => {
    const value = params[paramName];
    if (Array.isArray(value)) {
      throw new Error(`Parameter ${paramName} is an array but route expects single value`);
    }
    return String(value);
  });

  // Normalize slashes
  path = path.replace(/\/+/g, '/');

  return path;
}

/**
 * Extract param names from route pattern
 *
 * @param pattern - Route pattern (e.g., "/blog/[slug]")
 * @returns Array of param names (e.g., ["slug"])
 */
export function extractParamNames(pattern: string): string[] {
  const params: string[] = [];

  // Catch-all routes [...slug]
  const catchAllMatches = pattern.matchAll(/\[\.\.\.(\w+)\]/g);
  for (const match of catchAllMatches) {
    params.push(match[1]);
  }

  // Optional catch-all routes [[...slug]]
  const optionalCatchAllMatches = pattern.matchAll(/\[\[\.\.\.(\w+)\]\]/g);
  for (const match of optionalCatchAllMatches) {
    params.push(match[1]);
  }

  // Dynamic segments [slug]
  const dynamicMatches = pattern.matchAll(/\[(\w+)\]/g);
  for (const match of dynamicMatches) {
    params.push(match[1]);
  }

  return params;
}

/**
 * Check if route pattern has dynamic segments
 *
 * @param pattern - Route pattern
 * @returns True if pattern has dynamic segments
 */
export function isDynamicRoute(pattern: string): boolean {
  return /\[[\w.]+\]/.test(pattern);
}

/**
 * Generate all combinations of params
 *
 * Useful for generating paths with multiple dynamic segments
 *
 * @param paramSets - Object with param name as key and array of values as value
 * @returns Array of param combinations
 */
export function generateParamCombinations(
  paramSets: Record<string, Array<string | string[]>>,
): Array<Record<string, string | string[]>> {
  const keys = Object.keys(paramSets);
  if (keys.length === 0) {
    return [{}];
  }

  const [firstKey, ...restKeys] = keys;
  const firstValues = paramSets[firstKey];
  const restSets: Record<string, Array<string | string[]>> = {};
  for (const key of restKeys) {
    restSets[key] = paramSets[key];
  }

  const restCombinations = generateParamCombinations(restSets);
  const combinations: Array<Record<string, string | string[]>> = [];

  for (const value of firstValues) {
    for (const restCombination of restCombinations) {
      combinations.push({
        [firstKey]: value,
        ...restCombination,
      });
    }
  }

  return combinations;
}

/**
 * Batch static paths
 *
 * Splits paths into batches for parallel processing
 *
 * @param paths - Paths to batch
 * @param batchSize - Size of each batch
 * @returns Array of path batches
 */
export function batchStaticPaths(paths: StaticPath[], batchSize: number): StaticPath[][] {
  const batches: StaticPath[][] = [];

  for (let i = 0; i < paths.length; i += batchSize) {
    batches.push(paths.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Filter static paths by locale
 *
 * @param paths - Paths to filter
 * @param locale - Locale to filter by
 * @returns Filtered paths
 */
export function filterPathsByLocale(paths: StaticPath[], locale?: string): StaticPath[] {
  if (!locale) {
    return paths;
  }

  return paths.filter((path) => !path.locale || path.locale === locale);
}

/**
 * Deduplicate static paths
 *
 * Removes duplicate paths based on params
 *
 * @param paths - Paths to deduplicate
 * @returns Deduplicated paths
 */
export function deduplicatePaths(paths: StaticPath[]): StaticPath[] {
  const seen = new Set<string>();
  const unique: StaticPath[] = [];

  for (const path of paths) {
    const key = JSON.stringify({ params: path.params, locale: path.locale });
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(path);
    }
  }

  return unique;
}

/**
 * Helper to create static paths result
 *
 * @param paths - Paths to generate
 * @param fallback - Fallback behavior
 * @returns Static paths result
 */
export function createStaticPathsResult(
  paths: Array<Record<string, any>> | StaticPath[],
  fallback: boolean | 'blocking' = false,
): StaticPathsResult {
  const normalizedPaths = paths.map((path) => {
    if ('params' in path) {
      return path as StaticPath;
    }
    return createStaticPath(path);
  });

  return {
    paths: normalizedPaths,
    fallback,
  };
}
