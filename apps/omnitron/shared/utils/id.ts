/**
 * ID Generation Utilities
 *
 * Shared utilities for generating unique identifiers
 */

/**
 * Generate a unique ID using timestamp and random component
 */
export function generateId(prefix?: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  const id = `${timestamp}${random}`;
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Generate a symbol-based unique ID
 */
export function generateSymbol(description?: string): symbol {
  return Symbol(description);
}

/**
 * Validate ID format
 */
export function isValidId(id: string): boolean {
  return typeof id === 'string' && id.length > 0 && /^[a-z0-9_-]+$/i.test(id);
}
