/**
 * Show - Conditional Rendering Component
 *
 * ⚠️ IMPORTANT LIMITATION:
 * ======================
 * This component has a KNOWN ISSUE with Aether's reactivity model.
 * It only works for STATIC conditions (conditions that don't change).
 *
 * For DYNAMIC conditions (signals that change), the component will NOT update
 * because Aether components don't re-render when signals change.
 *
 * ❌ DOESN'T WORK (dynamic condition):
 * ```tsx
 * const isVisible = signal(false);
 * <Show when={isVisible()}>Content</Show>  // Won't update when signal changes!
 * ```
 *
 * ✅ WORKS (static condition):
 * ```tsx
 * const user = { name: 'Alice' }; // Static value
 * <Show when={user}>Hello {user.name}</Show>  // Works fine
 * ```
 *
 * ✅ WORKAROUND (use display toggle pattern):
 * ```tsx
 * // Instead of Show, use this pattern for dynamic visibility:
 * const div = <div>Content</div> as HTMLElement;
 * effect(() => {
 *   div.style.display = isVisible() ? '' : 'none';
 * });
 * ```
 *
 * TODO: This component needs to be refactored to use the display toggle pattern
 * or removed from the library until the framework supports component re-rendering.
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
 * ⚠️ LIMITATION: Only works for static conditions. See file header for details.
 *
 * @example
 * ```tsx
 * // Static condition (works)
 * <Show when={user} fallback={<div>No user</div>}>
 *   <div>Hello {user.name}</div>
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
