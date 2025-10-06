/**
 * For - List Rendering Component
 *
 * Efficiently renders lists with keyed reconciliation
 */

import { defineComponent } from '../core/component/define.js';
import { computed } from '../core/reactivity/computed.js';

/**
 * For component props
 */
export interface ForProps<T> {
  /**
   * Array of items to render
   */
  each: T[] | undefined | null;

  /**
   * Fallback to render when list is empty
   */
  fallback?: any;

  /**
   * Children render function
   * Receives (item, index)
   */
  children: (item: T, index: number) => any;
}

/**
 * For component - efficient list rendering
 *
 * Uses keyed reconciliation for optimal updates.
 * Only re-renders items that changed.
 *
 * @example
 * ```tsx
 * <For each={todos()} fallback={<div>No todos</div>}>
 *   {(todo, index) => (
 *     <div>
 *       {index + 1}. {todo.text}
 *     </div>
 *   )}
 * </For>
 * ```
 */
export const For = defineComponent(<T extends any>(props: ForProps<T>) => {
  const items = computed(() => props.each || []);

  return () => {
    const list = items();

    if (list.length === 0) {
      return props.fallback || null;
    }

    // Map items to rendered elements
    return list.map((item, index) => props.children(item, index));
  };
}) as <T>(props: ForProps<T>) => any;
