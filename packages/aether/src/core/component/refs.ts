/**
 * Component Refs
 *
 * References to DOM elements and component instances
 */

import { signal } from '../reactivity/signal.js';

/**
 * Ref object that holds a reference to a DOM element or value
 */
export interface Ref<T = any> {
  current: T | undefined;
}

/**
 * Create a mutable ref object
 *
 * Similar to React's useRef, but without hooks.
 * Useful for storing mutable values that don't trigger re-renders.
 *
 * @param initialValue - Initial ref value
 * @returns Ref object
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   const inputRef = createRef<HTMLInputElement>();
 *
 *   onMount(() => {
 *     inputRef.current?.focus();
 *   });
 *
 *   return () => (
 *     <input ref={inputRef} />
 *   );
 * });
 * ```
 */
export function createRef<T = any>(initialValue?: T): Ref<T> {
  return {
    current: initialValue,
  };
}

/**
 * Alias for createRef (React compatibility)
 *
 * @param initialValue - Initial value
 * @returns Ref object
 */
export function useRef<T = any>(initialValue?: T): Ref<T> {
  return createRef(initialValue);
}

/**
 * Create a reactive ref using signals
 *
 * Unlike createRef, changes to this ref will trigger reactivity.
 *
 * @param initialValue - Initial value
 * @returns Signal-based ref
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   const count = reactiveRef(0);
 *
 *   effect(() => {
 *     console.log('Count changed:', count.current);
 *   });
 *
 *   return () => (
 *     <button on:click={() => count.current++}>
 *       {count.current}
 *     </button>
 *   );
 * });
 * ```
 */
export function reactiveRef<T>(initialValue: T): { current: T } {
  const value = signal(initialValue);

  return {
    get current() {
      return value();
    },
    set current(newValue: T) {
      value.set(newValue);
    },
  };
}

/**
 * Merge multiple refs into one callback ref
 *
 * Useful when you need to forward a ref while also keeping your own.
 *
 * @param refs - Array of refs to merge
 * @returns Callback ref function
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent<{ forwardedRef?: Ref<HTMLElement> }>((props) => {
 *   const localRef = createRef<HTMLElement>();
 *
 *   const mergedRef = mergeRefs([localRef, props.forwardedRef]);
 *
 *   return () => <div ref={mergedRef}>Hello</div>;
 * });
 * ```
 */
export function mergeRefs<T>(refs: (Ref<T> | undefined | null)[]): (element: T) => void {
  return (element: T) => {
    for (const ref of refs) {
      if (ref) {
        ref.current = element;
      }
    }
  };
}
