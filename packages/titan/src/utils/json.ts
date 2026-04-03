/**
 * JSON Utilities Module
 *
 * Provides safe JSON parsing utilities with consistent error handling.
 * These utilities help avoid duplicate try-catch blocks throughout the codebase.
 *
 * @module utils/json
 * @packageDocumentation
 */

/**
 * Safely parse a JSON string, returning null on failure.
 *
 * Use this when you expect the parse might fail and want to handle the null case.
 *
 * @typeParam T - Expected type of the parsed value
 * @param data - JSON string to parse
 * @returns Parsed value as type T, or null if parsing fails
 *
 * @example
 * ```typescript
 * const user = safeJsonParse<User>(jsonString);
 * if (user) {
 *   console.log(user.name);
 * }
 * ```
 */
export function safeJsonParse<T>(data: string): T | null {
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

/**
 * Safely parse a JSON string with a fallback value.
 *
 * Use this when you always need a valid value and have a sensible default.
 *
 * @typeParam T - Expected type of the parsed value
 * @param data - JSON string to parse
 * @param fallback - Value to return if parsing fails
 * @returns Parsed value as type T, or fallback if parsing fails
 *
 * @example
 * ```typescript
 * // Returns empty array if parsing fails
 * const items = safeJsonParseWithFallback<string[]>(jsonString, []);
 *
 * // Returns default config if parsing fails
 * const config = safeJsonParseWithFallback<Config>(jsonString, defaultConfig);
 * ```
 */
export function safeJsonParseWithFallback<T>(data: string, fallback: T): T {
  try {
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

/**
 * Result type for tryJsonParse
 */
export type JsonParseResult<T> = { success: true; data: T; error: null } | { success: false; data: null; error: Error };

/**
 * Try to parse JSON and return a result object with success/failure information.
 *
 * Use this when you need detailed error information about why parsing failed.
 *
 * @typeParam T - Expected type of the parsed value
 * @param data - JSON string to parse
 * @returns Result object with success flag, data or null, and error or null
 *
 * @example
 * ```typescript
 * const result = tryJsonParse<Config>(jsonString);
 * if (result.success) {
 *   console.log('Parsed:', result.data);
 * } else {
 *   console.error('Parse error:', result.error.message);
 * }
 * ```
 */
export function tryJsonParse<T>(data: string): JsonParseResult<T> {
  try {
    return { success: true, data: JSON.parse(data) as T, error: null };
  } catch (e) {
    return {
      success: false,
      data: null,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }
}

/**
 * Safely stringify a value to JSON, returning null on failure.
 *
 * Handles circular references and other stringify errors gracefully.
 *
 * @param value - Value to stringify
 * @param space - Optional indentation (passed to JSON.stringify)
 * @returns JSON string or null if stringification fails
 *
 * @example
 * ```typescript
 * const json = safeJsonStringify(complexObject);
 * if (json) {
 *   console.log(json);
 * } else {
 *   console.error('Failed to stringify object');
 * }
 * ```
 */
export function safeJsonStringify(value: unknown, space?: string | number): string | null {
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return null;
  }
}

/**
 * Safely stringify a value to JSON with a fallback.
 *
 * @param value - Value to stringify
 * @param fallback - Value to return if stringification fails
 * @param space - Optional indentation (passed to JSON.stringify)
 * @returns JSON string or fallback if stringification fails
 *
 * @example
 * ```typescript
 * const json = safeJsonStringifyWithFallback(obj, '{}');
 * ```
 */
export function safeJsonStringifyWithFallback(value: unknown, fallback: string, space?: string | number): string {
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return fallback;
  }
}
