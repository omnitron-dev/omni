/**
 * String Utilities
 *
 * Common string manipulation utilities.
 *
 * @module @omnitron/prism/utils/string
 */

// =============================================================================
// TEXT FORMATTING
// =============================================================================

/**
 * Truncate text with ellipsis.
 *
 * @example
 * ```ts
 * truncate('Hello, World!', 8)
 * // => "Hello..."
 *
 * truncate('Short', 10)
 * // => "Short"
 *
 * truncate('Hello, World!', 8, '…')
 * // => "Hello, W…"
 * ```
 */
export function truncate(text: string | null | undefined, length: number, suffix: string = '...'): string {
  if (!text) return '';
  if (text.length <= length) return text;

  return text.slice(0, length - suffix.length) + suffix;
}

/**
 * Get initials from a name.
 *
 * @example
 * ```ts
 * getInitials('John Doe')
 * // => "JD"
 *
 * getInitials('Alice Bob Charlie')
 * // => "AC"
 *
 * getInitials('SingleName')
 * // => "SI"
 * ```
 */
export function getInitials(name: string | null | undefined): string {
  if (!name) return '';

  const words = name.trim().split(/\s+/);

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Capitalize the first letter of a string.
 *
 * @example
 * ```ts
 * capitalize('hello world')
 * // => "Hello world"
 * ```
 */
export function capitalize(text: string | null | undefined): string {
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Capitalize the first letter of each word.
 *
 * @example
 * ```ts
 * titleCase('hello world')
 * // => "Hello World"
 *
 * titleCase('the quick brown fox')
 * // => "The Quick Brown Fox"
 * ```
 */
export function titleCase(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Convert string to kebab-case.
 *
 * @example
 * ```ts
 * kebabCase('Hello World')
 * // => "hello-world"
 *
 * kebabCase('camelCaseString')
 * // => "camel-case-string"
 * ```
 */
export function kebabCase(text: string | null | undefined): string {
  if (!text) return '';

  return text
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/**
 * Convert string to camelCase.
 *
 * @example
 * ```ts
 * camelCase('Hello World')
 * // => "helloWorld"
 *
 * camelCase('kebab-case-string')
 * // => "kebabCaseString"
 * ```
 */
export function camelCase(text: string | null | undefined): string {
  if (!text) return '';

  return text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase());
}

/**
 * Convert string to snake_case.
 *
 * @example
 * ```ts
 * snakeCase('Hello World')
 * // => "hello_world"
 *
 * snakeCase('camelCaseString')
 * // => "camel_case_string"
 * ```
 */
export function snakeCase(text: string | null | undefined): string {
  if (!text) return '';

  return text
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

// =============================================================================
// SEARCH & HIGHLIGHT
// =============================================================================

/**
 * Highlight search query in text by wrapping matches in <mark> tags.
 *
 * @example
 * ```ts
 * highlightText('Hello World', 'wor')
 * // => "Hello <mark>Wor</mark>ld"
 *
 * highlightText('Test Case', 'test', '<strong>', '</strong>')
 * // => "<strong>Test</strong> Case"
 * ```
 */
export function highlightText(
  text: string | null | undefined,
  query: string | null | undefined,
  openTag: string = '<mark>',
  closeTag: string = '</mark>'
): string {
  if (!text) return '';
  if (!query) return text;

  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return text.replace(regex, `${openTag}$1${closeTag}`);
}

/**
 * Escape special regex characters in a string.
 *
 * @example
 * ```ts
 * escapeRegExp('test.string+with[special]chars')
 * // => "test\\.string\\+with\\[special\\]chars"
 * ```
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a string contains a substring (case-insensitive).
 *
 * @example
 * ```ts
 * containsIgnoreCase('Hello World', 'WORLD')
 * // => true
 *
 * containsIgnoreCase('Hello World', 'foo')
 * // => false
 * ```
 */
export function containsIgnoreCase(text: string | null | undefined, search: string | null | undefined): boolean {
  if (!text || !search) return false;
  return text.toLowerCase().includes(search.toLowerCase());
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Check if a string is empty or whitespace only.
 *
 * @example
 * ```ts
 * isBlank('')
 * // => true
 *
 * isBlank('   ')
 * // => true
 *
 * isBlank('hello')
 * // => false
 * ```
 */
export function isBlank(text: string | null | undefined): boolean {
  return !text || text.trim().length === 0;
}

/**
 * Check if a string is a valid email address (basic check).
 *
 * @example
 * ```ts
 * isEmail('test@example.com')
 * // => true
 *
 * isEmail('invalid')
 * // => false
 * ```
 */
export function isEmail(text: string | null | undefined): boolean {
  if (!text) return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(text);
}

/**
 * Check if a string is a valid URL (basic check).
 *
 * @example
 * ```ts
 * isUrl('https://example.com')
 * // => true
 *
 * isUrl('not-a-url')
 * // => false
 * ```
 */
export function isUrl(text: string | null | undefined): boolean {
  if (!text) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// GENERATION
// =============================================================================

/**
 * Generate a random string of specified length.
 *
 * @example
 * ```ts
 * randomString(8)
 * // => "a3Bx9kPq"
 *
 * randomString(16, 'abc123')
 * // => "a1b3c2a1b3c2a1b3"
 * ```
 */
export function randomString(
  length: number = 8,
  chars: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a UUID v4.
 *
 * @example
 * ```ts
 * uuid()
 * // => "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a slug from text.
 *
 * @example
 * ```ts
 * slugify('Hello World!')
 * // => "hello-world"
 *
 * slugify('This is a Test  String')
 * // => "this-is-a-test-string"
 * ```
 */
export function slugify(text: string | null | undefined): string {
  if (!text) return '';

  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '') // Remove non-word chars
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start
    .replace(/-+$/, ''); // Trim - from end
}
