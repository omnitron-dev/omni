/**
 * Static Props Implementation
 *
 * Build-time data fetching for static site generation
 */

import type { GetStaticProps, StaticPropsContext, StaticPropsResult } from './types.js';

/**
 * Execute getStaticProps function
 *
 * @param getStaticProps - Function to execute
 * @param context - Static props context
 * @returns Static props result
 */
export async function executeStaticProps<T = any>(
  getStaticProps: GetStaticProps<T>,
  context: StaticPropsContext
): Promise<StaticPropsResult<T>> {
  try {
    const result = await getStaticProps(context);

    // Validate result
    if (!result || typeof result !== 'object') {
      throw new Error('getStaticProps must return an object');
    }

    // Handle notFound
    if (result.notFound) {
      return { ...result, props: {} as T };
    }

    // Handle redirect
    if (result.redirect) {
      return result;
    }

    // Validate props
    if (!result.props || typeof result.props !== 'object') {
      throw new Error('getStaticProps must return a props object');
    }

    // Ensure props are serializable
    try {
      JSON.stringify(result.props);
    } catch (_error) {
      throw new Error('Props returned from getStaticProps must be JSON serializable');
    }

    return result;
  } catch (error) {
    throw new Error(`Error executing getStaticProps: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Create static props context
 *
 * @param params - Route parameters
 * @param options - Additional options
 * @returns Static props context
 */
export function createStaticPropsContext(
  params: Record<string, string | string[]>,
  options: {
    locale?: string;
    preview?: boolean;
    previewData?: any;
  } = {}
): StaticPropsContext {
  return {
    params,
    locale: options.locale,
    preview: options.preview,
    previewData: options.previewData,
  };
}

/**
 * Merge static props results
 *
 * Useful for combining multiple data sources
 *
 * @param results - Array of static props results
 * @returns Merged result
 */
export function mergeStaticProps<T = any>(...results: StaticPropsResult<any>[]): StaticPropsResult<T> {
  const merged: StaticPropsResult<T> = {
    props: {} as T,
  };

  for (const result of results) {
    // Check for notFound - if any result is notFound, return notFound
    if (result.notFound) {
      return { props: {} as T, notFound: true };
    }

    // Check for redirect - first redirect wins
    if (result.redirect && !merged.redirect) {
      merged.redirect = result.redirect;
    }

    // Merge props
    if (result.props) {
      merged.props = { ...merged.props, ...result.props };
    }

    // Use shortest revalidate time
    if (result.revalidate !== undefined) {
      if (merged.revalidate === undefined || result.revalidate === false) {
        merged.revalidate = result.revalidate;
      } else if (typeof result.revalidate === 'number' && typeof merged.revalidate === 'number') {
        merged.revalidate = Math.min(merged.revalidate, result.revalidate);
      }
    }

    // Use shortest staleWhileRevalidate time
    if (result.staleWhileRevalidate !== undefined) {
      if (merged.staleWhileRevalidate === undefined) {
        merged.staleWhileRevalidate = result.staleWhileRevalidate;
      } else {
        merged.staleWhileRevalidate = Math.min(merged.staleWhileRevalidate, result.staleWhileRevalidate);
      }
    }

    // Merge tags
    if (result.tags) {
      merged.tags = [...(merged.tags || []), ...result.tags];
    }

    // Merge meta (later results override earlier ones)
    if (result.meta) {
      merged.meta = { ...merged.meta, ...result.meta };
    }

    // Merge JSON-LD
    if (result.jsonLd) {
      merged.jsonLd = { ...merged.jsonLd, ...result.jsonLd };
    }
  }

  return merged;
}

/**
 * Create a static props function from multiple sources
 *
 * Executes multiple getStaticProps functions in parallel and merges results
 *
 * @param sources - Array of getStaticProps functions
 * @returns Combined getStaticProps function
 */
export function combineStaticProps<T = any>(...sources: GetStaticProps[]): GetStaticProps<T> {
  return async (context: StaticPropsContext) => {
    const results = await Promise.all(sources.map((source) => source(context)));
    return mergeStaticProps<T>(...results);
  };
}

/**
 * Create a cached static props function
 *
 * Caches results based on params to avoid redundant data fetching
 *
 * @param getStaticProps - Function to cache
 * @returns Cached function
 */
export function cacheStaticProps<T = any>(getStaticProps: GetStaticProps<T>): GetStaticProps<T> {
  const cache = new Map<string, StaticPropsResult<T>>();

  return async (context: StaticPropsContext) => {
    const key = JSON.stringify(context.params);

    if (cache.has(key)) {
      return cache.get(key)!;
    }

    const result = await getStaticProps(context);
    cache.set(key, result);

    return result;
  };
}

/**
 * Validate static props result
 *
 * @param result - Result to validate
 * @returns Validation errors (empty array if valid)
 */
export function validateStaticPropsResult(result: any): string[] {
  const errors: string[] = [];

  if (!result || typeof result !== 'object') {
    errors.push('Result must be an object');
    return errors;
  }

  // If notFound or redirect, no need to validate props
  if (result.notFound || result.redirect) {
    return errors;
  }

  if (!result.props) {
    errors.push('Result must have a props property');
  } else if (typeof result.props !== 'object') {
    errors.push('Props must be an object');
  }

  // Validate revalidate
  if (result.revalidate !== undefined && result.revalidate !== false && typeof result.revalidate !== 'number') {
    errors.push('revalidate must be a number or false');
  }

  if (typeof result.revalidate === 'number' && result.revalidate < 0) {
    errors.push('revalidate must be a positive number');
  }

  // Validate staleWhileRevalidate
  if (result.staleWhileRevalidate !== undefined && typeof result.staleWhileRevalidate !== 'number') {
    errors.push('staleWhileRevalidate must be a number');
  }

  if (typeof result.staleWhileRevalidate === 'number' && result.staleWhileRevalidate < 0) {
    errors.push('staleWhileRevalidate must be a positive number');
  }

  // Validate tags
  if (result.tags !== undefined && !Array.isArray(result.tags)) {
    errors.push('tags must be an array');
  }

  if (Array.isArray(result.tags) && !result.tags.every((tag: any) => typeof tag === 'string')) {
    errors.push('tags must be an array of strings');
  }

  // Validate meta
  if (result.meta !== undefined && typeof result.meta !== 'object') {
    errors.push('meta must be an object');
  }

  // Validate jsonLd
  if (result.jsonLd !== undefined && typeof result.jsonLd !== 'object') {
    errors.push('jsonLd must be an object');
  }

  // Validate redirect
  if (result.redirect) {
    if (!result.redirect.destination || typeof result.redirect.destination !== 'string') {
      errors.push('redirect.destination must be a string');
    }
    if (typeof result.redirect.permanent !== 'boolean') {
      errors.push('redirect.permanent must be a boolean');
    }
  }

  return errors;
}

/**
 * Helper to create a simple static props result
 *
 * @param props - Props to return
 * @param options - Additional options
 * @returns Static props result
 */
export function createStaticPropsResult<T = any>(
  props: T,
  options: {
    revalidate?: number | false;
    staleWhileRevalidate?: number;
    tags?: string[];
    meta?: StaticPropsResult['meta'];
    jsonLd?: Record<string, any>;
  } = {}
): StaticPropsResult<T> {
  return {
    props,
    revalidate: options.revalidate,
    staleWhileRevalidate: options.staleWhileRevalidate,
    tags: options.tags,
    meta: options.meta,
    jsonLd: options.jsonLd,
  };
}

/**
 * Helper to create a 404 result
 *
 * @returns Static props result with notFound flag
 */
export function notFound(): StaticPropsResult {
  return {
    props: {},
    notFound: true,
  };
}

/**
 * Helper to create a redirect result
 *
 * @param destination - Redirect destination
 * @param permanent - Whether redirect is permanent
 * @returns Static props result with redirect
 */
export function redirect(destination: string, permanent = false): StaticPropsResult {
  return {
    props: {},
    redirect: {
      destination,
      permanent,
    },
  };
}
