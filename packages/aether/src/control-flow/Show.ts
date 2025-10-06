/**
 * Show - Conditional Rendering Component
 *
 * Renders children when condition is truthy
 */

import { defineComponent } from '../core/component/define.js';
import { computed } from '../core/reactivity/computed.js';

/**
 * Show component props
 */
export interface ShowProps {
  /**
   * Condition to evaluate
   */
  when: any;

  /**
   * Fallback to render when condition is falsy
   */
  fallback?: any;

  /**
   * Children to render when condition is truthy
   */
  children?: any;
}

/**
 * Show component - conditional rendering
 *
 * Only creates children when condition is truthy,
 * providing better performance than ternary expressions
 *
 * @example
 * ```tsx
 * <Show when={user()} fallback={<div>Loading...</div>}>
 *   <div>Hello {user()!.name}</div>
 * </Show>
 * ```
 */
export const Show = defineComponent<ShowProps>((props) => {
  const condition = computed(() => !!props.when);

  return () => {
    if (condition()) {
      return typeof props.children === 'function'
        ? props.children(props.when)
        : props.children;
    }

    return props.fallback || null;
  };
});
