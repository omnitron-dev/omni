/**
 * URL Utilities
 *
 * Safe URL handling, navigation helpers, and link utilities.
 *
 * @module @omnitron-dev/prism/utils/url
 */

/**
 * Options for safe return URL validation.
 */
export interface SafeReturnUrlOptions {
  /** Allowed URL schemes (default: ['http:', 'https:']) */
  allowedSchemes?: string[];
  /** Allowed hosts (if empty, only relative URLs allowed) */
  allowedHosts?: string[];
  /** Whether to allow relative URLs (default: true) */
  allowRelative?: boolean;
  /** Default URL if validation fails */
  fallback?: string;
}

/**
 * Validate and sanitize a return URL to prevent open redirect vulnerabilities.
 * Only allows relative paths or URLs to explicitly allowed hosts.
 *
 * @example
 * ```tsx
 * // In a login callback
 * const returnUrl = safeReturnUrl(searchParams.get('redirect'), {
 *   allowedHosts: ['app.example.com'],
 *   fallback: '/dashboard',
 * });
 * router.push(returnUrl);
 * ```
 *
 * @param url - URL to validate
 * @param options - Validation options
 * @returns Safe URL or fallback
 */
export function safeReturnUrl(url: string | null | undefined, options: SafeReturnUrlOptions = {}): string {
  const { allowedSchemes = ['http:', 'https:'], allowedHosts = [], allowRelative = true, fallback = '/' } = options;

  if (!url) {
    return fallback;
  }

  try {
    // Handle relative URLs
    if (url.startsWith('/') && !url.startsWith('//')) {
      if (allowRelative) {
        // Ensure it's a valid path (no protocol injection)
        return sanitizePath(url);
      }
      return fallback;
    }

    // Parse absolute URL
    const parsed = new URL(url, 'http://dummy.local');

    // Check scheme
    if (!allowedSchemes.includes(parsed.protocol)) {
      return fallback;
    }

    // Check host (only for absolute URLs)
    if (parsed.host !== 'dummy.local' && allowedHosts.length > 0) {
      if (!allowedHosts.includes(parsed.host)) {
        return fallback;
      }
    }

    // If parsed from a relative URL, return the pathname
    if (parsed.host === 'dummy.local') {
      return allowRelative ? sanitizePath(parsed.pathname + parsed.search + parsed.hash) : fallback;
    }

    return url;
  } catch {
    return fallback;
  }
}

/**
 * Sanitize a URL path to prevent injection attacks.
 *
 * @param path - Path to sanitize
 * @returns Sanitized path
 */
function sanitizePath(path: string): string {
  let sanitized = path;

  // Iteratively strip protocol-like patterns (handles javascript:javascript:... nesting)
  let prev = '';
  while (prev !== sanitized) {
    prev = sanitized;
    sanitized = sanitized.replace(/^[a-z]+:/gi, '');
    // Also strip whitespace/control chars that could bypass regex (e.g. java\x00script:)
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/^[\s\x00-\x1f]+/, '');
  }

  // Remove double slashes that could be interpreted as protocol-relative URLs
  sanitized = sanitized.replace(/^\/\/+/, '/');

  // Ensure it starts with a single slash
  if (!sanitized.startsWith('/')) {
    sanitized = '/' + sanitized;
  }

  return sanitized;
}

/**
 * Check if a navigation link is currently active.
 *
 * Features:
 * - Removes trailing slashes and query parameters before comparison
 * - Ignores external links (https://...) and hash links (#section)
 * - Supports deep matching for nested routes
 * - Handles query parameter paths correctly
 *
 * @example
 * ```tsx
 * // Basic usage
 * isActiveLink('/dashboard', '/dashboard/user/list');     // true (deep match)
 * isActiveLink('/dashboard', '/dashboard/user/list', false); // false (exact match)
 *
 * // Query parameters
 * isActiveLink('/users', '/users?page=1');                // true
 *
 * // Hash links and external links
 * isActiveLink('/home', '#section');                      // false
 * isActiveLink('/home', 'https://example.com');           // false
 *
 * // Navigation items
 * const navItems = [
 *   { path: '/dashboard', label: 'Dashboard', exact: true },
 *   { path: '/users', label: 'Users' },
 *   { path: '/settings', label: 'Settings' },
 * ];
 *
 * navItems.map(item => (
 *   <NavItem
 *     key={item.path}
 *     active={isActiveLink(location.pathname, item.path, !item.exact)}
 *   >
 *     {item.label}
 *   </NavItem>
 * ));
 * ```
 *
 * @param currentPathname - Current location pathname
 * @param targetPath - The link's target path (can include query parameters)
 * @param deep - Whether to perform deep matching for nested routes (default: true)
 * @returns True if the link is active
 */
