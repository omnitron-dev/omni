/**
 * Props Utilities
 *
 * Helper functions for component props manipulation
 */

import { signal, type WritableSignal, isSignal } from '../reactivity/signal.js';
import { context } from '../reactivity/context.js';

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
export function mergeProps<T extends Record<string, any>>(...sources: Partial<T>[]): T {
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
export function splitProps<T extends Record<string, any>>(props: T, ...keys: (keyof T)[][]): any[] {
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
 * Wraps props in a proxy that preserves reactivity when props change.
 * The proxy tracks property access in reactive contexts (effects/computed).
 *
 * **IMPORTANT**: Do not destructure! Access properties directly through the proxy.
 *
 * @param props - Props object
 * @returns Reactive proxy with update method
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent<Props>((rawProps) => {
 *   const props = reactiveProps(rawProps);
 *
 *   // ✅ CORRECT: Access through proxy
 *   return () => <div onClick={props.onChange}>{props.value}</div>;
 *
 *   // ❌ WRONG: Destructuring loses reactivity
 *   // const { value } = props;
 * });
 * ```
 */
export function reactiveProps<T extends Record<string, any>>(props: T): T & { [PROPS_UPDATE]?: (newProps: T) => void } {
  // Create signal to store current props
  // Ensure props is always an object (never undefined/null)
  const propsSignal: WritableSignal<T> = signal<T>((props ?? {}) as T);

  // Create proxy that reads from signal
  const proxy = new Proxy({} as T, {
    get(_, property) {
      // Special internal update method
      if (property === PROPS_UPDATE) {
        return (newProps: T) => {
          propsSignal.set(newProps);
        };
      }

      // Read from signal WITH tracking dependency
      // This is critical: we need to track the propsSignal so effects re-run when props change
      // If the prop value itself is a signal, accessing it will create an additional dependency
      const currentProps = propsSignal();
      const value = Reflect.get(currentProps, property);

      // Return value as-is to preserve function references
      // Modern React-style components don't rely on 'this' context
      return value;
    },

    set(_, property, value) {
      // Update the prop in the signal (use untrack here since we're modifying, not reading)
      const currentProps = context.untrack(() => propsSignal());
      const newProps = { ...currentProps, [property]: value };
      propsSignal.set(newProps);
      return true;
    },

    has(_, property) {
      if (property === PROPS_UPDATE) return true;
      // Don't create dependency for has checks
      const currentProps = context.untrack(() => propsSignal());
      return Reflect.has(currentProps, property);
    },

    ownKeys(_) {
      // Don't create dependency for key enumeration
      const currentProps = context.untrack(() => propsSignal());
      return Reflect.ownKeys(currentProps);
    },

    getOwnPropertyDescriptor(_, property) {
      if (property === PROPS_UPDATE) {
        return { configurable: true, enumerable: false, writable: true };
      }
      // Don't create dependency for descriptor checks
      const currentProps = context.untrack(() => propsSignal());
      return Reflect.getOwnPropertyDescriptor(currentProps, property);
    },
  });

  return proxy as T & { [PROPS_UPDATE]?: (newProps: T) => void };
}

/**
 * Internal symbol for props update method
 * @internal
 */
export const PROPS_UPDATE = Symbol('propsUpdate');
