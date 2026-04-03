/**
 * Ref Utilities
 *
 * Utilities for working with React refs.
 *
 * @module @omnitron-dev/prism/utils/refs
 */

import type { MutableRefObject, RefCallback, Ref } from 'react';

/**
 * Supported ref types for merging.
 */
export type MergeableRef<T> = Ref<T> | RefCallback<T> | MutableRefObject<T> | null | undefined;

/**
 * Merge multiple refs into a single callback ref.
 * Useful when you need to pass a ref to a component that also needs
 * to be used by a parent component or hook.
 *
 * @example
 * ```tsx
 * const Component = forwardRef((props, ref) => {
 *   const localRef = useRef<HTMLDivElement>(null);
 *   const mergedRef = mergeRefs(ref, localRef);
 *   return <div ref={mergedRef} />;
 * });
 * ```
 *
 * @param refs - Array of refs to merge
 * @returns A callback ref that updates all provided refs
 */
export function mergeRefs<T>(...refs: MergeableRef<T>[]): RefCallback<T> {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(value);
      } else if (ref != null) {
        (ref as MutableRefObject<T | null>).current = value;
      }
    }
  };
}

/**
 * Create a ref setter that can be used with useImperativeHandle.
 * Useful for exposing a subset of methods from a ref.
 *
 * @example
 * ```tsx
 * const Component = forwardRef<API, Props>((props, ref) => {
 *   const inputRef = useRef<HTMLInputElement>(null);
 *
 *   useImperativeHandle(ref, () => ({
 *     focus: () => inputRef.current?.focus(),
 *     clear: () => { if (inputRef.current) inputRef.current.value = ''; },
 *   }), []);
 *
 *   return <input ref={inputRef} />;
 * });
 * ```
 *
 * @param ref - The ref to set
 * @param value - The value to set
 */
export function setRef<T>(ref: MergeableRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref != null) {
    (ref as MutableRefObject<T | null>).current = value;
  }
}

/**
 * Check if a ref has a current value.
 *
 * @param ref - The ref to check
 * @returns True if the ref has a current value
 */
export function hasRefValue<T>(ref: MergeableRef<T>): ref is MutableRefObject<NonNullable<T>> {
  return ref != null && typeof ref !== 'function' && ref.current != null;
}
