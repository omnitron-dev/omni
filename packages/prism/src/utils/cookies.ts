/**
 * Cookie Utilities
 *
 * Type-safe cookie management with JSON serialization.
 *
 * @module @omnitron-dev/prism/utils
 */

/**
 * Cookie options for setting cookies.
 */
export interface CookieOptions {
  /** Enable secure flag (HTTPS only) */
  secure?: boolean;
  /** Days until expiration */
  daysUntilExpiration?: number;
  /** SameSite policy */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Cookie domain */
  domain?: string;
  /** Cookie path */
  path?: string;
}

/**
 * Check if cookies are available.
 *
 * @returns {boolean} True if cookies are available
 */
export function cookiesAvailable(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    document.cookie = '__test__=1';
    const result = document.cookie.includes('__test__=1');
    document.cookie = '__test__=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    return result;
  } catch {
    return false;
  }
}

/**
 * Get a cookie value with JSON parsing.
 *
 * @template T - Type of the stored value
 * @param {string} key - Cookie name
 * @returns {T | null} Parsed value or null
 *
 * @example
 * ```ts
 * const user = getCookie<User>('user');
 * ```
 */
export function getCookie<T>(key: string): T | null {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    const name = `${key}=`;
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookies = decodedCookie.split(';');

    for (const cookie of cookies) {
      const c = cookie.trim();
      if (c.startsWith(name)) {
        const value = c.substring(name.length);
        return JSON.parse(value) as T;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Set a cookie with JSON serialization.
 *
 * @template T - Type of the value
 * @param {string} key - Cookie name
 * @param {T} value - Value to store
 * @param {CookieOptions} [options] - Cookie options
 *
 * @example
 * ```ts
 * setCookie('user', { name: 'John' }, { daysUntilExpiration: 7 });
 * ```
 */
export function setCookie<T>(key: string, value: T, options: CookieOptions = {}): void {
  if (typeof document === 'undefined') {
    return;
  }

  const { secure = false, daysUntilExpiration = 30, sameSite = 'lax', domain, path = '/' } = options;

  try {
    const serializedValue = JSON.stringify(value);
    let cookieString = `${key}=${encodeURIComponent(serializedValue)}`;

    if (daysUntilExpiration) {
      const date = new Date();
      date.setTime(date.getTime() + daysUntilExpiration * 24 * 60 * 60 * 1000);
      cookieString += `; expires=${date.toUTCString()}`;
    }

    cookieString += `; path=${path}`;
    cookieString += `; SameSite=${sameSite}`;

    if (secure) {
      cookieString += '; Secure';
    }

    if (domain) {
      cookieString += `; domain=${domain}`;
    }

    document.cookie = cookieString;
  } catch (error) {
    console.warn(`Failed to set cookie "${key}":`, error);
  }
}

/**
 * Remove a cookie.
 *
 * @param {string} key - Cookie name
 * @param {Pick<CookieOptions, 'domain' | 'path'>} [options] - Cookie options
 *
 * @example
 * ```ts
 * removeCookie('user');
 * ```
 */
export function removeCookie(key: string, options: Pick<CookieOptions, 'domain' | 'path'> = {}): void {
  if (typeof document === 'undefined') {
    return;
  }

  const { domain, path = '/' } = options;

  let cookieString = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;

  if (domain) {
    cookieString += `; domain=${domain}`;
  }

  document.cookie = cookieString;
}
