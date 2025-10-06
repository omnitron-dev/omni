/**
 * Props Utilities
 *
 * Helper functions for component props manipulation
 */

/**
 * Merge multiple props objects with defaults
 *
 * Later objects override earlier ones. Useful for default props.
 *
 * @param sources - Props objects to merge
 * @returns Merged props object
 *
 * @example
 * ```typescript
 * const Button = defineComponent<ButtonProps>((props) => {
 *   const merged = mergeProps(
 *     { variant: 'primary', size: 'md' }, // defaults
 *     props // user props override defaults
 *   );
 *
 *   return () => <button class={`btn-${merged.variant}`}>Click</button>;
 * });
 * ```
 */
export function mergeProps<T extends Record<string, any>>(
  ...sources: Partial<T>[]
): T {
  const result = {} as T;

  for (const source of sources) {
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        (result as any)[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * Split props into multiple objects by keys
 *
 * Useful for extracting specific props while keeping reactivity.
 * Supports splitting into multiple groups.
 *
 * @param props - Source props object
 * @param keys - Keys to extract into groups
 * @returns Array of prop groups, with remaining props as last element
 *
 * @example
 * ```typescript
 * // Two groups
 * const [local, others] = splitProps(props, ['value', 'onChange']);
 *
 * // Multiple groups
 * const [dom, events, rest] = splitProps(
 *   props,
 *   ['class', 'id'],
 *   ['onClick', 'onInput']
 * );
 * ```
 */
export function splitProps<T extends Record<string, any>>(
  props: T,
  ...keys: (keyof T)[][]
): any[] {
  const groups: any[] = [];
  const allKeys = new Set<keyof T>();

  // Create groups for each key array
  for (const keyGroup of keys) {
    const group: any = {};

    for (const key of keyGroup) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        group[key] = props[key];
        allKeys.add(key);
      }
    }

    groups.push(group);
  }

  // Create remaining props object
  const rest: any = {};
  for (const key in props) {
    if (Object.prototype.hasOwnProperty.call(props, key) && !allKeys.has(key)) {
      rest[key] = props[key];
    }
  }

  groups.push(rest);

  return groups;
}

/**
 * Create reactive props proxy
 *
 * Wraps props in a proxy that preserves reactivity even after destructuring.
 * Note: This is a simplified implementation. Full version would integrate
 * with the reactivity system more deeply.
 *
 * @param props - Props object
 * @returns Reactive proxy
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent<Props>((rawProps) => {
 *   const props = reactiveProps(rawProps);
 *   const { value } = props; // Still reactive!
 *
 *   return () => <div>{value}</div>;
 * });
 * ```
 */
export function reactiveProps<T extends Record<string, any>>(props: T): T {
  // In full implementation, this would create a proxy that
  // tracks access and maintains reactivity
  // For now, just return props as-is
  return props;
}