export function isActiveLink(currentPathname: string, targetPath: string, deep: boolean = true): boolean {
  // Validate inputs
  if (!currentPathname || !targetPath) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[isActiveLink] currentPathname or targetPath is empty');
    }
    return false;
  }

  // Ignore hash links and external links
  if (targetPath.startsWith('#') || isExternalLink(targetPath)) {
    return false;
  }

  // Normalize paths: remove trailing slashes and query parameters
  const pathname = removeLastSlash(currentPathname);
  const cleanedTargetPath = removeLastSlash(removeParams(targetPath));

  // If target has query params, always do deep matching
  const shouldDeepMatch = deep || hasParams(targetPath);

  // Root path special case
  if (cleanedTargetPath === '/') {
    return pathname === '/';
  }

  // Deep match: current path starts with target path
  if (shouldDeepMatch) {
    return pathname === cleanedTargetPath || pathname.startsWith(`${cleanedTargetPath}/`);
  }

  // Exact match
  return pathname === cleanedTargetPath;
}

/**
 * Check if a URL is external (different origin).
 *
 * @param url - URL to check
 * @param currentOrigin - Current page origin (default: window.location.origin)
 * @returns True if the URL is external
 */
export function isExternalUrl(url: string, currentOrigin?: string): boolean {
  try {
    // Relative URLs are internal
    if (url.startsWith('/') && !url.startsWith('//')) {
      return false;
    }

    // Protocol-relative URLs
    if (url.startsWith('//')) {
      const origin = currentOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
      const currentHost = new URL(origin).host;
      const urlHost = url.slice(2).split('/')[0];
      return urlHost !== currentHost;
    }

    // Absolute URLs
    const origin = currentOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    const urlOrigin = new URL(url).origin;
    return urlOrigin !== origin;
  } catch {
    return false;
  }
}

/**
 * Build a URL with query parameters.
 *
 * @example
 * ```tsx
 * const url = buildUrl('/search', {
 *   q: 'hello world',
 *   page: 1,
 *   filter: ['active', 'recent'],
 * });
 * // Returns: '/search?q=hello+world&page=1&filter=active&filter=recent'
 * ```
 *
 * @param base - Base URL path
 * @param params - Query parameters
 * @returns URL with query string
 */
export function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | (string | number | boolean)[] | null | undefined>
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
    } else {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  if (!queryString) {
    return base;
  }

  const separator = base.includes('?') ? '&' : '?';
  return base + separator + queryString;
}

/**
 * Parse query parameters from a URL string.
 *
 * @param url - URL or query string
 * @returns Parsed parameters
 */
export function parseQueryParams(url: string): Record<string, string | string[]> {
  const queryString = url.includes('?') ? url.split('?')[1] : url;
  const params = new URLSearchParams(queryString);
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of params.entries()) {
    const existing = result[key];
    if (existing) {
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Get a single query parameter value.
 *
 * @param url - URL or query string
 * @param key - Parameter key
 * @returns Parameter value or undefined
 */
export function getQueryParam(url: string, key: string): string | undefined {
  const params = parseQueryParams(url);
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Check if a URL has query parameters.
 *
 * @param url - URL to check
 * @returns True if URL has query parameters
 *
 * @example
 * ```ts
 * hasParams('/search?q=hello'); // true
 * hasParams('/search');         // false
 * ```
 */
export function hasParams(url: string): boolean {
  return url.includes('?') && url.split('?')[1]?.length > 0;
}

/**
 * Remove query parameters from a URL.
 *
 * @param url - URL to process
 * @returns URL without query parameters
 *
 * @example
 * ```ts
 * removeParams('/search?q=hello'); // '/search'
 * removeParams('/search');         // '/search'
 * ```
 */
export function removeParams(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

/**
 * Remove trailing slash from a path.
 *
 * @param pathname - Path to process
 * @returns Path without trailing slash
 *
 * @example
 * ```ts
 * removeLastSlash('/users/');  // '/users'
 * removeLastSlash('/users');   // '/users'
 * removeLastSlash('/');        // '/'
 * ```
 */
export function removeLastSlash(pathname: string): string {
  if (pathname === '/') {
    return pathname;
  }
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * Check if a URL is an external link (starts with http:// or https://).
 *
 * @param url - URL to check
 * @returns True if external link
 *
 * @example
 * ```ts
 * isExternalLink('https://example.com'); // true
 * isExternalLink('/about');              // false
 * isExternalLink('#section');            // false
 * ```
 */
export function isExternalLink(url: string): boolean {
  return /^https?:\/\//.test(url);
}

/**
 * Compare two paths for equality (ignoring trailing slashes and query params).
 *
 * @param targetUrl - Target URL
 * @param currentUrl - Current URL
 * @param options - Comparison options
 * @returns True if paths are equal
 *
 * @example
 * ```ts
 * isEqualPath('/users/', '/users');          // true
 * isEqualPath('/users?page=1', '/users');    // true
 * isEqualPath('/users', '/users/1', { deep: true }); // false
 * ```
 */
export function isEqualPath(targetUrl: string, currentUrl: string, options: { deep?: boolean } = {}): boolean {
  const { deep = false } = options;

  // Normalize both paths
  const target = removeLastSlash(removeParams(targetUrl));
  const current = removeLastSlash(removeParams(currentUrl));

  if (deep) {
    return current === target || current.startsWith(target + '/');
  }

  return target === current;
}
