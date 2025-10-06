/**
 * ID Generation Utilities
 *
 * Generate unique IDs for accessibility attributes
 */

let idCounter = 0;

/**
 * Generate unique ID with optional prefix
 *
 * @param prefix - Optional prefix for the ID
 * @returns Unique ID string
 *
 * @example
 * ```ts
 * const id1 = generateId(); // "aether-1"
 * const id2 = generateId('dialog'); // "dialog-2"
 * ```
 */
export function generateId(prefix = 'aether'): string {
  return `${prefix}-${++idCounter}`;
}

/**
 * Generate consistent ID for component instance
 *
 * Creates stable IDs that persist across renders for the same component instance
 *
 * @param componentName - Name of the component
 * @param suffix - Optional suffix (e.g., 'title', 'description')
 * @returns Stable ID string
 *
 * @example
 * ```ts
 * const dialogId = useId('dialog'); // "dialog-1"
 * const titleId = useId('dialog', 'title'); // "dialog-1-title"
 * ```
 */
export function useId(componentName: string, suffix?: string): string {
  const baseId = generateId(componentName);
  return suffix ? `${baseId}-${suffix}` : baseId;
}

/**
 * Create ID generator for component
 *
 * Returns a function that generates related IDs for a component
 *
 * @param baseId - Base ID for the component
 * @returns Function to generate related IDs
 *
 * @example
 * ```ts
 * const createId = createIdGenerator('dialog-1');
 * const titleId = createId('title'); // "dialog-1-title"
 * const descId = createId('description'); // "dialog-1-description"
 * ```
 */
export function createIdGenerator(baseId: string): (suffix: string) => string {
  return (suffix: string) => `${baseId}-${suffix}`;
}
